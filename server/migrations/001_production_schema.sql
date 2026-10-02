-- Wager Arena production schema contract.
-- IDs remain application-generated opaque strings so a migration can preserve existing
-- JSON identifiers without rewriting client-facing references.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'banned')),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('PLAYER', 'ADMIN', 'OPERATOR')),
  principal_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_principal_idx ON sessions (principal_type, principal_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  entry_fee NUMERIC(20, 4) NOT NULL CHECK (entry_fee >= 0),
  status TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_queue_idx ON rooms (format, entry_fee, status, created_at);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_room_idx ON matches (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  seat INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0,
  last_client_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id),
  UNIQUE (match_id, seat)
);

-- Wallet balances are a locked projection maintained in the same transaction as ledger_entries.
-- No API or migration may set a balance without appending the corresponding ledger entry.
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  currency CHAR(3) NOT NULL,
  available_balance NUMERIC(20, 4) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  reserved_balance NUMERIC(20, 4) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT', 'RESERVE', 'RELEASE')),
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  before_available NUMERIC(20, 4) NOT NULL,
  after_available NUMERIC(20, 4) NOT NULL CHECK (after_available >= 0),
  before_reserved NUMERIC(20, 4) NOT NULL,
  after_reserved NUMERIC(20, 4) NOT NULL CHECK (after_reserved >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (source_type, source_id, direction)
);
CREATE INDEX IF NOT EXISTS ledger_user_time_idx ON ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_source_idx ON ledger_entries (source_type, source_id);

CREATE TABLE IF NOT EXISTS payment_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('TEST', 'STAGING', 'PRODUCTION')),
  method TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  deposit_enabled BOOLEAN NOT NULL DEFAULT false,
  withdrawal_enabled BOOLEAN NOT NULL DEFAULT false,
  min_amount NUMERIC(20, 4) NOT NULL CHECK (min_amount >= 0),
  max_amount NUMERIC(20, 4) NOT NULL CHECK (max_amount >= min_amount),
  daily_limit NUMERIC(20, 4) NOT NULL CHECK (daily_limit > 0),
  routing_weight INTEGER NOT NULL CHECK (routing_weight >= 0),
  priority INTEGER NOT NULL CHECK (priority > 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  health_status TEXT NOT NULL,
  config_version BIGINT NOT NULL DEFAULT 1,
  secret_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  payment_account_id TEXT NOT NULL REFERENCES payment_accounts(id),
  operation TEXT NOT NULL CHECK (operation IN ('DEPOSIT', 'WITHDRAWAL')),
  method TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  fee NUMERIC(20, 4) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status TEXT NOT NULL,
  workflow_status TEXT,
  provider_reference TEXT UNIQUE,
  operator_reference TEXT,
  destination_masked TEXT,
  proof JSONB,
  instructions JSONB,
  expires_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, operation, idempotency_key)
);
CREATE INDEX IF NOT EXISTS payment_transactions_queue_idx ON payment_transactions (payment_account_id, operation, status, created_at);
CREATE INDEX IF NOT EXISTS payment_transactions_user_idx ON payment_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES payment_transactions(id),
  payment_account_id TEXT NOT NULL REFERENCES payment_accounts(id),
  strategy TEXT NOT NULL,
  reason TEXT NOT NULL,
  config_version BIGINT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  transaction_id TEXT REFERENCES payment_transactions(id),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE (provider, provider_event_id),
  UNIQUE (provider, payload_hash)
);

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES payment_transactions(id),
  provider_status TEXT,
  internal_status TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  resolution TEXT,
  resolution_note TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS reconciliation_open_idx ON reconciliation_records (status, checked_at) WHERE resolution IS NULL;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  username_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operator_payment_accounts (
  operator_id TEXT NOT NULL REFERENCES operators(id),
  payment_account_id TEXT NOT NULL REFERENCES payment_accounts(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, payment_account_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  request_id TEXT NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_target_idx ON audit_events (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_events (actor_type, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  operator_id TEXT REFERENCES operators(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) <> (operator_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_operator_idx ON notifications (operator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (queue_name, dedupe_key)
);
CREATE INDEX IF NOT EXISTS durable_jobs_claim_idx ON durable_jobs (queue_name, status, available_at);
