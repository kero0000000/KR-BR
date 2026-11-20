-- =====================================================================
--  KR&BR  —  MySQL schema
--  ONE table that stores ALL account data for buyers + sellers
--  AND their bank-card data on the SAME table.
--
--  Sensitive card fields are encrypted at the application layer with
--  AES-256-GCM (authenticated encryption). The DB only ever stores
--  ciphertext tokens, plus a non-reversible HMAC of the card number
--  for blind lookup / duplicate detection, and the last 4 digits for
--  masked display.
--
--  NOTE on PCI DSS: storing the CVV after authorisation is not allowed
--  in real card processing. It is encrypted here only to satisfy the
--  existing demo UI. Remove card_cvv_enc in production.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS kr_br
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE kr_br;

CREATE TABLE IF NOT EXISTS users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- ---- Account identity ----
  name                  VARCHAR(100)    NOT NULL,
  email                 VARCHAR(255)    NOT NULL,
  password_hash         VARCHAR(255)    NOT NULL,                 -- bcrypt hash (salted, slow)
  account_type          ENUM('buyer','seller','admin') NOT NULL DEFAULT 'buyer',
  balance               DECIMAL(12,2)   NOT NULL DEFAULT 0.00,

  -- ---- Account security / anti brute-force ----
  status                ENUM('active','locked','suspended') NOT NULL DEFAULT 'active',
  failed_login_attempts INT UNSIGNED   NOT NULL DEFAULT 0,
  locked_until          DATETIME        NULL,                      -- account lock cooldown
  last_login_at         DATETIME        NULL,
  last_login_ip         VARCHAR(45)     NULL,                      -- IPv4 or IPv6

  -- ---- Bank card data (encrypted at rest) ----
  card_number_enc       TEXT            NULL,                       -- AES-256-GCM(full PAN)
  card_number_hmac      CHAR(64)        NULL,                       -- HMAC-SHA256(PAN), blind lookup
  card_last4            CHAR(4)         NULL,                       -- for masked display, non-sensitive
  card_brand            VARCHAR(20)     NULL,                       -- Visa / Mastercard / ...
  card_expiry_enc       TEXT            NULL,                       -- AES-256-GCM(MM/YY)
  card_cvv_enc          TEXT            NULL,                       -- AES-256-GCM(CVV)
  card_holder_enc       TEXT            NULL,                       -- AES-256-GCM(holder name)
  card_updated_at       DATETIME        NULL,

  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email),
  KEY idx_card_hmac (card_number_hmac),
  KEY idx_account_type (account_type),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
