"""
Env-variable encryption module — AES-256 (via Fernet) for sensitive keys.

v2.3: Provides transparent encryption-at-rest for env keys matching
``*PASSWORD*``, ``*PASSWD*``, ``*SECRET*``, ``*API_KEY*``, ``*TOKEN*``,
``*PRIVATE_KEY*``. Encryption is opt-in per key via the .env file
itself — when an encrypted value is written back to .env it gets a
``enc::`` prefix so the loader knows to decrypt on read.

Master key:
    Derived from ``SHELL_PROJET_ENCRYPTION_KEY`` (preferred) or
    ``JWT_SECRET_KEY`` via SHA-256, then Base64-urlsafe-encoded to
    produce a 32-byte Fernet key.

Storage format:
    Plain value:    ``SAMBA_API_KEY=abc123``
    Encrypted:      ``SAMBA_API_KEY=enc::gAAAAA...``

The .env loader in app.config.Settings.model_post_init() transparently
decrypts ``enc::`` values at startup so existing code that reads
``settings.SAMBA_API_KEY`` sees the plaintext value.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

ENCRYPTION_PREFIX = "enc::"

# Keys matching this regex are considered sensitive and will be encrypted
SENSITIVE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"PASSWORD", r"PASSWD", r"SECRET", r"API_KEY", r"APIKEY",
        r"TOKEN", r"PRIVATE_KEY", r"PRIVATEKEY",
        r"CREDENTIALS_PASSWORD", r"SHELL_PROJET_ENCRYPTION_KEY",
        r"JWT_SECRET_KEY",
    )
]


def is_sensitive_key(key: str) -> bool:
    """Return True if the key name suggests a sensitive value."""
    return any(p.search(key) for p in SENSITIVE_PATTERNS)


def _get_fernet():
    """Get a Fernet cipher using the configured master key.

    Priority (same as app.totp._get_master_key):
    1. ``settings.SHELL_PROJET_ENCRYPTION_KEY``
    2. ``settings.JWT_SECRET_KEY``
    3. Auto-generated persisted secret from auth_jwt._get_jwt_secret
    4. A freshly generated key persisted to ``~/.samba-api-env-key``
    """
    from cryptography.fernet import Fernet
    from app.config import get_settings
    s = get_settings()

    raw = getattr(s, "SHELL_PROJET_ENCRYPTION_KEY", "") or ""
    if not raw:
        raw = getattr(s, "JWT_SECRET_KEY", "") or ""
    if not raw:
        # Reuse the same auto-generated JWT secret
        try:
            from app.auth_jwt import _get_jwt_secret
            raw = _get_jwt_secret(s)
        except Exception:
            pass
    if not raw:
        # Last-resort: generate and persist our own key
        import os as _os
        import secrets as _secrets
        fallback_path = _os.path.join(
            _os.environ.get("HOME", "/tmp"), ".samba-api-env-key"
        )
        try:
            if _os.path.isfile(fallback_path):
                with open(fallback_path, "r") as fh:
                    raw = fh.read().strip()
            if not raw:
                raw = _secrets.token_urlsafe(48)
                with open(fallback_path, "w") as fh:
                    fh.write(raw)
                _os.chmod(fallback_path, 0o600)
        except OSError:
            pass
    if not raw:
        raise RuntimeError(
            "Cannot derive env-encryption key: no master key available. "
            "Set SHELL_PROJET_ENCRYPTION_KEY or JWT_SECRET_KEY in .env."
        )
    key = base64.urlsafe_b64encode(hashlib.sha256(raw.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext value and return ``enc::<ciphertext>``."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(ENCRYPTION_PREFIX):
        return plaintext  # already encrypted
    try:
        ct = _get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")
        return ENCRYPTION_PREFIX + ct
    except Exception as exc:
        logger.error("[env_enc] encrypt failed: %s", exc)
        raise


def decrypt_value(value: str) -> str:
    """Decrypt an ``enc::<ciphertext>`` value, or return the input as-is."""
    if not value or not value.startswith(ENCRYPTION_PREFIX):
        return value
    ct = value[len(ENCRYPTION_PREFIX):]
    try:
        return _get_fernet().decrypt(ct.encode("utf-8")).decode("utf-8")
    except Exception as exc:
        logger.error("[env_enc] decrypt failed: %s", exc)
        # Return raw value as fallback — better than crashing the app
        return value


def is_encrypted(value: str) -> bool:
    """Check whether a stored value is in encrypted form."""
    return bool(value) and value.startswith(ENCRYPTION_PREFIX)


def maybe_decrypt_keyvalue(key: str, value: str) -> str:
    """If the value is encrypted, decrypt it; otherwise return as-is.

    Used by .env loaders to transparently decrypt on read.
    """
    if is_encrypted(value):
        return decrypt_value(value)
    return value


def maybe_encrypt_keyvalue(key: str, value: str, force: bool = False) -> str:
    """If the key is sensitive and the value is not already encrypted,
    encrypt it. Use ``force=True`` to encrypt regardless of key name.
    """
    if not value or is_encrypted(value):
        return value
    if force or is_sensitive_key(key):
        return encrypt_value(value)
    return value
