"""
Caching layer for API responses.

Provides an in-memory TTL cache with pattern-based invalidation and
a decorator for caching GET endpoint responses.  Write operations
(POST, PUT, DELETE) automatically invalidate relevant cache entries.

v1.2.2_fix: Replaced ``cachetools.TTLCache`` internals with a manual
per-entry TTL implementation using ``dict`` + ``(value, expire_at)``
tuples.  The previous version accessed ``_TTLCache__links[key].expire``
which broke with newer ``cachetools`` versions (``_Link`` no longer
has an ``expire`` attribute, causing ``AttributeError``).
"""

from __future__ import annotations

import collections
import functools
import hashlib
import json
import logging
import threading
import time as _time
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ── Default TTLs ────────────────────────────────────────────────────────

DEFAULT_LIST_TTL: int = 0    # seconds – disabled (0 = no caching, instant UI updates)
DEFAULT_ITEM_TTL: int = 0   # seconds – disabled (0 = no caching, instant UI updates)
DEFAULT_MAX_SIZE: int = 512   # maximum cached entries


# ── ResponseCache ───────────────────────────────────────────────────────

class ResponseCache:
    """Thread-safe in-memory response cache with per-entry TTL and
    pattern-based invalidation.

    Cache keys follow the format ``{method}:{endpoint}:{params_hash}``
    so that entries can be looked up quickly and invalidated by pattern.

    Each entry is stored as ``(value, expire_at)`` where *expire_at* is
    a ``time.monotonic()`` deadline.  Expired entries are lazily pruned
    on access and periodically when the cache approaches *maxsize*.

    When ``enabled=False``, all ``get()`` calls return ``None`` and all
    ``set()`` calls are no-ops, effectively disabling caching globally.
    This ensures that ``SAMBA_CACHE_ENABLED=false`` completely prevents
    any cached data from being served.

    Parameters
    ----------
    maxsize:
        Maximum number of entries in the cache.
    default_ttl:
        Default time-to-live in seconds for entries that do not specify
        an explicit TTL.
    enabled:
        Whether the cache is active.  When ``False``, ``get()`` always
        returns ``None`` and ``set()`` is a no-op.
    """

    def __init__(
        self,
        maxsize: int = DEFAULT_MAX_SIZE,
        default_ttl: int = DEFAULT_LIST_TTL,
        enabled: bool = True,
    ) -> None:
        self._default_ttl = default_ttl
        self._maxsize = maxsize
        self._enabled = enabled
        # Internal storage: key -> (value, expire_at)
        self._store: dict[str, tuple[Any, float]] = {}
        # Ordered keys for LRU-like eviction
        self._order: collections.OrderedDict[str, None] = collections.OrderedDict()
        self._lock = threading.Lock()

    # ── Internal helpers ─────────────────────────────────────────────

    def _is_expired(self, key: str) -> bool:
        """Return True if the entry for *key* has expired."""
        entry = self._store.get(key)
        if entry is None:
            return True
        _, expire_at = entry
        return _time.monotonic() >= expire_at

    def _evict_expired(self) -> int:
        """Remove all expired entries.  Must be called with ``_lock`` held.

        Returns the number of entries removed.
        """
        now = _time.monotonic()
        expired_keys = [
            k for k, (_, expire_at) in self._store.items()
            if now >= expire_at
        ]
        for k in expired_keys:
            del self._store[k]
            self._order.pop(k, None)
        return len(expired_keys)

    def _evict_lru(self) -> None:
        """Evict the oldest entry (LRU).  Must be called with ``_lock`` held."""
        if self._order:
            oldest_key, _ = self._order.popitem(last=False)
            self._store.pop(oldest_key, None)

    # ── Key helpers ──────────────────────────────────────────────────

    @staticmethod
    def build_key(
        method: str,
        endpoint: str,
        params: Optional[dict[str, Any]] = None,
    ) -> str:
        """Construct a cache key.

        Format: ``{METHOD}:{endpoint}:{params_hash}``

        The *params_hash* is a short SHA-256 digest of the serialised
        query / body parameters so that identical requests with different
        parameter orderings still hit the same cache entry.
        """
        if params:
            # Sort keys for deterministic serialisation
            raw = json.dumps(params, sort_keys=True, default=str)
            params_hash = hashlib.sha256(raw.encode()).hexdigest()[:16]
        else:
            params_hash = "none"
        return f"{method.upper()}:{endpoint}:{params_hash}"

    # ── Core operations ──────────────────────────────────────────────

    def get(self, key: str) -> Optional[Any]:
        """Return the cached value for *key*, or ``None`` on miss / expiry.

        When the cache is disabled (``enabled=False``), always returns
        ``None`` regardless of whether an entry exists in the store.
        This provides a hard guarantee that no cached data is ever
        returned when ``SAMBA_CACHE_ENABLED=false``.
        """
        if not self._enabled:
            return None
        with self._lock:
            entry = self._store.get(key)
            if entry is not None:
                value, expire_at = entry
                if _time.monotonic() < expire_at:
                    # Cache hit — move to end for LRU ordering
                    self._order.move_to_end(key)
                    logger.debug("Cache HIT  %s", key)
                    return value
                else:
                    # Expired — remove it
                    del self._store[key]
                    self._order.pop(key, None)
            logger.debug("Cache MISS %s", key)
            return None

    def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> None:
        """Store *value* under *key* with an optional per-entry *ttl*.

        If *ttl* is ``None`` the cache-wide default TTL is used.
        Per-entry TTL is supported natively — each entry tracks its
        own expiry time independently.

        When the cache is disabled (``enabled=False``), this is a no-op.
        No data is stored, preventing any possibility of cached data
        being returned on a subsequent ``get()`` call.
        """
        if not self._enabled:
            return

        effective_ttl = ttl if ttl is not None else self._default_ttl
        expire_at = _time.monotonic() + effective_ttl

        with self._lock:
            # If key already exists, just update it
            if key in self._store:
                self._store[key] = (value, expire_at)
                self._order.move_to_end(key)
            else:
                # Make room if needed
                if len(self._store) >= self._maxsize:
                    # First try evicting expired entries
                    self._evict_expired()
                    # If still full, evict LRU
                    while len(self._store) >= self._maxsize:
                        self._evict_lru()
                self._store[key] = (value, expire_at)
                self._order[key] = None

            logger.debug("Cache SET  %s (ttl=%ds)", key, effective_ttl)

    def invalidate(self, pattern: str) -> int:
        """Remove cache entries whose keys match *pattern*.

        The pattern supports a trailing wildcard ``*``.  For example
        ``GET:/api/v1/users:*`` will invalidate all keys that start
        with ``GET:/api/v1/users:``.

        Returns the number of entries removed.
        """
        with self._lock:
            if pattern.endswith("*"):
                prefix = pattern[:-1]
                to_delete = [k for k in self._store if k.startswith(prefix)]
            else:
                to_delete = [k for k in self._store if k == pattern]

            for k in to_delete:
                del self._store[k]
                self._order.pop(k, None)

            if to_delete:
                logger.debug(
                    "Cache INVALIDATE pattern=%s removed=%d",
                    pattern,
                    len(to_delete),
                )
            return len(to_delete)

    def invalidate_all(self) -> None:
        """Clear the entire cache."""
        with self._lock:
            count = len(self._store)
            self._store.clear()
            self._order.clear()
            logger.debug("Cache INVALIDATE_ALL removed=%d", count)

    # ── Write-operation auto-invalidation ────────────────────────────

    def invalidate_for_write(self, endpoint: str) -> int:
        """Invalidate all cache entries related to *endpoint*.

        Called automatically after POST / PUT / DELETE operations.
        Invalidates both ``GET:{endpoint}:*`` and any parent collection
        endpoints.

        Fix v1.9-2: Also invalidate sub-resource paths. Cache keys use
        the format ``METHOD:ENDPOINT:PARAMS_HASH`` where ENDPOINT may be
        a collection path like ``/api/v1/computers/full``. When a write
        occurs on ``/api/v1/computers/test-pc``, the invalidation pattern
        ``GET:/api/v1/computers:*`` does NOT match
        ``GET:/api/v1/computers/full:none`` because the key has a ``/``
        after ``computers`` instead of ``:``.  This method now also tries
        ``GET:{prefix}/*:*`` patterns to cover sub-resource cache entries.

        For example, a POST to ``/api/v1/users/john/password`` will
        invalidate:
        - ``GET:/api/v1/users/john/password:*``
        - ``GET:/api/v1/users/john/*:*``
        - ``GET:/api/v1/users/john:*``
        - ``GET:/api/v1/users/*:*``
        - ``GET:/api/v1/users:*``
        """
        total_removed = 0

        # Invalidate the exact endpoint and all parent paths
        parts = endpoint.rstrip("/").split("/")
        for i in range(len(parts), 0, -1):
            prefix = "/".join(parts[:i])
            # Exact prefix match: GET:/api/v1/computers:*
            total_removed += self.invalidate(f"GET:{prefix}:*")
            # Also match sub-resource paths: GET:/api/v1/computers/*:*
            # This catches cache keys like GET:/api/v1/computers/full:none
            total_removed += self.invalidate(f"GET:{prefix}/*:*")

        return total_removed

    # ── Introspection ────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        """Return cache statistics."""
        with self._lock:
            # Count non-expired entries
            now = _time.monotonic()
            active = sum(
                1 for _, (_, expire_at) in self._store.items()
                if now < expire_at
            )
            return {
                "size": active,
                "total_stored": len(self._store),
                "maxsize": self._maxsize,
                "default_ttl": self._default_ttl,
            }


# ── CacheDecorator ──────────────────────────────────────────────────────

def cached(
    ttl: int = DEFAULT_LIST_TTL,
    key_prefix: str = "",
) -> Callable:
    """Decorator for caching FastAPI endpoint responses.

    Only caches responses to **GET** requests.  The cache key is built
    from the request method, a *key_prefix* (or the endpoint path), and
    a hash of the request query parameters.

    Usage::

        @router.get("/")
        @cached(ttl=30, key_prefix="users")
        async def list_users(...):
            ...

    Parameters
    ----------
    ttl:
        Time-to-live in seconds for cached entries.
    key_prefix:
        Explicit prefix for cache keys.  If empty the function name
        is used.
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            # Fix v1.11: Skip caching entirely when CACHE_ENABLED=False or TTL=0
            try:
                from app.config import get_settings as _get_settings
                _settings = _get_settings()
                if not _settings.CACHE_ENABLED or _settings.CACHE_TTL <= 0:
                    return await func(*args, **kwargs)
            except Exception:
                pass  # If settings unavailable, proceed with caching logic

            # Import here to avoid circular imports at module level
            from fastapi import Request

            # Try to extract the Request object from args/kwargs
            request: Optional[Request] = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            if request is None:
                request = kwargs.get("request")

            cache = get_cache()

            # Only cache GET requests
            if request is not None and request.method != "GET":
                return await func(*args, **kwargs)

            # Build cache key
            prefix = key_prefix or func.__name__
            params = {}
            if request is not None:
                # Include query params in the cache key
                params = dict(request.query_params)
                endpoint = request.url.path
            else:
                endpoint = prefix

            cache_key = ResponseCache.build_key("GET", endpoint, params if params else None)

            # Check cache
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value

            # Execute the handler
            result = await func(*args, **kwargs)

            # Store in cache (only if TTL > 0)
            if result is not None and ttl > 0:
                cache.set(cache_key, result, ttl=ttl)

            return result

        # Attach metadata for introspection
        wrapper._cached = True  # type: ignore[attr-defined]
        wrapper._cache_ttl = ttl  # type: ignore[attr-defined]
        wrapper._cache_key_prefix = key_prefix  # type: ignore[attr-defined]

        return wrapper

    return decorator


# ── Singleton ───────────────────────────────────────────────────────────

_cache_instance: Optional[ResponseCache] = None
_cache_lock = threading.Lock()


def get_cache() -> ResponseCache:
    """Return (and lazily create) the global :class:`ResponseCache` singleton.

    Fix v1.11: Reads CACHE_ENABLED and CACHE_TTL from settings to configure
    the cache. When CACHE_ENABLED=False or CACHE_TTL=0, the cache is created
    with TTL=0 so entries expire immediately (effective no-cache).
    """
    global _cache_instance
    if _cache_instance is None:
        with _cache_lock:
            # Double-checked locking
            if _cache_instance is None:
                # Read settings for cache configuration
                try:
                    from app.config import get_settings as _get_settings
                    _settings = _get_settings()
                    _ttl = _settings.CACHE_TTL if _settings.CACHE_ENABLED else 0
                    _maxsize = _settings.CACHE_MAX_SIZE
                except Exception:
                    _ttl = DEFAULT_LIST_TTL
                    _maxsize = DEFAULT_MAX_SIZE
                _enabled = bool(_settings.CACHE_ENABLED) and _settings.CACHE_TTL > 0
                _cache_instance = ResponseCache(default_ttl=_ttl, maxsize=_maxsize, enabled=_enabled)
                logger.info(
                    "ResponseCache singleton created (ttl=%ds, maxsize=%d, enabled=%s)",
                    _ttl, _maxsize, _enabled,
                )
    return _cache_instance


def reset_cache() -> None:
    """Reset the global cache singleton (useful for testing)."""
    global _cache_instance
    with _cache_lock:
        if _cache_instance is not None:
            _cache_instance.invalidate_all()
            _cache_instance = None
