ALTER TABLE invoices
  ADD COLUMN template_id CHAR(36) NULL,
  ADD COLUMN template_name_snapshot VARCHAR(120) NULL,
  ADD COLUMN template_config_snapshot JSON NULL,
  ADD KEY ix_invoices_tenant_template (tenant_id, template_id),
  ADD CONSTRAINT fk_invoices_template FOREIGN KEY (tenant_id, template_id) REFERENCES invoice_templates(tenant_id, id);
