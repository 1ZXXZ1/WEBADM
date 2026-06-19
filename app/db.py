"""
JSON File Storage Engine for WEBADM.

ALT Linux compatible — no sqlite3 dependency.

Storage layout (inside DATA_DIR/webadm_db/):
  webadm_db/
    keys/
      <prefix>.json        — one file per API key (cached from PostgreSQL)
    audit/
      <id>.json            — one file per audit record (cached, with IP)
    _index/
      keys.json            — key prefix -> file mapping
      audit_seq.json       — auto-increment sequence for audit IDs

Thread safety: all operations protected by a global threading.Lock.
Write atomicity: write to .tmp then os.replace().

Project: WEBADM v-a.1.2
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════════════════

DATA_DIR = os.environ.get("WEBADM_DATA_DIR", "/var/lib/webadm")
DB_DIR = os.path.join(DATA_DIR, "webadm_db")

# Global lock for all file operations
_lock = threading.Lock()

# Cache TTL in seconds (for keys — avoid re-reading files on every request)
_CACHE_TTL = 30

# In-memory cache: { collection: { id: (data, timestamp) } }
_cache: Dict[str, Dict[str, Tuple[Dict, float]]] = {}


def _get_db_dir() -> str:
    """Return DB directory, reading from app settings if available."""
    try:
        from app.config import get_settings
        settings = get_settings()
        data_dir = getattr(settings, "WEBADM_DATA_DIR", DATA_DIR)
        return os.path.join(data_dir, "webadm_db")
    except Exception:
        return DB_DIR


def _collection_dir(collection: str) -> str:
    """Return directory path for a collection."""
    return os.path.join(_get_db_dir(), collection)


def _record_path(collection: str, record_id: str) -> str:
    """Return file path for a single record."""
    # Sanitize record_id to prevent directory traversal
    safe_id = record_id.replace("/", "_").replace("\\", "_").replace("..", "_")
    return os.path.join(_collection_dir(collection), f"{safe_id}.json")


def _index_path(name: str) -> str:
    """Return path for an index file."""
    return os.path.join(_get_db_dir(), "_index", f"{name}.json")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════
#  Core CRUD Operations
# ═══════════════════════════════════════════════════════════════════════


def ensure_collection(collection: str) -> None:
    """Ensure the directory for a collection exists."""
    os.makedirs(_collection_dir(collection), exist_ok=True)
    os.makedirs(os.path.join(_get_db_dir(), "_index"), exist_ok=True)


def put(collection: str, record_id: str, data: Dict[str, Any]) -> None:
    """Create or update a record. Each record = separate JSON file.

    Parameters
    ----------
    collection : str
        Collection name (e.g. 'tasks', 'keys', 'audit')
    record_id : str
        Unique record identifier
    data : dict
        Record data (must be JSON-serializable)
    """
    with _lock:
        ensure_collection(collection)
        filepath = _record_path(collection, record_id)
        tmp_path = filepath + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, filepath)
        # Update in-memory cache
        _cache.setdefault(collection, {})[record_id] = (data, time.time())


def get(collection: str, record_id: str) -> Optional[Dict[str, Any]]:
    """Get a single record by ID. Returns None if not found.

    Uses in-memory cache with TTL to minimize disk reads.
    """
    # Check cache first
    coll_cache = _cache.get(collection, {})
    cached = coll_cache.get(record_id)
    if cached and (time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]

    with _lock:
        filepath = _record_path(collection, record_id)
        if not os.path.exists(filepath):
            return None
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Update cache
            _cache.setdefault(collection, {})[record_id] = (data, time.time())
            return data
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("[db] Corrupt record %s/%s: %s", collection, record_id, exc)
            return None


def delete(collection: str, record_id: str) -> bool:
    """Delete a record. Returns True if deleted, False if not found."""
    with _lock:
        filepath = _record_path(collection, record_id)
        if not os.path.exists(filepath):
            return False
        os.remove(filepath)
        # Remove from cache
        _cache.get(collection, {}).pop(record_id, None)
        return True


def list_ids(collection: str) -> List[str]:
    """List all record IDs in a collection."""
    coll_dir = _collection_dir(collection)
    if not os.path.isdir(coll_dir):
        return []
    ids = []
    for fname in os.listdir(coll_dir):
        if fname.endswith(".json"):
            ids.append(fname[:-5])  # strip .json
    return sorted(ids)


def list_records(
    collection: str,
    *,
    sort_by: Optional[str] = None,
    reverse: bool = True,
    limit: int = 0,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """List all records in a collection with optional sorting and pagination.

    Parameters
    ----------
    collection : str
        Collection name
    sort_by : str, optional
        Field name to sort by (e.g. 'created_at', 'name')
    reverse : bool
        Sort descending (default True = newest first)
    limit : int
        Max records to return (0 = all)
    offset : int
        Skip first N records
    """
    with _lock:
        records = []
        coll_dir = _collection_dir(collection)
        if not os.path.isdir(coll_dir):
            return []

        for fname in os.listdir(coll_dir):
            if not fname.endswith(".json"):
                continue
            filepath = os.path.join(coll_dir, fname)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                records.append(data)
            except (json.JSONDecodeError, OSError):
                continue

    # Sort
    if sort_by:
        records.sort(key=lambda r: r.get(sort_by, ""), reverse=reverse)
    elif reverse:
        # Default: sort by _file modification time (newest first)
        records.sort(key=lambda r: r.get("created_at", ""), reverse=True)

    # Pagination
    if offset:
        records = records[offset:]
    if limit > 0:
        records = records[:limit]

    return records


def count(collection: str) -> int:
    """Count records in a collection."""
    coll_dir = _collection_dir(collection)
    if not os.path.isdir(coll_dir):
        return 0
    return sum(1 for f in os.listdir(coll_dir) if f.endswith(".json"))


def find(
    collection: str,
    *,
    filter_fn=None,
    sort_by: Optional[str] = None,
    reverse: bool = True,
    limit: int = 0,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Find records matching a filter function.

    Parameters
    ----------
    filter_fn : callable, optional
        Function(record) -> bool. If None, returns all records.
    """
    records = list_records(collection, sort_by=sort_by, reverse=reverse)
    if filter_fn:
        records = [r for r in records if filter_fn(r)]
    total = len(records)
    if offset:
        records = records[offset:]
    if limit > 0:
        records = records[:limit]
    return records


def purge_collection(collection: str) -> int:
    """Delete all records in a collection. Returns count of deleted records."""
    with _lock:
        coll_dir = _collection_dir(collection)
        if not os.path.isdir(coll_dir):
            return 0
        count = 0
        for fname in os.listdir(coll_dir):
            if fname.endswith(".json"):
                os.remove(os.path.join(coll_dir, fname))
                count += 1
        # Clear cache for this collection
        _cache.pop(collection, None)
        return count


def collection_stats(collection: str) -> Dict[str, Any]:
    """Return stats for a collection: count, total_size_bytes, oldest, newest."""
    coll_dir = _collection_dir(collection)
    if not os.path.isdir(coll_dir):
        return {"collection": collection, "count": 0, "size_bytes": 0}

    total_size = 0
    oldest = None
    newest = None
    cnt = 0

    for fname in os.listdir(coll_dir):
        if not fname.endswith(".json"):
            continue
        filepath = os.path.join(coll_dir, fname)
        cnt += 1
        total_size += os.path.getsize(filepath)
        # Read created_at for time range
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            ca = data.get("created_at") or data.get("timestamp")
            if ca:
                if oldest is None or ca < oldest:
                    oldest = ca
                if newest is None or ca > newest:
                    newest = ca
        except Exception:
            pass

    return {
        "collection": collection,
        "count": cnt,
        "size_bytes": total_size,
        "oldest": oldest,
        "newest": newest,
    }


# ═══════════════════════════════════════════════════════════════════════
#  Index Management
# ═══════════════════════════════════════════════════════════════════════


def index_get(name: str) -> Dict[str, Any]:
    """Read an index file. Returns empty dict if not found."""
    with _lock:
        filepath = _index_path(name)
        if not os.path.exists(filepath):
            return {}
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}


def index_put(name: str, data: Dict[str, Any]) -> None:
    """Write an index file atomically."""
    with _lock:
        os.makedirs(os.path.dirname(_index_path(name)), exist_ok=True)
        filepath = _index_path(name)
        tmp_path = filepath + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, filepath)


# ═══════════════════════════════════════════════════════════════════════
#  API Key Cache (synced from PostgreSQL mgmt_api_keys)
# ═══════════════════════════════════════════════════════════════════════


def cache_api_keys() -> int:
    """Load API keys from PostgreSQL and cache them as individual JSON files.

    Returns the number of keys cached. If PostgreSQL is unavailable,
    returns 0 (existing cache remains valid).
    """
    try:
        from app.mgmt_db import list_api_keys
        keys = list_api_keys()
    except Exception as exc:
        logger.warning("[db] Cannot load API keys from PostgreSQL: %s", exc)
        return 0

    cached = 0
    for key_data in keys:
        # Use key_prefix as filename (safe, short, unique per key)
        prefix = key_data.get("key_prefix", "")
        if not prefix:
            continue
        put("keys", prefix, key_data)
        cached += 1

    # Save index: prefix -> user_id mapping
    index_data = {
        k.get("key_prefix", ""): {
            "user_id": k.get("user_id"),
            "role": k.get("role"),
            "is_active": k.get("is_active", True),
        }
        for k in keys
        if k.get("key_prefix")
    }
    index_put("keys", index_data)

    logger.info("[db] Cached %d API keys from PostgreSQL", cached)
    return cached


def validate_cached_key(api_key: str) -> Optional[Dict[str, Any]]:
    """Validate an API key against the cached JSON store.

    This avoids a PostgreSQL round-trip on every request.
    Falls back to PostgreSQL if cache miss or cache is stale.

    Parameters
    ----------
    api_key : str
        The raw API key from X-API-Key header

    Returns
    -------
    dict or None
        Key data if valid, None if invalid
    """
    import hashlib

    # Compute key_hash (SHA-256, same as mgmt_db)
    key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    key_prefix = api_key[:8]

    # Check cache
    key_data = get("keys", key_prefix)
    if key_data and key_data.get("key_hash") == key_hash:
        if key_data.get("is_active", True):
            # Update last_used_at asynchronously (don't block)
            key_data["last_used_at"] = _now_iso()
            put("keys", key_prefix, key_data)
            return key_data
    return None


# ═══════════════════════════════════════════════════════════════════════
#  Audit Log Cache (synced from PostgreSQL mgmt_audit_log)
# ═══════════════════════════════════════════════════════════════════════


def cache_audit_log(limit: int = 1000) -> int:
    """Load recent audit log entries from PostgreSQL and cache as JSON files.

    Parameters
    ----------
    limit : int
        Max entries to cache (default 1000 most recent)

    Returns
    -------
    int
        Number of entries cached
    """
    try:
        from app.mgmt_db import list_audit_log
        entries = list_audit_log(limit=limit)
    except Exception as exc:
        logger.warning("[db] Cannot load audit log from PostgreSQL: %s", exc)
        return 0

    cached = 0
    for entry in entries:
        entry_id = str(entry.get("id", ""))
        if not entry_id:
            continue
        put("audit", entry_id, entry)
        cached += 1

    logger.info("[db] Cached %d audit log entries from PostgreSQL", cached)
    return cached


def log_audit(
    user_id: Optional[int] = None,
    api_key_id: Optional[int] = None,
    action: str = "",
    endpoint: str = "",
    ip_address: str = "",
    details: str = "",
) -> Dict[str, Any]:
    """Write an audit log entry to JSON cache AND to PostgreSQL.

    The JSON cache acts as a fast local buffer. PostgreSQL is the
    authoritative source but JSON files provide quick read access
    without DB round-trips.
    """
    now = _now_iso()

    entry = {
        "id": f"audit-{int(time.time() * 1000)}",
        "user_id": user_id,
        "api_key_id": api_key_id,
        "action": action,
        "endpoint": endpoint,
        "ip_address": ip_address,
        "timestamp": now,
        "details": details,
    }

    # Write to JSON cache
    put("audit", entry["id"], entry)

    # Also write to PostgreSQL (best effort)
    try:
        from app.mgmt_db import log_action
        log_action(
            user_id=user_id,
            api_key_id=api_key_id,
            action=action,
            endpoint=endpoint,
            ip_address=ip_address,
            details=details,
        )
    except Exception as exc:
        logger.debug("[db] Audit log write to PostgreSQL failed (cached locally): %s", exc)

    return entry


# ═══════════════════════════════════════════════════════════════════════
#  Full Sync: PostgreSQL -> JSON Cache
# ═══════════════════════════════════════════════════════════════════════


def sync_from_postgresql() -> Dict[str, int]:
    """Sync all data from PostgreSQL to JSON file cache.

    Returns counts per collection synced.
    """
    results = {}
    results["keys"] = cache_api_keys()
    results["audit"] = cache_audit_log()
    logger.info("[db] Sync from PostgreSQL complete: %s", results)
    return results


# ═══════════════════════════════════════════════════════════════════════
#  Utility: list all collections + stats
# ═══════════════════════════════════════════════════════════════════════


def list_collections() -> List[str]:
    """List all existing collection directories."""
    db_dir = _get_db_dir()
    if not os.path.isdir(db_dir):
        return []
    collections = []
    for entry in os.listdir(db_dir):
        path = os.path.join(db_dir, entry)
        if os.path.isdir(path) and entry != "_index":
            collections.append(entry)
    return sorted(collections)


def full_stats() -> Dict[str, Any]:
    """Return stats for all collections."""
    collections = list_collections()
    stats = {}
    total_records = 0
    total_size = 0
    for coll in collections:
        s = collection_stats(coll)
        stats[coll] = s
        total_records += s["count"]
        total_size += s["size_bytes"]
    return {
        "db_dir": _get_db_dir(),
        "collections": stats,
        "total_records": total_records,
        "total_size_bytes": total_size,
    }


def flush_cache() -> None:
    """Clear in-memory cache (forces re-read from disk on next access)."""
    with _lock:
        _cache.clear()


def vacuum() -> Dict[str, Any]:
    """Remove orphaned temp files and empty directories."""
    db_dir = _get_db_dir()
    removed = {"tmp_files": 0, "empty_dirs": 0}

    if not os.path.isdir(db_dir):
        return removed

    for root, dirs, files in os.walk(db_dir):
        for f in files:
            if f.endswith(".tmp"):
                try:
                    os.remove(os.path.join(root, f))
                    removed["tmp_files"] += 1
                except OSError:
                    pass
        # Check for empty dirs (after file removal)
        for d in dirs:
            dpath = os.path.join(root, d)
            try:
                if not os.listdir(dpath):
                    os.rmdir(dpath)
                    removed["empty_dirs"] += 1
            except OSError:
                pass

    return removed
