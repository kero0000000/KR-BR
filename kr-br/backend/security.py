"""
security.py — KR&BR cryptographic & anti-abuse helpers.

Layers:
  * Passwords  -> bcrypt (salted, cost 12). Never reversible.
  * Card data  -> AES-256-GCM authenticated encryption at rest.
  * Card PAN   -> extra HMAC-SHA256 digest for blind lookup / dedup.
  * Sessions  -> HMAC-signed stateless auth tokens (uid + role + expiry).
  * Brute force -> per-IP sliding-window limiter + DB-backed account lockout.

All keys are read from environment variables (loaded by server.py via
python-dotenv). Keys are NEVER hard-coded.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from collections import defaultdict, deque
from typing import Optional

import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag


# ------------------------------------------------------------------
#  Key loading (called once at startup by server.py after dotenv)
# ------------------------------------------------------------------
_AES_KEY: Optional[bytes] = None      # 32 raw bytes -> AES-256
_HMAC_KEY: Optional[bytes] = None     # raw bytes -> blind PAN lookup
_SIGN_KEY: Optional[bytes] = None     # raw bytes -> token signing


class SecurityConfigError(RuntimeError):
    pass


def init_keys() -> None:
    """Load and validate all secret keys from the environment."""
    global _AES_KEY, _HMAC_KEY, _SIGN_KEY

    aes_b64 = os.getenv("AES_KEY", "").strip()
    hmac_b64 = os.getenv("CARD_HMAC_KEY", "").strip()
    sign_b64 = os.getenv("FLASK_SECRET_KEY", "").strip()

    if not aes_b64 or not hmac_b64 or not sign_b64:
        raise SecurityConfigError(
            "Missing encryption keys. Run:  python backend/setup.py\n"
            "It generates AES_KEY / CARD_HMAC_KEY / FLASK_SECRET_KEY into .env"
        )

    try:
        _AES_KEY = base64.urlsafe_b64decode(aes_b64)
        _HMAC_KEY = base64.urlsafe_b64decode(hmac_b64)
        _SIGN_KEY = base64.urlsafe_b64decode(sign_b64)
    except Exception as exc:
        raise SecurityConfigError(f"Keys are not valid base64: {exc}")

    if len(_AES_KEY) != 32:
        raise SecurityConfigError(
            "AES_KEY must decode to exactly 32 bytes (AES-256). "
            "Regenerate it with setup.py."
        )
    if len(_HMAC_KEY) < 16:
        raise SecurityConfigError("CARD_HMAC_KEY must be at least 16 bytes.")
    if len(_SIGN_KEY) < 16:
        raise SecurityConfigError("FLASK_SECRET_KEY must be at least 16 bytes.")


# ------------------------------------------------------------------
#  Password hashing (bcrypt)
# ------------------------------------------------------------------
BCOST = 12

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCOST)).decode("utf-8")

def verify_password(password: str, hashed: str) -> bool:
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------------
#  Field-level encryption (AES-256-GCM)
#  Stored token = base64url( 12-byte nonce || ciphertext || 16-byte tag )
# ------------------------------------------------------------------
def encrypt_field(plaintext) -> Optional[str]:
    if plaintext is None:
        return None
    text = str(plaintext)
    if text == "":
        return None
    aes = AESGCM(_AES_KEY)
    nonce = os.urandom(12)                       # 96-bit nonce, fresh per value
    ct = aes.encrypt(nonce, text.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode("ascii")

def decrypt_field(token) -> Optional[str]:
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
        if len(raw) < 13:
            return None
        nonce, ct = raw[:12], raw[12:]
        return AESGCM(_AES_KEY).decrypt(nonce, ct, None).decode("utf-8")
    except (InvalidTag, ValueError, KeyError):
        # Tampered or wrong key — never leak, just treat as absent.
        return None


# ------------------------------------------------------------------
#  Card helpers (PAN normalisation, HMAC, masking, brand)
# ------------------------------------------------------------------
_NON_DIGIT = re.compile(r"\D")

def _digits(value: str) -> str:
    return _NON_DIGIT.sub("", str(value or ""))

def card_hmac(number: str) -> Optional[str]:
    """Blind, non-reversible digest of the PAN for lookup/dedup."""
    digits = _digits(number)
    if not digits:
        return None
    return hmac.new(_HMAC_KEY, digits.encode("utf-8"), hashlib.sha256).hexdigest()

def card_last4(number: str) -> str:
    digits = _digits(number)
    return digits[-4:] if len(digits) >= 4 else ""

def mask_card(number: str) -> str:
    last = card_last4(number)
    return f"**** **** **** {last}" if last else "**** **** **** ****"

def card_brand(number: str) -> str:
    d = _digits(number)
    if not d:
        return ""
    if d.startswith("4"):
        return "Visa"
    two = int(d[:2]) if len(d) >= 2 else 0
    four = int(d[:4]) if len(d) >= 4 else 0
    if 51 <= two <= 55 or 2221 <= four <= 2720:
        return "Mastercard"
    if d.startswith(("34", "37")):
        return "Amex"
    if d.startswith("6"):
        return "Discover"
    return "Card"


# ------------------------------------------------------------------
#  Auth tokens (stateless, HMAC-signed)
#  payload = base64url({"uid":..,"adm":bool,"exp":epoch})
#  token   = payload "." base64url(hmac_sha256(payload))
# ------------------------------------------------------------------
def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))

def make_token(uid: int, is_admin: bool, ttl_seconds: int = 7 * 24 * 3600) -> str:
    payload = _b64u(f'{{"uid":{uid},"adm":{1 if is_admin else 0},"exp":{int(time.time()) + ttl_seconds}}}'.encode())
    sig = hmac.new(_SIGN_KEY, payload.encode("ascii"), hashlib.sha256).digest()
    return f"{payload}.{_b64u(sig)}"

def verify_token(token: str) -> Optional[dict]:
    """Return {"uid":..,"adm":bool} if valid & unexpired, else None."""
    if not token or "." not in token:
        return None
    payload_b64, sig_b64 = token.split(".", 1)
    expected = hmac.new(_SIGN_KEY, payload_b64.encode("ascii"), hashlib.sha256).digest()
    try:
        provided = _b64u_decode(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected, provided):
        return None
    try:
        import json
        data = json.loads(_b64u_decode(payload_b64))
    except Exception:
        return None
    if not isinstance(data, dict) or "exp" not in data or "uid" not in data:
        return None
    if int(data.get("exp", 0)) < time.time():
        return None
    return {"uid": int(data["uid"]), "adm": bool(data.get("adm", 0))}


# ------------------------------------------------------------------
#  Per-IP sliding-window rate limiter (in-memory, process-local)
# ------------------------------------------------------------------
_LOGIN_WINDOW = 60          # seconds
_LOGIN_MAX = 8              # attempts per IP per window
_GEN_WINDOW = 60
_GEN_MAX = 30               # generic endpoint limiter
_hits: dict[str, deque] = defaultdict(deque)


def _sliding_hit(key: str, max_hits: int, window: int) -> bool:
    """Return True if `key` has already hit `max_hits` within the window."""
    now = time.time()
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= max_hits:
        return True
    q.append(now)
    return False

def login_rate_limited(ip: str) -> bool:
    return _sliding_hit(f"login:{ip}", _LOGIN_MAX, _LOGIN_WINDOW)

def generic_rate_limited(ip: str) -> bool:
    return _sliding_hit(f"gen:{ip}", _GEN_MAX, _GEN_WINDOW)
