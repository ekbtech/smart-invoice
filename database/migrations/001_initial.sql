CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(500) NULL,
  kra_pin VARCHAR(24) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 1600,
  invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc VARBINARY(512) NULL,
  email_verified_at DATETIME(3) NULL,
  disabled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('owner','admin','finance_manager','accountant','sales_officer','cashier','auditor') NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, user_id),
  KEY ix_memberships_user (user_id, tenant_id),
  KEY ix_memberships_tenant_active (tenant_id, active, role),
  CONSTRAINT fk_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS membership_invitations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invited_email VARCHAR(254) NOT NULL,
  role ENUM('admin','finance_manager','accountant','sales_officer','cashier','auditor') NOT NULL,
  token_hash BINARY(32) NOT NULL,
  invited_by CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_membership_invites_token (token_hash),
  KEY ix_membership_invites_tenant_email (tenant_id, invited_email, accepted_at),
  CONSTRAINT fk_membership_invites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_membership_invites_inviter FOREIGN KEY (tenant_id, invited_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS branches (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(40) NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_branches_tenant_id (tenant_id, id),
  CONSTRAINT fk_branches_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  active_tenant_id CHAR(36) NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_active_membership FOREIGN KEY (active_tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mfa_challenges_token (token_hash),
  KEY ix_mfa_challenges_expiry (expires_at),
  CONSTRAINT fk_mfa_challenges_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  code_hash BINARY(32) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mfa_recovery_code (user_id, code_hash),
  KEY ix_mfa_recovery_user (user_id, used_at),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  company VARCHAR(160) NULL,
  email VARCHAR(254) NULL,
  phone VARCHAR(40) NULL,
  billing_address VARCHAR(500) NULL,
  kra_pin VARCHAR(24) NULL,
  notes TEXT NULL,
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_customers_tenant_id (tenant_id, id),
  KEY ix_customers_tenant_name (tenant_id, name),
  CONSTRAINT fk_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  category VARCHAR(100) NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  tax_rate_bps SMALLINT UNSIGNED NULL,
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_products_tenant_id (tenant_id, id),
  KEY ix_products_tenant_name (tenant_id, name),
  CONSTRAINT fk_products_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_counters (
  tenant_id CHAR(36) NOT NULL,
  invoice_year SMALLINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, invoice_year),
  CONSTRAINT fk_invoice_counters_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  branch_id CHAR(36) NULL,
  invoice_number VARCHAR(40) NOT NULL,
  status ENUM('draft','issued','void') NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  subtotal_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tax_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  amount_paid_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  notes TEXT NULL,
  terms TEXT NULL,
  issued_snapshot JSON NULL,
  issued_at DATETIME(3) NULL,
  voided_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_invoices_tenant_id (tenant_id, id),
  UNIQUE KEY uq_invoices_tenant_number (tenant_id, invoice_number),
  KEY ix_invoices_tenant_status_date (tenant_id, status, issue_date),
  KEY ix_invoices_tenant_due (tenant_id, due_date),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_invoices_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id),
  CONSTRAINT fk_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_invoices_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  product_id CHAR(36) NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  discount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  line_total_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_invoice_items_invoice (tenant_id, invoice_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  CONSTRAINT fk_invoice_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  method ENUM('mpesa','bank_transfer','cash','card','cheque','other') NOT NULL,
  reference VARCHAR(120) NULL,
  status ENUM('completed','reversed') NOT NULL DEFAULT 'completed',
  received_at DATETIME(3) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payments_tenant_id (tenant_id, id),
  UNIQUE KEY uq_payments_tenant_reference (tenant_id, reference),
  KEY ix_payments_tenant_received (tenant_id, received_at),
  CONSTRAINT fk_payments_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_payments_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_allocations_invoice (tenant_id, invoice_id),
  CONSTRAINT fk_allocations_payment FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id),
  CONSTRAINT fk_allocations_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quotations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  quotation_number VARCHAR(40) NOT NULL,
  status ENUM('draft','sent','accepted','rejected','expired','converted') NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL,
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  subtotal_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tax_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  converted_invoice_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_quotations_tenant_id (tenant_id, id),
  UNIQUE KEY uq_quotations_tenant_number (tenant_id, quotation_number),
  CONSTRAINT fk_quotations_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_quotations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_quotations_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quotation_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  quotation_id CHAR(36) NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  line_total_cents BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_quotation_items_quotation FOREIGN KEY (tenant_id, quotation_id) REFERENCES quotations(tenant_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS credit_notes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  note_number VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','issued','void') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_credit_notes_tenant_id (tenant_id, id),
  UNIQUE KEY uq_credit_notes_tenant_number (tenant_id, note_number),
  CONSTRAINT fk_credit_notes_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  CONSTRAINT fk_credit_notes_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS debit_notes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  note_number VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','issued','void') NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_debit_notes_tenant_id (tenant_id, id),
  UNIQUE KEY uq_debit_notes_tenant_number (tenant_id, note_number),
  CONSTRAINT fk_debit_notes_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  CONSTRAINT fk_debit_notes_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  frequency ENUM('weekly','monthly','quarterly','yearly') NOT NULL,
  next_run_at DATE NOT NULL,
  end_date DATE NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  template JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_recurring_invoices_tenant_id (tenant_id, id),
  KEY ix_recurring_invoices_due (tenant_id, active, next_run_at),
  CONSTRAINT fk_recurring_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_recurring_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  config JSON NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_invoice_templates_tenant_id (tenant_id, id),
  CONSTRAINT fk_invoice_templates_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_notifications_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  monthly_price_cents BIGINT UNSIGNED NULL,
  invoice_limit INT UNSIGNED NULL,
  user_limit INT UNSIGNED NULL,
  features JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_subscription_plans_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscriptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  status ENUM('trialing','active','past_due','suspended','cancelled') NOT NULL DEFAULT 'trialing',
  trial_ends_at DATETIME(3) NULL,
  current_period_start DATETIME(3) NULL,
  current_period_end DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_subscriptions_tenant_id (tenant_id, id),
  KEY ix_subscriptions_status (status, current_period_end),
  CONSTRAINT fk_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id CHAR(36) NULL,
  details JSON NULL,
  ip_address VARBINARY(16) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_tenant_created (tenant_id, created_at),
  KEY ix_audit_entity (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attachments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_attachments_tenant_id (tenant_id, id),
  CONSTRAINT fk_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_attachments_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO subscription_plans (id, code, name, monthly_price_cents, invoice_limit, user_limit, features)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'starter', 'Starter', 50000, 50, 1, JSON_OBJECT('basicInvoicing', TRUE, 'customers', TRUE, 'pdf', TRUE)),
  ('00000000-0000-4000-8000-000000000002', 'professional', 'Professional', 150000, 500, 5, JSON_OBJECT('reports', TRUE, 'quotations', TRUE, 'payments', TRUE)),
  ('00000000-0000-4000-8000-000000000003', 'business', 'Business', 350000, NULL, 25, JSON_OBJECT('branches', TRUE, 'recurringInvoices', TRUE)),
  ('00000000-0000-4000-8000-000000000004', 'enterprise', 'Enterprise', NULL, NULL, NULL, JSON_OBJECT('customLimits', TRUE));
