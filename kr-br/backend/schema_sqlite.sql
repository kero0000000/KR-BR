-- =====================================================================
--  KR&BR — SQLite schema (zero-setup dev/demo backend)
--  Same single-table model as schema.sql (MySQL). Used automatically when
--  MySQL is not configured. Identical encryption is applied by the app.
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  -- ---- Account identity ----
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,                 -- bcrypt hash
  account_type          TEXT NOT NULL DEFAULT 'buyer'
                        CHECK (account_type IN ('buyer','seller','admin')),
  balance               REAL NOT NULL DEFAULT 0,

  -- ---- Account security / anti brute-force ----
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','locked','suspended')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,                            -- ISO timestamp
  last_login_at         TEXT,
  last_login_ip         TEXT,

  -- ---- Bank card data (encrypted at rest by the app) ----
  card_number_enc       TEXT,
  card_number_hmac      TEXT,
  card_last4            TEXT,
  card_brand            TEXT,
  card_expiry_enc       TEXT,
  card_cvv_enc          TEXT,
  card_holder_enc       TEXT,
  card_updated_at       TEXT,

  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_hmac   ON users(card_number_hmac);
CREATE INDEX IF NOT EXISTS idx_account_type ON users(account_type);
CREATE INDEX IF NOT EXISTS idx_status     ON users(status);
