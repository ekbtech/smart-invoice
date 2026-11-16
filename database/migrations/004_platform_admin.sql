CREATE TABLE IF NOT EXISTS platform_admin_audit (
  id CHAR(36) NOT NULL PRIMARY KEY,
  admin_user_id CHAR(36) NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id CHAR(36) NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_platform_admin_audit_created (created_at),
  KEY ix_platform_admin_audit_actor (admin_user_id, created_at),
  CONSTRAINT fk_platform_admin_audit_user FOREIGN KEY (admin_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

UPDATE subscription_plans
SET features = CASE code
  WHEN 'starter' THEN JSON_OBJECT(
    'basicInvoicing', TRUE, 'customers', TRUE, 'products', TRUE, 'pdf', TRUE
  )
  WHEN 'professional' THEN JSON_OBJECT(
    'basicInvoicing', TRUE, 'customers', TRUE, 'products', TRUE, 'pdf', TRUE,
    'reports', TRUE, 'quotations', TRUE, 'payments', TRUE
  )
  WHEN 'business' THEN JSON_OBJECT(
    'basicInvoicing', TRUE, 'customers', TRUE, 'products', TRUE, 'pdf', TRUE,
    'reports', TRUE, 'quotations', TRUE, 'payments', TRUE,
    'branches', TRUE, 'recurringInvoices', TRUE
  )
  WHEN 'enterprise' THEN JSON_OBJECT(
    'basicInvoicing', TRUE, 'customers', TRUE, 'products', TRUE, 'pdf', TRUE,
    'reports', TRUE, 'quotations', TRUE, 'payments', TRUE,
    'branches', TRUE, 'recurringInvoices', TRUE, 'customLimits', TRUE
  )
  ELSE features
END;
