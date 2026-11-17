import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { authRouter, createAuthMiddleware } from "./auth.js";
import { businessRouter } from "./business.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { platformAdminRouter } from "./platform-admin.js";
import { loadTenantSubscription } from "./subscriptions.js";
import { requireAuth, requireTenant } from "./tenant.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(cookieParser());

  app.use("/api", (request, _response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }
    const origin = request.get("origin");
    if (!origin || origin !== new URL(config.appOrigin).origin) {
      next(new HttpError(403, "UNTRUSTED_ORIGIN", "This request origin is not allowed."));
      return;
    }
    next();
  });

  app.get("/", (_request, response) => {
    response.redirect(302, config.appOrigin);
  });

  app.get("/api/health", async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ data: { status: "ok", database: "connected" } });
  });

  app.use("/api/v1", createAuthMiddleware());
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/platform-admin", requireAuth, platformAdminRouter);
  app.use("/api/v1", requireAuth, requireTenant, loadTenantSubscription, businessRouter);
  app.use("/api", (_request, _response, next) => next(new HttpError(404, "ROUTE_NOT_FOUND", "API route not found.")));
  app.use(errorHandler);
  return app;
}
