CREATE TABLE IF NOT EXISTS proforma_counters (
  tenant_id CHAR(36) NOT NULL,
  document_year SMALLINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, document_year),
  CONSTRAINT fk_proforma_counters_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS proforma_invoices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  proforma_number VARCHAR(40) NOT NULL,
  status ENUM('issued','converted','void') NOT NULL DEFAULT 'issued',
  currency CHAR(3) NOT NULL,
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  subtotal_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tax_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  notes TEXT NULL,
  issued_snapshot JSON NOT NULL,
  converted_invoice_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_proformas_tenant_id (tenant_id, id),
  UNIQUE KEY uq_proformas_tenant_number (tenant_id, proforma_number),
  KEY ix_proformas_tenant_status_date (tenant_id, status, issue_date),
  CONSTRAINT fk_proformas_customer FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  CONSTRAINT fk_proformas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_proformas_creator_membership FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id),
  CONSTRAINT fk_proformas_converted_invoice FOREIGN KEY (tenant_id, converted_invoice_id) REFERENCES invoices(tenant_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS proforma_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  proforma_id CHAR(36) NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price_cents BIGINT UNSIGNED NOT NULL,
  discount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_bps SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  line_total_cents BIGINT UNSIGNED NOT NULL,
  KEY ix_proforma_items_document (tenant_id, proforma_id),
  CONSTRAINT fk_proforma_items_document FOREIGN KEY (tenant_id, proforma_id) REFERENCES proforma_invoices(tenant_id, id)
) ENGINE=InnoDB;
