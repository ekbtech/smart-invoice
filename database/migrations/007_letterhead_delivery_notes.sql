ALTER TABLE tenants
  ADD COLUMN invoice_letterhead MEDIUMBLOB NULL,
  ADD COLUMN invoice_letterhead_mime_type VARCHAR(32) NULL;

CREATE TABLE delivery_notes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  delivery_number VARCHAR(64) NOT NULL,
  delivery_date DATE NOT NULL,
  recipient_name VARCHAR(160) NOT NULL,
  delivery_address VARCHAR(500) NULL,
  delivered_by VARCHAR(160) NULL,
  notes VARCHAR(2000) NULL,
  items JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_delivery_notes_invoice (tenant_id, invoice_id),
  UNIQUE KEY uq_delivery_notes_number (tenant_id, delivery_number),
  CONSTRAINT fk_delivery_notes_invoice FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id),
  CONSTRAINT fk_delivery_notes_creator FOREIGN KEY (tenant_id, created_by) REFERENCES memberships(tenant_id, user_id)
) ENGINE=InnoDB;
