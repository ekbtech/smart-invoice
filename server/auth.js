import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { pool, inTransaction } from "./db.js";
import { loginSchema } from "./domain.js";
import { HttpError } from "./errors.js";
import { createTotpSecret, createTotpUri, decryptMfaSecret, encryptMfaSecret, verifyTotp } from "./mfa.js";

const router = Router();
const loginAttempts = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "LOGIN_RATE_LIMIT", message: "Too many sign-in attempts. Try again later." } },
});
const mfaAttempts = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "MFA_RATE_LIMIT", message: "Too many verification attempts. Try again later." } },
});
const tenantSelectionSchema = z.object({ tenantId: z.string().uuid() });
const businessSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  kraPin: z.string().trim().max(24).optional().default(""),
});

function consumeRecoveryCode(connection, userId, recoveryCode) {
  const normalizedCode = recoveryCode.replaceAll("-", "").toUpperCase();
  return connection.execute(
    `UPDATE mfa_recovery_codes SET used_at = UTC_TIMESTAMP(3)
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    [userId, createHash("sha256").update(normalizedCode).digest()],
  );
}

async function verifyMfaCode(connection, userId, encryptedSecret, code) {
  const secret = decryptMfaSecret(encryptedSecret);
  if (/^\d{6}$/.test(code) && verifyTotp(secret, code)) return { valid: true, recovery: false };
  if (!/^[A-Za-z0-9-]{8,20}$/.test(code)) return { valid: false, recovery: false };
  const [result] = await consumeRecoveryCode(connection, userId, code);
  return { valid: result.affectedRows === 1, recovery: true };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest();
}

function setSessionCookie(response, token, expiresAt) {
  response.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

function clearSessionCookie(response) {
  response.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
  });
}

async function createSession(connection, userId, tenantId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  await connection.execute(
    "INSERT INTO sessions (id, user_id, active_tenant_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    [randomUUID(), userId, tenantId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

async function getMemberships(userId) {
  const [rows] = await pool.execute(
    `SELECT t.id, t.name, t.currency, m.role
     FROM memberships m
     INNER JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND m.active = TRUE
     ORDER BY t.created_at ASC`,
    [userId],
  );
  return rows;
}

router.post("/register", (_request, _response, next) => {
  next(new HttpError(403, "ADMIN_ACCOUNT_CREATION_ONLY", "Self-registration is disabled. Ask the platform administrator to create your account."));
});

router.post("/login", loginAttempts, async (request, response) => {
  const input = loginSchema.parse(request.body);
  const [rows] = await pool.execute(
    `SELECT id, email, full_name, password_hash, mfa_enabled, mfa_secret_enc
     FROM users WHERE email = ? AND disabled_at IS NULL LIMIT 1`,
    [input.email],
  );
  const user = rows[0];
  const validPassword = user ? await bcrypt.compare(input.password, user.password_hash) : false;
  if (!validPassword) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  if (user.mfa_enabled) {
    const challengeToken = randomBytes(32).toString("base64url");
    await pool.execute(
      `INSERT INTO mfa_challenges (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
      [randomUUID(), user.id, hashToken(challengeToken)],
    );
    response.status(202).json({ data: { mfaRequired: true, challengeToken } });
    return;
  }

  const memberships = await getMemberships(user.id);
  if (memberships.length === 0) throw new HttpError(403, "NO_BUSINESS_ACCESS", "This account does not belong to an active business.");
  const session = await inTransaction((connection) => createSession(connection, user.id, memberships[0].id));
  setSessionCookie(response, session.token, session.expiresAt);
  response.json({
    data: {
      user: { id: user.id, email: user.email, fullName: user.full_name },
      tenants: memberships.map(({ id, name, currency, role }) => ({ id, name, currency, role })),
      activeTenantId: memberships[0].id,
    },
  });
});

router.post("/mfa/verify", mfaAttempts, async (request, response) => {
  const input = z.object({
    challengeToken: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/),
    code: z.string().trim().min(6).max(20),
  }).parse(request.body);
  const session = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT c.id AS challenge_id, u.id AS user_id, u.email, u.full_name,
              u.mfa_enabled, u.mfa_secret_enc
       FROM mfa_challenges c INNER JOIN users u ON u.id = c.user_id
       WHERE c.token_hash = ? AND c.expires_at > UTC_TIMESTAMP(3)
         AND c.consumed_at IS NULL AND u.disabled_at IS NULL FOR UPDATE`,
      [hashToken(input.challengeToken)],
    );
    const user = rows[0];
    if (!user || !user.mfa_enabled || !user.mfa_secret_enc) throw new HttpError(401, "MFA_CHALLENGE_INVALID", "This sign-in challenge is invalid or has expired.");
    const verification = await verifyMfaCode(connection, user.user_id, user.mfa_secret_enc, input.code);
    if (!verification.valid) throw new HttpError(401, "MFA_CODE_INVALID", "The verification code is incorrect or has already been used.");
    await connection.execute("UPDATE mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE id = ?", [user.challenge_id]);
    const memberships = await getMemberships(user.user_id);
    if (memberships.length === 0) throw new HttpError(403, "NO_BUSINESS_ACCESS", "This account does not belong to an active business.");
    const created = await createSession(connection, user.user_id, memberships[0].id);
    return { ...created, user: { id: user.user_id, email: user.email, fullName: user.full_name }, memberships };
  });
  setSessionCookie(response, session.token, session.expiresAt);
  response.json({
    data: {
      user: session.user,
      tenants: session.memberships.map(({ id, name, currency, role }) => ({ id, name, currency, role })),
      activeTenantId: session.memberships[0].id,
    },
  });
});

router.post("/mfa/setup", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in before configuring MFA.");
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(request.body);
  const [rows] = await pool.execute("SELECT password_hash, mfa_enabled FROM users WHERE id = ? LIMIT 1", [request.auth.userId]);
  const user = rows[0];
  if (!user || !await bcrypt.compare(password, user.password_hash)) throw new HttpError(401, "INVALID_CREDENTIALS", "Your password is incorrect.");
  if (user.mfa_enabled) throw new HttpError(409, "MFA_ALREADY_ENABLED", "Multi-factor authentication is already enabled.");
  const secret = createTotpSecret();
  await pool.execute(
    "UPDATE users SET mfa_secret_enc = ? WHERE id = ?",
    [encryptMfaSecret(secret), request.auth.userId],
  );
  response.json({ data: { secret, otpauthUri: createTotpUri(secret, request.auth.email) } });
});

router.get("/mfa/status", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in before checking MFA settings.");
  const [rows] = await pool.execute("SELECT mfa_enabled FROM users WHERE id = ? LIMIT 1", [request.auth.userId]);
  if (!rows[0]) throw new HttpError(404, "USER_NOT_FOUND", "Your user account could not be found.");
  response.json({ data: { enabled: Boolean(rows[0].mfa_enabled) } });
});

router.post("/mfa/enable", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in before configuring MFA.");
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
  const [rows] = await pool.execute("SELECT mfa_secret_enc, mfa_enabled FROM users WHERE id = ? LIMIT 1", [request.auth.userId]);
  const user = rows[0];
  if (!user?.mfa_secret_enc) throw new HttpError(409, "MFA_SETUP_REQUIRED", "Start MFA setup before confirming a verification code.");
  if (user.mfa_enabled) throw new HttpError(409, "MFA_ALREADY_ENABLED", "Multi-factor authentication is already enabled.");
  if (!verifyTotp(decryptMfaSecret(user.mfa_secret_enc), code)) {
    throw new HttpError(400, "MFA_CODE_INVALID", "The verification code is incorrect.");
  }
  const recoveryCodes = Array.from({ length: 8 }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
  await inTransaction(async (connection) => {
    await connection.execute("UPDATE users SET mfa_enabled = TRUE WHERE id = ?", [request.auth.userId]);
    for (const recoveryCode of recoveryCodes) {
      await connection.execute(
        "INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)",
        [randomUUID(), request.auth.userId, createHash("sha256").update(recoveryCode.replaceAll("-", "")).digest()],
      );
    }
  });
  response.json({ data: { enabled: true, recoveryCodes } });
});

router.post("/mfa/disable", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in before changing MFA settings.");
  const { password, code } = z.object({
    password: z.string().min(1).max(128),
    code: z.string().trim().min(6).max(20),
  }).parse(request.body);
  await inTransaction(async (connection) => {
    const [rows] = await connection.execute("SELECT password_hash, mfa_enabled, mfa_secret_enc FROM users WHERE id = ? FOR UPDATE", [request.auth.userId]);
    const user = rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) throw new HttpError(401, "INVALID_CREDENTIALS", "Your password is incorrect.");
    if (!user.mfa_enabled || !user.mfa_secret_enc) throw new HttpError(409, "MFA_NOT_ENABLED", "Multi-factor authentication is not enabled.");
    const verification = await verifyMfaCode(connection, request.auth.userId, user.mfa_secret_enc, code);
    if (!verification.valid) throw new HttpError(401, "MFA_CODE_INVALID", "The verification code is incorrect.");
    await connection.execute("UPDATE users SET mfa_enabled = FALSE, mfa_secret_enc = NULL WHERE id = ?", [request.auth.userId]);
    await connection.execute("DELETE FROM mfa_recovery_codes WHERE user_id = ?", [request.auth.userId]);
  });
  response.json({ data: { enabled: false } });
});

router.post("/logout", async (request, response) => {
  const token = request.cookies?.[config.cookieName];
  if (token) await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  clearSessionCookie(response);
  response.status(204).end();
});

router.get("/me", async (request, response) => {
  if (!request.auth) {
    response.json({ data: null });
    return;
  }
  const memberships = await getMemberships(request.auth.userId);
  response.json({
    data: {
      user: { id: request.auth.userId, email: request.auth.email, fullName: request.auth.fullName },
      tenants: memberships.map(({ id, name, currency, role }) => ({ id, name, currency, role })),
      activeTenantId: request.auth.tenantId,
    },
  });
});

router.post("/tenant", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to choose a business.");
  const { tenantId } = tenantSelectionSchema.parse(request.body);
  const [memberships] = await pool.execute(
    "SELECT 1 FROM memberships WHERE user_id = ? AND tenant_id = ? AND active = TRUE LIMIT 1",
    [request.auth.userId, tenantId],
  );
  if (!memberships.length) throw new HttpError(403, "TENANT_ACCESS_DENIED", "You do not belong to that business.");
  await pool.execute("UPDATE sessions SET active_tenant_id = ? WHERE id = ?", [tenantId, request.auth.sessionId]);
  response.json({ data: { activeTenantId: tenantId } });
});

router.post("/businesses", async (request, response) => {
  if (!request.auth) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to create another business.");
  const input = businessSchema.parse(request.body);
  const tenantId = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      "INSERT INTO tenants (id, name, email, phone, address, kra_pin) VALUES (?, ?, ?, ?, ?, ?)",
      [tenantId, input.businessName, input.email, input.phone || null, input.address || null, input.kraPin || null],
    );
    await connection.execute(
      "INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'owner')",
      [tenantId, request.auth.userId],
    );
    await connection.execute(
      "INSERT INTO branches (id, tenant_id, name, address, phone, is_default) VALUES (?, ?, 'Main branch', ?, ?, TRUE)",
      [randomUUID(), tenantId, input.address || null, input.phone || null],
    );
    await connection.execute(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, trial_ends_at)
       SELECT ?, ?, id, 'trialing', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 14 DAY)
       FROM subscription_plans WHERE code = 'starter'`,
      [randomUUID(), tenantId],
    );
    await connection.execute(
      "UPDATE sessions SET active_tenant_id = ? WHERE id = ?",
      [tenantId, request.auth.sessionId],
    );
  });
  response.status(201).json({
    data: { id: tenantId, name: input.businessName, currency: "KES", role: "owner" },
  });
});

export function createAuthMiddleware() {
  return async function authenticate(request, _response, next) {
    try {
      const token = request.cookies?.[config.cookieName];
      if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
        next();
        return;
      }
      const [rows] = await pool.execute(
        `SELECT s.id AS session_id, s.user_id, s.active_tenant_id, u.email, u.full_name
         FROM sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.disabled_at IS NULL
         LIMIT 1`,
        [hashToken(token)],
      );
      if (rows.length === 0) {
        next();
        return;
      }
      const session = rows[0];
      request.auth = {
        sessionId: session.session_id,
        userId: session.user_id,
        tenantId: session.active_tenant_id,
        email: session.email,
        fullName: session.full_name,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const authRouter = router;
