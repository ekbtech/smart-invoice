import { randomUUID } from "node:crypto";

export async function writeAudit(connection, { tenantId, userId, action, entityType, entityId = null, details = null, ipAddress = null }) {
  await connection.execute(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      tenantId,
      userId ?? null,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      ipAddress ? Buffer.from(ipAddress.split(".").slice(0, 4).map(Number)) : null,
    ],
  );
}
