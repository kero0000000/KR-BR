"""
KR&BR — Flask backend (MySQL + encryption + hardening).

Data model: a SINGLE MySQL table `users` that holds all account data for
buyers, sellers and the admin, AND their bank-card data on the same rows.
Sensitive fields are encrypted at the application layer (see security.py).

Security upgrades over the previous SQLite prototype:
  * bcrypt password hashing (was sha256)
  * AES-256-GCM authenticated encryption of card number / expiry / CVV / name
  * HMAC digest of the card number for blind lookup / duplicate detection
  * HMAC-signed stateless auth tokens (was trusting localStorage / hardcoded admin)
  * Per-IP rate limiting + DB-backed account lockout after failed logins
  * Strict input validation, parameterised queries, security headers
  * Secrets loaded from .env (never hard-coded), secrets never returned to clients

Run once:   python backend/setup.py
Then:       python backend/server.py
"""
from __future__ import annotations

import os
import re
import sqlite3
import traceback
from datetime import datetime, timedelta
from functools import wraps

import pymysql
import pymysql.cursors
from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS
from dotenv import load_dotenv

import security as sec

# ------------------------------------------------------------------
#  Config + keys
# ------------------------------------------------------------------
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.dirname(BACKEND_DIR)   # kr-br/ holds index.html etc.

load_dotenv(os.path.join(BACKEND_DIR, ".env"))
sec.init_keys()                                  # validates AES/HMAC/sign keys

MYSQL = dict(
    host=os.getenv("MYSQL_HOST", "localhost"),
    port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.getenv("MYSQL_USER", "root"),
    password=os.getenv("MYSQL_PASSWORD", ""),
    database=os.getenv("MYSQL_DATABASE", "kr_br"),
    charset="utf8mb4",
)

# ---- Backend selection ----
# DB_BACKEND env overrides. Otherwise use MySQL when a password is set,
# else fall back to SQLite so the app runs with zero setup (same encryption).
DB_BACKEND = os.getenv("DB_BACKEND", "").strip().lower()
if DB_BACKEND not in ("mysql", "sqlite"):
    DB_BACKEND = "mysql" if os.getenv("MYSQL_PASSWORD", "").strip() else "sqlite"
_SQLITE_PATH = os.path.join(BACKEND_DIR, "krbr.db")

app = Flask(__name__, static_folder=None)
app.config["JSON_SORT_KEYS"] = False
CORS(app, supports_credentials=False)

# Account lockout policy
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15

# ------------------------------------------------------------------
#  DB helper
# ------------------------------------------------------------------
class _Conn:
    """Thin wrapper over a PyMySQL connection so `conn.execute(sql, args)`
    returns a DictCursor (sqlite-style shortcut used throughout this file)."""
    def __init__(self):
        self._conn = pymysql.connect(**MYSQL, autocommit=False,
                                     cursorclass=pymysql.cursors.DictCursor)
    def execute(self, sql, args=()):
        cur = self._conn.cursor()
        cur.execute(sql, args)
        return cur
    def commit(self):
        return self._conn.commit()
    def rollback(self):
        return self._conn.rollback()
    def close(self):
        return self._conn.close()


class _SQLiteConn:
    """Same interface as _Conn, backed by a local SQLite file (zero-setup).
    %s placeholders are translated to ?; rows are returned as plain dicts so
    the rest of the code (row.get(...)/row['x']) works unchanged."""
    def __init__(self):
        self._conn = sqlite3.connect(_SQLITE_PATH)
        self._conn.row_factory = lambda c, r: {k: r[i] for i, k in enumerate(r.keys())}
    def execute(self, sql, args=()):
        return self._conn.execute(sql.replace("%s", "?"), args)
    def commit(self):
        return self._conn.commit()
    def rollback(self):
        return self._conn.rollback()
    def close(self):
        return self._conn.close()


def get_db():
    return _Conn() if DB_BACKEND == "mysql" else _SQLiteConn()


# ------------------------------------------------------------------
#  Schema bootstrap (idempotent) — creates the single `users` table
# ------------------------------------------------------------------
def ensure_schema():
    schema_file = "schema.sql" if DB_BACKEND == "mysql" else "schema_sqlite.sql"
    sql = open(os.path.join(BACKEND_DIR, schema_file), encoding="utf-8").read()
    # Strip full-line comments, then run each statement separately.
    cleaned = "\n".join(ln for ln in sql.splitlines() if not ln.strip().startswith("--"))
    conn = get_db()
    try:
        for stmt in cleaned.split(";"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(stmt)
        conn.commit()
    finally:
        conn.close()


# ------------------------------------------------------------------
#  Datetime helpers (work for both MySQL datetime and SQLite TEXT)
# ------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

def _now_iso_delta(minutes: int) -> str:
    return (datetime.utcnow() + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")

def _to_dt(v):
    """Normalise a DB value (MySQL datetime or SQLite TEXT) to a datetime."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v)
    if "T" not in s:
        s = s.replace(" ", "T", 1)
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ------------------------------------------------------------------
#  Auth helper (signed token)
# ------------------------------------------------------------------
def client_ip() -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def auth_user(require_admin: bool = False):
    """Resolve the authenticated user from the X-Auth-Token header.
    Returns (user_row, error_response). On success error_response is None."""
    token = request.headers.get("X-Auth-Token", "")
    claims = sec.verify_token(token)
    if not claims:
        return None, (jsonify({"error": "غير مصرح — يجب تسجيل الدخول"}), 401)
    if require_admin and not claims["adm"]:
        return None, (jsonify({"error": "هذه الصلاحية للمدير فقط"}), 403)

    conn = get_db()
    try:
        user = conn.execute("SELECT * FROM users WHERE id=%s", (claims["uid"],)).fetchone()
    finally:
        conn.close()
    if not user:
        return None, (jsonify({"error": "الحساب غير موجود"}), 401)
    return user, None


def require_token(admin: bool = False):
    """Flask decorator that injects g.user from a valid token."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user, err = auth_user(require_admin=admin)
            if err:
                return err
            g.user = user
            return fn(*args, **kwargs)
        return wrapper
    return deco


# ------------------------------------------------------------------
#  Output sanitisation — never leak hashes or ciphertext to clients
# ------------------------------------------------------------------
def public_user(row) -> dict:
    if not row:
        return {}
    has_card = bool(row.get("card_number_enc"))
    visa = None
    if has_card:
        # Mask from the stored last-4 only — we never decrypt the full PAN
        # just to display it.
        last4 = row.get("card_last4") or ""
        visa = {
            "number": f"**** **** **** {last4}" if last4 else "**** **** **** ****",
            "last4": last4,
            "expiry": sec.decrypt_field(row.get("card_expiry_enc")) or "",
            "name": sec.decrypt_field(row.get("card_holder_enc")) or "",
            "brand": row.get("card_brand") or "",
        }
    created = _to_dt(row.get("created_at"))
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "type": row["account_type"],
        "balance": float(row.get("balance") or 0),
        "has_card": has_card,
        "visa": visa,
        "created_at": created.isoformat() if created else "",
    }


# ------------------------------------------------------------------
#  Input validation (defence in depth alongside parameterised queries)
# ------------------------------------------------------------------
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_BAD_CHARS = re.compile(r"(--|/\*|\*/|;|\b(or|union|select|insert|update|delete|drop|exec|script)\b)", re.I)


def looks_malicious(text: str) -> bool:
    return bool(_BAD_CHARS.search(str(text or "")))


def valid_card_number(number: str) -> bool:
    digits = re.sub(r"\D", "", str(number or ""))
    return digits.isdigit() and 13 <= len(digits) <= 19 and _luhn(digits)


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def log_security(conn, event_type, message, ip=""):
    try:
        # Fire-and-forget; never let logging break the request.
        conn.execute(
            "INSERT INTO security_log(event_type,message,ip) VALUES (%s,%s,%s)",
            (event_type, message[:500], ip or client_ip()),
        )
    except Exception:
        # security_log table does not exist in the single-table design; ignore.
        pass


# ------------------------------------------------------------------
#  Security headers on every response
# ------------------------------------------------------------------
@app.after_request
def add_security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ------------------------------------------------------------------
#  Serve frontend (so the whole app runs on one origin if desired)
# ------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    # Do not let path traversal escape the frontend dir.
    full = os.path.realpath(os.path.join(FRONTEND_DIR, path))
    if not full.startswith(os.path.realpath(FRONTEND_DIR)):
        return ("Forbidden", 403)
    return send_from_directory(FRONTEND_DIR, path)


# ------------------------------------------------------------------
#  Health
# ------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify({"ok": True, "service": "kr-br", "db": MYSQL["database"]})


# ------------------------------------------------------------------
#  Auth
# ------------------------------------------------------------------
@app.route("/api/register", methods=["POST"])
def register():
    ip = client_ip()
    if sec.generic_rate_limited(ip):
        return jsonify({"error": "طلبات كثيرة جداً، حاول لاحقاً"}), 429

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    pw = data.get("password") or ""
    utype = (data.get("type") or "buyer").strip().lower()

    if not name or not email or not pw:
        return jsonify({"error": "جميع الحقول مطلوبة"}), 400
    if not _EMAIL_RE.match(email):
        return jsonify({"error": "البريد الإلكتروني غير صحيح"}), 400
    if utype not in ("buyer", "seller"):
        return jsonify({"error": "نوع الحساب غير صحيح"}), 400
    if len(pw) < 8:
        return jsonify({"error": "كلمة المرور يجب أن تكون 8 أحرف على الأقل"}), 400
    if looks_malicious(name) or looks_malicious(email):
        return jsonify({"error": "تم رفض الطلب لأسباب أمنية"}), 400

    conn = get_db()
    try:
        if conn.execute("SELECT id FROM users WHERE email=%s", (email,)).fetchone():
            return jsonify({"error": "هذا البريد الإلكتروني مسجل مسبقاً"}), 409
        conn.execute(
            "INSERT INTO users(name,email,password_hash,account_type) VALUES(%s,%s,%s,%s)",
            (name, email, sec.hash_password(pw), utype),
        )
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE email=%s", (email,)).fetchone()
        token = sec.make_token(user["id"], is_admin=False)
        return jsonify({"success": True, "token": token, "user": public_user(user)})
    except Exception:
        traceback.print_exc()
        conn.rollback()
        return jsonify({"error": "خطأ في الخادم"}), 500
    finally:
        conn.close()


@app.route("/api/login", methods=["POST"])
def login():
    ip = client_ip()
    if sec.login_rate_limited(ip):
        return jsonify({"error": "محاولات دخول كثيرة من جهازك، حاول بعد دقيقة"}), 429

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    pw = data.get("password") or ""

    if not email or not pw:
        return jsonify({"error": "البريد الإلكتروني وكلمة المرور مطلوبان"}), 400
    if looks_malicious(email):
        return jsonify({"error": "تم رفض الطلب لأسباب أمنية"}), 400

    conn = get_db()
    try:
        user = conn.execute("SELECT * FROM users WHERE email=%s", (email,)).fetchone()
        now = datetime.utcnow()

        # Don't reveal whether the email exists. If not found, run a dummy
        # bcrypt check to keep timing constant-ish.
        if not user:
            sec.verify_password(pw, "$2b$12$" + "x" * 53)
            return jsonify({"error": "البريد الإلكتروني أو كلمة المرور غير صحيحة"}), 401

        if user["status"] == "suspended":
            return jsonify({"error": "هذا الحساب موقوف"}), 403
        locked = _to_dt(user["locked_until"])
        if locked and locked > now:
            mins = int((locked - now).total_seconds() // 60) + 1
            return jsonify({"error": f"الحساب مقفل مؤقتاً، حاول بعد {mins} دقيقة"}), 423

        if not sec.verify_password(pw, user["password_hash"]):
            fails = user["failed_login_attempts"] + 1
            if fails >= MAX_FAILED_LOGINS:
                conn.execute(
                    "UPDATE users SET failed_login_attempts=%s, locked_until=%s WHERE id=%s",
                    (fails, _now_iso_delta(LOCK_MINUTES), user["id"]),
                )
            else:
                conn.execute(
                    "UPDATE users SET failed_login_attempts=%s WHERE id=%s", (fails, user["id"]),
                )
            conn.commit()
            return jsonify({"error": "البريد الإلكتروني أو كلمة المرور غير صحيحة"}), 401

        # Success — reset counters
        conn.execute(
            "UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login_at=%s, last_login_ip=%s WHERE id=%s",
            (_now_iso(), ip, user["id"]),
        )
        conn.commit()
        token = sec.make_token(user["id"], is_admin=(user["account_type"] == "admin"))
        return jsonify({"success": True, "token": token, "user": public_user(user)})
    except Exception:
        traceback.print_exc()
        conn.rollback()
        return jsonify({"error": "خطأ في الخادم"}), 500
    finally:
        conn.close()


# ------------------------------------------------------------------
#  User profile + card (Visa)
# ------------------------------------------------------------------
@app.route("/api/user/<int:uid>", methods=["GET"])
@require_token()
def get_user(uid):
    # A user may only read their own profile; an admin may read anyone.
    if g.user["id"] != uid and g.user["account_type"] != "admin":
        return jsonify({"error": "غير مصرح"}), 403
    if g.user["id"] == uid:
        return jsonify(public_user(g.user))
    conn = get_db()
    try:
        other = conn.execute("SELECT * FROM users WHERE id=%s", (uid,)).fetchone()
    finally:
        conn.close()
    if not other:
        return jsonify({"error": "المستخدم غير موجود"}), 404
    return jsonify(public_user(other))


@app.route("/api/user/<int:uid>/visa", methods=["POST"])
@require_token()
def save_visa(uid):
    if g.user["id"] != uid and g.user["account_type"] != "admin":
        return jsonify({"error": "غير مصرح"}), 403

    data = request.get_json(silent=True) or {}
    number = re.sub(r"\D", "", data.get("number") or "")
    expiry = (data.get("expiry") or "").strip()
    cvv = (data.get("cvv") or "").strip()
    name = (data.get("name") or "").strip()

    # If the caller sends empty fields, treat as "keep existing".
    if not number and not expiry and not cvv and not name:
        return jsonify({"success": True, "user": public_user(g.user)})

    if not valid_card_number(number):
        return jsonify({"error": "رقم البطاقة غير صحيح"}), 400
    if not re.fullmatch(r"\d{2}/\d{2}", expiry):
        return jsonify({"error": "تاريخ الانتهاء غير صحيح (MM/YY)"}), 400
    if not (cvv.isdigit() and 3 <= len(cvv) <= 4):
        return jsonify({"error": "CVV غير صحيح"}), 400
    if len(name) < 2 or looks_malicious(name):
        return jsonify({"error": "اسم حامل البطاقة غير صحيح"}), 400

    # Duplicate card (by blind HMAC) cannot belong to a different account.
    pan_hmac = sec.card_hmac(number)

    conn = get_db()
    try:
        owner = conn.execute(
            "SELECT id FROM users WHERE card_number_hmac=%s", (pan_hmac,)
        ).fetchone()
        if owner and owner["id"] != uid:
            return jsonify({"error": "هذه البطاقة مرتبطة بحساب آخر"}), 409

        conn.execute(
            """UPDATE users SET
                 card_number_enc=%s, card_number_hmac=%s, card_last4=%s, card_brand=%s,
                 card_expiry_enc=%s, card_cvv_enc=%s, card_holder_enc=%s, card_updated_at=%s
               WHERE id=%s""",
            (
                sec.encrypt_field(number), pan_hmac, sec.card_last4(number), sec.card_brand(number),
                sec.encrypt_field(expiry), sec.encrypt_field(cvv), sec.encrypt_field(name),
                _now_iso(), uid,
            ),
        )
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE id=%s", (uid,)).fetchone()
        return jsonify({"success": True, "user": public_user(user)})
    except Exception:
        traceback.print_exc()
        conn.rollback()
        return jsonify({"error": "خطأ في الخادم"}), 500
    finally:
        conn.close()


# ------------------------------------------------------------------
#  Admin: users list + stats + delete
# ------------------------------------------------------------------
@app.route("/api/admin/users", methods=["GET"])
@require_token(admin=True)
def admin_users():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM users ORDER BY created_at DESC"
        ).fetchall()
    finally:
        conn.close()
    return jsonify({
        "users": [public_user(r) for r in rows],
        "count": len(rows),
        "buyers": sum(1 for r in rows if r["account_type"] == "buyer"),
        "sellers": sum(1 for r in rows if r["account_type"] == "seller"),
        "with_card": sum(1 for r in rows if r["card_number_enc"]),
    })


@app.route("/api/admin/users/<int:uid>", methods=["DELETE"])
@require_token(admin=True)
def admin_delete_user(uid):
    if g.user["id"] == uid:
        return jsonify({"error": "لا يمكن حذف حساب المدير الحالي"}), 400
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM users WHERE id=%s", (uid,))
        conn.commit()
        return jsonify({"success": True, "deleted": cur.rowcount})
    except Exception:
        traceback.print_exc()
        conn.rollback()
        return jsonify({"error": "خطأ في الخادم"}), 500
    finally:
        conn.close()


# ------------------------------------------------------------------
#  Entry point
# ------------------------------------------------------------------
if __name__ == "__main__":
    host = os.getenv("API_HOST", "127.0.0.1")
    port = int(os.getenv("API_PORT", "5000"))
    ensure_schema()
    print(f"[KR&BR] API on http://{host}:{port}  | backend={DB_BACKEND}"
          + (f"  (DB: {MYSQL['database']}@{MYSQL['host']})" if DB_BACKEND == "mysql"
             else f"  (file: {os.path.basename(_SQLITE_PATH)})"))
    app.run(host=host, port=port, debug=False)
