import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default("sip_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  APP_ENCRYPTION_KEY: z.string().regex(
    /^[a-fA-F0-9]{64}$/,
    "Set a unique 32-byte key encoded as 64 hexadecimal characters.",
  ),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default("smart_invoice_pro"),
  DB_USER: z.string().default("sip_app"),
  DB_PASSWORD: z.string().min(1).default("change-this-local-password"),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.DB_PASSWORD === "change-this-local-password") {
    context.addIssue({ code: "custom", path: ["DB_PASSWORD"], message: "Set a unique database password in production." });
  }
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid server configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === "production",
  port: parsed.data.API_PORT,
  appOrigin: parsed.data.APP_ORIGIN,
  cookieName: parsed.data.SESSION_COOKIE_NAME,
  sessionTtlHours: parsed.data.SESSION_TTL_HOURS,
  encryptionKey: Buffer.from(parsed.data.APP_ENCRYPTION_KEY, "hex"),
  platformAdminEmails: parsed.data.PLATFORM_ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
  database: {
    host: parsed.data.DB_HOST,
    port: parsed.data.DB_PORT,
    database: parsed.data.DB_NAME,
    user: parsed.data.DB_USER,
    password: parsed.data.DB_PASSWORD,
  },
};
