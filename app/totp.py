"""
TOTP (Time-based One-Time Password) module for 2FA.

v2.3: Implements RFC 6238 TOTP compatible with Google Authenticator,
Authy, 1Password, etc. Uses HMAC-SHA1 with 30-second time step and
6-digit codes.

Storage:
    Per-user TOTP secret is stored encrypted in ``mgmt_users.totp_secret``
    column (added via migration). The secret is encrypted with the
    same Fernet key used for shell-projet env vars
    (``SHELL_PROJET_ENCRYPTION_KEY``) — falling back to JWT_SECRET_KEY
    if the projet key is unset.

API surface:
    generate_secret()              → (secret, otpauth_uri)
    verify_code(secret, code)      → bool
    enable_for_user(user_id, secret)
    disable_for_user(user_id)
    is_enabled_for_user(user_id)   → bool
    verify_for_user(user_id, code) → bool

REST endpoints live in app/routers/auth.py (login flow).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets as _secrets
import struct
import time
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ── TOTP parameters (RFC 6238 defaults, Google Authenticator compatible) ──

TOTP_PERIOD = 30        # seconds
TOTP_DIGITS = 6
TOTP_ALGO = hashlib.sha1
TOTP_WINDOW = 1         # accept codes from current + previous + next step


# ── Secret encryption ──────────────────────────────────────────────────

def _get_master_key() -> str:
    """Return the master key used for TOTP-secret encryption.

    Priority (matches auth_jwt._get_jwt_secret so the JWT secret and the
    TOTP encryption key are the same value):

    1. ``settings.SHELL_PROJET_ENCRYPTION_KEY`` (preferred — dedicated key)
    2. ``settings.JWT_SECRET_KEY``
    3. The auto-generated persisted secret at ``~/.samba-api-jwt-secret``
       (created by auth_jwt._get_jwt_secret on first run)
    4. A freshly generated key persisted to ``~/.samba-api-totp-key``

    This ensures the function NEVER raises just because env vars are empty —
    matching the JWT side which also auto-generates. The previous version
    crashed with "set SHELL_PROJET_ENCRYPTION_KEY or JWT_SECRET_KEY in .env"
    on deployments where neither was configured.
    """
    from app.config import get_settings
    s = get_settings()

    # 1. Dedicated encryption key
    raw = getattr(s, "SHELL_PROJET_ENCRYPTION_KEY", "") or ""
    if raw:
        return raw

    # 2. JWT_SECRET_KEY from settings
    raw = getattr(s, "JWT_SECRET_KEY", "") or ""
    if raw:
        return raw

    # 3. Use the same auto-generated JWT secret that auth_jwt persists.
    #    This guarantees TOTP secrets are decryptable across restarts even
    #    when the operator never set JWT_SECRET_KEY explicitly.
    try:
        from app.auth_jwt import _get_jwt_secret
        return _get_jwt_secret(s)
    except Exception:
        pass

    # 4. Last-resort fallback: generate and persist our own key
    import os as _os
    import secrets as _secrets
    fallback_path = _os.path.join(
        _os.environ.get("HOME", "/tmp"), ".samba-api-totp-key"
    )
    try:
        if _os.path.isfile(fallback_path):
            with open(fallback_path, "r") as fh:
                persisted = fh.read().strip()
                if persisted:
                    return persisted
    except OSError:
        pass

    new_key = _secrets.token_urlsafe(48)
    try:
        with open(fallback_path, "w") as fh:
            fh.write(new_key)
        _os.chmod(fallback_path, 0o600)
        logger.info("[totp] Generated new master key at %s", fallback_path)
    except OSError as exc:
        logger.warning("[totp] Could not persist master key: %s", exc)
    return new_key


def _get_fernet():
    """Get a Fernet cipher for encrypting TOTP secrets at rest."""
    from cryptography.fernet import Fernet
    raw = _get_master_key()
    # Derive a 32-byte URL-safe key from the raw secret (Fernet requires
    # exactly 32 url-safe base64-encoded bytes)
    key = base64.urlsafe_b64encode(
        hashlib.sha256(raw.encode("utf-8")).digest()
    )
    return Fernet(key)


def _encrypt_secret(plaintext: str) -> str:
    try:
        return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        logger.error("[totp] encrypt failed: %s", exc)
        raise


def _decrypt_secret(ciphertext: str) -> str:
    try:
        return _get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        logger.error("[totp] decrypt failed: %s", exc)
        raise


# ── Core TOTP algorithm ────────────────────────────────────────────────

def _b32_encode_secret(raw: bytes) -> str:
    """Base32-encode a raw secret (Google Authenticator format)."""
    return base64.b32encode(raw).decode("utf-8").rstrip("=")


def _b32_decode_secret(b32: str) -> bytes:
    """Decode a Base32 secret (handle missing padding)."""
    pad = "=" * (-len(b32) % 8)
    return base64.b32decode((b32 + pad).upper())


def generate_secret() -> str:
    """Generate a new random 20-byte TOTP secret in Base32."""
    return _b32_encode_secret(_secrets.token_bytes(20))


def build_otpauth_uri(secret: str, username: str, issuer: str = "SambaAD") -> str:
    """Build an otpauth:// URI for QR-code generation."""
    from urllib.parse import quote, urlencode
    label = f"{issuer}:{username}"
    params = urlencode({
        "secret": secret,
        "issuer": issuer,
        "algorithm": "SHA1",
        "digits": TOTP_DIGITS,
        "period": TOTP_PERIOD,
    })
    return f"otpauth://totp/{quote(label)}?{params}"


def _hotp(secret_b32: str, counter: int) -> int:
    """HOTP per RFC 4226."""
    key = _b32_decode_secret(secret_b32)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, TOTP_ALGO).digest()
    offset = h[-1] & 0x0F
    binary = struct.unpack(">I", h[offset:offset + 4])[0] & 0x7FFFFFFF
    return binary % (10 ** TOTP_DIGITS)


def verify_code(secret_b32: str, code: str) -> bool:
    """Verify a 6-digit TOTP code with a ±1 step window.

    Uses constant-time comparison to prevent timing attacks.
    """
    if not code or not code.isdigit() or len(code) != TOTP_DIGITS:
        return False
    try:
        code_int = int(code)
    except ValueError:
        return False
    now = int(time.time() // TOTP_PERIOD)
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        expected = _hotp(secret_b32, now + offset)
        if hmac.compare_digest(str(expected).zfill(TOTP_DIGITS),
                                str(code_int).zfill(TOTP_DIGITS)):
            return True
    return False


# ── DB-backed per-user TOTP state ──────────────────────────────────────

def _get_conn():
    from app.mgmt_db import _get_conn as _mgmt_get_conn
    return _mgmt_get_conn()


def _return_conn(conn):
    from app.mgmt_db import _return_conn as _mgmt_return_conn
    _mgmt_return_conn(conn)


def enable_for_user(user_id: int, secret_b32: str) -> None:
    """Store (encrypted) TOTP secret for a user, marking them 2FA-enabled."""
    enc = _encrypt_secret(secret_b32)
    from app.mgmt_db import _now_iso
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mgmt_users SET totp_secret = %s, totp_enabled = TRUE, "
                "updated_at = %s WHERE id = %s",
                (enc, _now_iso(), user_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def disable_for_user(user_id: int) -> None:
    from app.mgmt_db import _now_iso
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mgmt_users SET totp_secret = NULL, totp_enabled = FALSE, "
                "updated_at = %s WHERE id = %s",
                (_now_iso(), user_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _return_conn(conn)


def is_enabled_for_user(user_id: int) -> bool:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT totp_enabled FROM mgmt_users WHERE id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            return bool(row and row[0])
    finally:
        _return_conn(conn)


def get_secret_for_user(user_id: int) -> Optional[str]:
    """Return the decrypted TOTP secret for a user (or None if not set)."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT totp_secret FROM mgmt_users WHERE id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            if not row or not row[0]:
                return None
            return _decrypt_secret(row[0])
    finally:
        _return_conn(conn)


def verify_for_user(user_id: int, code: str) -> bool:
    """Verify a TOTP code for a given user."""
    secret = get_secret_for_user(user_id)
    if not secret:
        return False
    return verify_code(secret, code)


# ── Migration hook ─────────────────────────────────────────────────────

TOTP_SCHEMA = """
ALTER TABLE mgmt_users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE mgmt_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
"""


def ensure_schema() -> None:
    from app.mgmt_db import _get_conn, _return_conn
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            for stmt in TOTP_SCHEMA.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt)
        conn.commit()
    except Exception:
        conn.rollback()
        logger.debug("[totp] schema migration failed", exc_info=True)
    finally:
        _return_conn(conn)
