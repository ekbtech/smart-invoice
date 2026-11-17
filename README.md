# Smart Invoice Pro

Smart Invoice Pro is a small-business invoicing application with a React/TypeScript frontend and an Express/MySQL API. The installed desktop client opens a private, server-backed workspace and uses an application-style sign-in screen.

## Run locally (after setup)

```powershell
npm install
npm run dev:api
npm run dev
```

Open the local URL printed by Vite. Sign-in is required; self-registration and anonymous demo access are disabled. Only a business workspace member with the **Admin** role can create user accounts in that workspace. Platform-wide administrator access does not grant this permission.

## Run the API locally

Requirements: Node.js 22.12 or newer, npm, and Docker Desktop with its engine running (or a compatible MySQL 8.4 server).

1. Copy `.env.example` to `.env`.
2. Generate a unique encryption key and put it in `APP_ENCRYPTION_KEY`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Keep this key private and persistent. Losing or changing it makes MFA secrets already stored in the database undecryptable.
3. Generate a second, different key and put it in `BACKUP_ENCRYPTION_KEY`. This key encrypts database backups; losing it makes those backups unrecoverable.
4. Set unique `DB_PASSWORD` and `DB_ROOT_PASSWORD` values in `.env`.
5. To enable the platform administration screen, set `PLATFORM_ADMIN_EMAILS` to a comma-separated list of trusted administrator account emails. Access is granted only to signed-in accounts whose email matches this server-side allowlist.
6. Start MySQL and apply the schema:

   ```powershell
   docker compose up -d
   npm install
   npm run db:migrate
   ```
7. In separate terminals, start the API and frontend:

   ```powershell
   npm run dev:api
   npm run dev
   ```

The Vite development server proxies `/api` requests to `http://localhost:3001`. The API listens on port 3001 by default.
Opening the API root (`http://localhost:3001/`) redirects to the configured frontend URL in `APP_ORIGIN`.

To securely create the initial platform administrator from an interactive terminal, run:

```powershell
npm run admin:create
```

For a fresh installation, the command prompts for the administrator name, email, workspace name, and password. Password input is hidden and never passed as a command-line argument or written to `.env`. It creates an initial business **Admin** account and starter workspace, then adds the email to `PLATFORM_ADMIN_EMAILS` for system-wide administration. Restart the API after setup so it reloads the allowlist.

To erase all current user accounts and business data and replace them with a single general administrator, stop the API and frontend, then run:

```powershell
npm run system:reset
```

The reset asks you to type the configured database name and securely prompts for the new administrator credentials. It transactionally deletes business data and existing user/admin accounts, keeps the database schema and subscription plan definitions, creates one workspace, assigns the new account the full business Admin role, and replaces the platform-admin allowlist with only that email. Restart the API and frontend afterward. This operation is irreversible; make an encrypted backup first if you might need existing records.

## Implemented

- Business Admin-created workspace accounts, login sessions, business role checks, and MFA setup, verification, recovery-code, and disable flows. The Admin role has full business permissions; public self-registration is disabled.
- Customer and product management, invoices and invoice numbering, issue/void workflows, partial payments, quotations and conversion, adjustment notes, branches, notifications, reports, and audit records.
- Tenant-scoped supplier records and expense management, including edits, supplier archiving, expense voiding, input-VAT calculation, and audit events for record changes.
- Period-based Tax Management reports for VAT collected (with proportional credit-note adjustments), input VAT recorded on expenses, and net VAT by currency, with downloadable CSV summaries.
- Built-in rule-based Smart Tools for overdue and near-due invoice follow-up, plus an Integrations screen that clearly marks external services as disconnected.
- Security & Audit Logs screen with account MFA controls and a recent business activity log; access to audit records follows tenant role permissions.
- Admin navigation with the requested sidebar destinations, a responsive top quick-navigation bar, a full Notifications page, and quick links to quotations, proformas, adjustment notes, and recurring invoices.
- A dedicated Subscription Plan destination in both sidebar and top navigation, with direct access to current plan, billing status, usage, available plans, and the platform-admin exemption notice.
- Proforma invoices with conversion into invoice drafts, and manageable invoice templates that can be selected for invoices and snapshotted when issued.
- Business profile logo (PNG/JPEG, up to 2 MB) or complete letterhead (single-page PDF, PNG, or JPEG, up to 5 MB) uploads; the two are mutually exclusive. Invoice, receipt, and delivery-note PDFs use the selected branding. Logo use requires business name, email, phone, and address; a complete letterhead can be used without entering those details.
- Delivery notes created after an invoice is issued, with delivered quantities, recipient and address, delivery date, notes, and printable signature fields.
- Settings screens for branches and team access review/removal. Only the workspace Admin role can create non-admin user accounts within that business; platform-wide administration is separately allowlisted.
- Recurring invoice schedules with weekly/monthly/quarterly/yearly dates, pause/resume, safe monthly date anchoring, and a MySQL-locking background worker that issues due invoices and records audit/notification entries.
- Server-generated invoice PDFs and payment receipts, with tenant-scoped download routes; downloadable invoice, payment, outstanding-balance, and tax-summary CSV exports.
- Subscription plan visibility, starter/professional/business/enterprise plan configuration, invoice and user caps, read-only access for expired/suspended subscriptions, and an environment-allowlisted platform administrator console for plans and subscription status.
- Platform administrators configured in `PLATFORM_ADMIN_EMAILS` are exempt from workspace subscription status, feature, invoice, and user limits while signed in, without changing plan restrictions for other workspace members.
- Appearance settings with five coordinated blue, emerald, violet, rose, and amber color themes; foreground font colors adapt to light or dark mode and are saved per browser.
- Streaming AES-256-GCM encrypted database backups, integrity verification before restore, and guarded restore into a newly migrated empty database.
- A hardened Electron Windows desktop shell that loads a configured hosted HTTPS application and keeps the existing same-origin API architecture.
- Integer-cent invoice calculations, tenant-scoped database relationships, and transaction-backed financial operations.
- Print-friendly invoice output.

## Not yet production-complete

Email delivery and verification, password recovery, M-Pesa and KRA eTIMS integrations are intentionally deferred. Subscription administration currently changes plan/status manually; no checkout or subscription payment provider is connected. Comprehensive database-backed integration/tenant-isolation testing remains unfinished. Invoice templates currently configure visual options, but there is no template designer. Recurring invoices are issued by the API worker but are not emailed.

## Windows desktop application

The Electron shell loads the hosted web application; it does not bundle or start the API/database. Deploy the web application and API at the same HTTPS origin first. For local development, set `SIP_DESKTOP_APP_URL` to `http://localhost:5173` and run `npm run desktop:dev`.

To build a Windows installer, set the deployed app URL and run:

```powershell
$env:SIP_DESKTOP_APP_URL = "https://invoices.example.com"
npm run desktop:dist
```

The base URL is embedded in the packaged app, and the installer is written to `release/`. The URL must not contain credentials, query parameters, or a fragment. The packaged app requires HTTPS, disables Node integration, enables context isolation and sandboxing, blocks pop-up windows and cross-origin navigation, and denies renderer permission requests.

## Encrypted database backups

Set `BACKUP_ENCRYPTION_KEY` to a randomly generated 32-byte key (64 hexadecimal characters) that is different from `APP_ENCRYPTION_KEY`. Store the key separately from the backups and never commit it. Create a new backup file with:

```powershell
New-Item -ItemType Directory -Force .\backups
npm run db:backup -- --output .\backups\smart-invoice-2026-01-31.sipbackup
```

The destination folder must already exist, and a backup never overwrites an existing file. Backups contain database rows, including account and financial records; keep them in a protected location and transfer/store them securely.

To restore, create a **new, empty database** using the same schema/migrations as the backup. Configure the application to use that database, then run:

```powershell
npm run db:migrate
npm run db:restore -- --file .\backups\smart-invoice-2026-01-31.sipbackup --confirm-restore smart_invoice_pro
```

Replace `smart_invoice_pro` with the exact `DB_NAME` configured in `.env`. Restore refuses a database containing business data, authenticates the complete encrypted file before changing the database, and rolls back on errors. It restores database rows only; any externally stored files must be backed up separately.

The numbered MySQL migrations through `008_suppliers_expenses.sql` define the current schema. The API health check and targeted database-backed workflows have passed; this is not a comprehensive integration suite. Do not use this build for live financial data until the remaining gaps are addressed and the deployment is independently reviewed.

Run the current automated tests and frontend production build with:

```powershell
npm test
npm run build
```
