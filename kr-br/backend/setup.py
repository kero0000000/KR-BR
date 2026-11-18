#!/usr/bin/env python3
"""
setup.py — one-shot bootstrap for the KR&BR backend.

Backend selection (matches server.py):
  * DB_BACKEND env overrides ("mysql" or "sqlite").
  * Otherwise: use MySQL when MYSQL_PASSWORD is set, else SQLite (zero-setup).

It will:
  1. Create .env from .env.example if missing.
  2. Generate strong, random encryption keys and write them into .env.
  3. Create the database (MySQL) / file (SQLite) and the single `users` table.
  4. Seed the admin account (bcrypt-hashed password).

Usage:
    python backend/setup.py
"""
from __future__ import annotations

import base64
import os
import secrets
import sqlite3
import sys
import traceback
from pathlib import Path

try:
    import bcrypt
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "bcrypt"])
    import bcrypt

try:
    import pymysql
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "PyMySQL"])
    import pymysql

try:
    from dotenv import load_dotenv
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "python-dotenv"])
    from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
ENV_FILE = BACKEND_DIR / ".env"
EXAMPLE_FILE = BACKEND_DIR / ".env.example"
SCHEMA_MYSQL = BACKEND_DIR / "schema.sql"
SCHEMA_SQLITE = BACKEND_DIR / "schema_sqlite.sql"
SQLITE_PATH = BACKEND_DIR / "krbr.db"


# ------------------------------------------------------------------
def _read_lines() -> list[str]:
    if ENV_FILE.exists():
        return ENV_FILE.read_text(encoding="utf-8").splitlines()
    if EXAMPLE_FILE.exists():
        return EXAMPLE_FILE.read_text(encoding="utf-8").splitlines()
    return []


def _get(lines: list[str], key: str) -> str:
    for line in lines:
        s = line.strip()
        if s.startswith(f"{key}="):
            return s[len(key) + 1:]
    return os.getenv(key, "")


def _set_var(lines: list[str], key: str, value: str) -> list[str]:
    out, found = [], False
    for line in lines:
        s = line.strip()
        if s.startswith(f"{key}=") and not s.startswith("#"):
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{key}={value}")
    return out


def ensure_env_and_keys() -> dict:
    """Make sure .env exists and has all keys filled. Return the config dict."""
    if not ENV_FILE.exists():
        if EXAMPLE_FILE.exists():
            ENV_FILE.write_text(EXAMPLE_FILE.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"[+] Created {ENV_FILE.name} from {EXAMPLE_FILE.name}")
        else:
            ENV_FILE.write_text("", encoding="utf-8")

    lines = _read_lines()
    generated = []
    if not _get(lines, "AES_KEY"):
        lines = _set_var(lines, "AES_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
        generated.append("AES_KEY")
    if not _get(lines, "CARD_HMAC_KEY"):
        lines = _set_var(lines, "CARD_HMAC_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
        generated.append("CARD_HMAC_KEY")
    if not _get(lines, "FLASK_SECRET_KEY"):
        lines = _set_var(lines, "FLASK_SECRET_KEY", base64.urlsafe_b64encode(os.urandom(32)).decode())
        generated.append("FLASK_SECRET_KEY")
    if generated:
        ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"[+] Generated secret keys: {', '.join(generated)}")

    load_dotenv(ENV_FILE, override=True)

    cfg = {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD", ""),
        "database": os.getenv("MYSQL_DATABASE", "kr_br"),
        "admin_email": os.getenv("ADMIN_EMAIL", "admin@krbr.com").strip().lower(),
        "admin_password": os.getenv("ADMIN_PASSWORD", "").strip(),
    }

    # Backend selection (mirrors server.py)
    backend = os.getenv("DB_BACKEND", "").strip().lower()
    cfg["backend"] = backend if backend in ("mysql", "sqlite") else (
        "mysql" if cfg["password"] else "sqlite")

    if cfg["backend"] == "mysql":
        missing = [k for k, v in cfg.items()
                   if not v and k not in ("admin_password", "backend", "admin_email") or k == "admin_email" and not v]
        # Simpler explicit check for required MySQL fields:
        missing = [k for k in ("host", "user", "database", "admin_email")
                   if not cfg.get(k)]
        if not cfg["password"]:
            missing.append("MYSQL_PASSWORD")
        if missing:
            print(f"[!] MySQL mode: these values are empty in .env: {', '.join(missing)}")
            print("    Edit backend/.env and re-run: python backend/setup.py")
            print("    (Or set DB_BACKEND=sqlite to run without MySQL.)")
            sys.exit(1)
    return cfg


# ------------------------------------------------------------------
def _run_statements(conn, sql: str, translate_pct: bool):
    cleaned = "\n".join(ln for ln in sql.splitlines() if not ln.strip().startswith("--"))
    cur = conn.cursor()
    for stmt in cleaned.split(";"):
        stmt = stmt.strip()
        if not stmt:
            continue
        if translate_pct:
            stmt = stmt.replace("%s", "?")
        cur.execute(stmt)
    conn.commit()


def run_schema(cfg: dict) -> None:
    if cfg["backend"] == "mysql":
        print(f"[+] Connecting to MySQL {cfg['user']}@{cfg['host']}:{cfg['port']} …")
        conn = pymysql.connect(host=cfg["host"], port=cfg["port"],
                                user=cfg["user"], password=cfg["password"],
                                charset="utf8mb4", autocommit=True)
        try:
            _run_statements(conn, SCHEMA_MYSQL.read_text(encoding="utf-8"), translate_pct=False)
        finally:
            conn.close()
        print(f"[+] MySQL database `{cfg['database']}` + table `users` ready.")
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        try:
            _run_statements(conn, SCHEMA_SQLITE.read_text(encoding="utf-8"), translate_pct=True)
        finally:
            conn.close()
        print(f"[+] SQLite database ready: {SQLITE_PATH.name} + table `users`.")


# ------------------------------------------------------------------
def seed_admin(cfg: dict) -> None:
    admin_email = cfg["admin_email"]
    admin_password = cfg["admin_password"]
    generated_pw = False
    if not admin_password:
        admin_password = secrets.token_urlsafe(18)
        generated_pw = True
    pw_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt(rounds=12)).decode()

    if cfg["backend"] == "mysql":
        conn = pymysql.connect(host=cfg["host"], port=cfg["port"], user=cfg["user"],
                                password=cfg["password"], database=cfg["database"],
                                charset="utf8mb4", autocommit=True,
                                cursorclass=pymysql.cursors.DictCursor)
        select_sql = "SELECT id FROM users WHERE email=%s"
        upd_sql = "UPDATE users SET password_hash=%s, account_type='admin', status='active' WHERE id=%s"
        ins_sql = "INSERT INTO users(name,email,password_hash,account_type) VALUES(%s,%s,%s,'admin')"
        args_fn = lambda: ()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = lambda c, r: {k: r[i] for i, k in enumerate(r.keys())}
        conn.isolation_level = None  # autocommit-ish; we commit manually
        select_sql = "SELECT id FROM users WHERE email=?"
        upd_sql = "UPDATE users SET password_hash=?, account_type='admin', status='active' WHERE id=?"
        ins_sql = "INSERT INTO users(name,email,password_hash,account_type) VALUES(?,?,?,'admin')"

    try:
        cur = conn.cursor()
        cur.execute(select_sql, (admin_email,))
        existing = cur.fetchone()
        if existing:
            cur.execute(upd_sql, (pw_hash, existing["id"]))
            print(f"[+] Admin password reset for {admin_email}.")
        else:
            cur.execute(ins_sql, ("KR&BR Admin", admin_email, pw_hash))
            print(f"[+] Admin account created: {admin_email}")
        conn.commit()
    finally:
        conn.close()

    print("\n" + "=" * 60)
    print("  ADMIN CREDENTIALS")
    print("=" * 60)
    print(f"  Email    : {admin_email}")
    print(f"  Password : {admin_password}")
    if generated_pw:
        print("  (auto-generated — set ADMIN_PASSWORD in .env to change it)")
    print("=" * 60)
    print(f"\n[done] Backend = {cfg['backend'].upper()}.")
    print("Now start the API:  python backend/server.py\n")


# ------------------------------------------------------------------
def main() -> None:
    print("=== KR&BR backend setup ===")
    cfg = ensure_env_and_keys()
    print(f"[i] Backend: {cfg['backend'].upper()}")
    run_schema(cfg)
    seed_admin(cfg)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
