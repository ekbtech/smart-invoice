ALTER TABLE tenants
  ADD COLUMN invoice_logo MEDIUMBLOB NULL,
  ADD COLUMN invoice_logo_mime_type VARCHAR(32) NULL,
  ADD COLUMN invoice_layout VARCHAR(24) NOT NULL DEFAULT 'classic';
