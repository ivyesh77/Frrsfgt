# Production data migration and rollback plan

The files under `server/data/` are local development state. They are not a production ledger and must never be copied into a live container as the source of truth.

## Source-to-target mapping

| Local record | PostgreSQL target | Integrity rule |
|---|---|---|
| `store.json.users` | `users`, `wallets` | Normalize username keys; preserve IDs; reject duplicate identities; wallet balances must be non-negative. |
| `store.json.transactions` | `ledger_entries` | Preserve transaction IDs/correlation IDs; verify before/after balances and idempotency uniqueness. |
| `payment-store.json.adapters` | `payment_accounts` | Preserve Payment IDs and archived accounts; secrets become references only. |
| `payment-store.json.transactions` | `payment_transactions` | Preserve assigned Payment ID/provider reference/idempotency key; reject duplicate references. |
| `payment-store.json.routingDecisions` | `routing_decisions` | Preserve historical account, strategy, reason and config version. |
| `payment-store.json.providerEvents` | `provider_events` | Preserve provider event IDs and payload hashes; reject replay duplicates. |
| `payment-store.json.reconciliationRecords` | `reconciliation_records` | Preserve open/mismatch history; do not auto-resolve. |
| `admin-store.json.admins` | `admin_users` | Rehash/validate credentials; do not import bootstrap passwords. |
| `operator-store.json.operators` | `operators`, `operator_payment_accounts` | Preserve assignments and status; no provider credentials are imported. |
| notifications/audit records | `notifications`, `audit_events` | Preserve actor, target, request/correlation and timestamps; redact secrets before import. |

## Migration procedure

1. Freeze local writes and create checksummed read-only copies of all source files.
2. Validate JSON schema and report every malformed, duplicate, negative-balance or missing-reference record.
3. Create a new PostgreSQL database and apply `npm run migrate` with `APP_ENV=STAGING`.
4. Load parent tables first: users, admins, operators, payment accounts, wallets.
5. Load ledger and payment transactions in source order inside batches with idempotent keys.
6. Load routing decisions, provider events, reconciliation, audit and notifications.
7. Run invariants:
   - every payment transaction references one immutable Payment ID;
   - every ledger entry references an existing user and source;
   - wallet available plus reserved balances match the latest ledger state;
   - provider event uniqueness holds;
   - no secret value appears in any target row;
   - all archived accounts remain queryable;
   - transaction counts and amount sums match the source checksums.
8. Run player/admin/operator integration tests against the migrated staging database.
9. Obtain a separate operator and compliance sign-off before production cutover.
10. Take a database backup immediately before cutover and retain the source snapshot according to the approved retention policy.

## Rollback

- Before accepting production writes, rollback means switching traffic back to the previous release and restoring the pre-cutover database snapshot.
- After production writes, do not replay old JSON over the live ledger. Use a forward corrective migration with an audited incident/change reference.
- Provider events received during a rollback window must be retained and replayed through the durable webhook queue exactly once.
- Financial mismatches require reconciliation and approved correction; deleting or manually editing rows is not a rollback strategy.
