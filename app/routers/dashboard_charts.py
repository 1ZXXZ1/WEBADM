"""
Dashboard charts router — aggregated data for charts on the dashboard.

GET /api/v1/dashboard/charts/login-activity?days=30
GET /api/v1/dashboard/charts/top-groups?limit=10
GET /api/v1/dashboard/charts/os-distribution
GET /api/v1/dashboard/charts/users-by-ou
GET /api/v1/dashboard/charts/recent-events?limit=20

v2.3: Provides aggregated, chart-ready data for the frontend (recharts).
All endpoints are read-only and use ldbsearch/PostgreSQL directly
without heavy per-object fetches.
"""
from __future__ import annotations

import asyncio
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/dashboard/charts",
    tags=["Dashboard — Charts"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)


# ── Helpers ────────────────────────────────────────────────────────────

def _parse_iso(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _date_bucket(dt: datetime, freq: str = "day") -> str:
    """Return a YYYY-MM-DD (or YYYY-MM-DD HH:00) bucket for a datetime."""
    if freq == "hour":
        return dt.strftime("%Y-%m-%dT%H:00:00")
    return dt.strftime("%Y-%m-%d")


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("/login-activity", summary="Login activity over time")
async def login_activity(
    _: ApiKeyDep,
    days: int = Query(default=30, ge=1, le=365),
    freq: str = Query(default="day", description="day | hour"),
) -> Dict[str, Any]:
    """Aggregate login activity (success + failure) over the last N days.

    Reads from ``mgmt_audit_log`` where ``action`` is one of
    ``login_success``, ``login_failure``, ``auth_login_success``,
    ``auth_login_failure``.

    Returns a list of ``{bucket, success, failure}`` entries, one per
    day (or hour) in the requested range. Days with no activity are
    included as zero-rows so the chart line is continuous.
    """
    from app.api_ma import list_audit_log

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    # Pull audit log entries (one big page, cap at 5000)
    raw = list_audit_log(action=None, endpoint=None, offset=0, limit=5000)

    success_by_bucket: Counter = Counter()
    failure_by_bucket: Counter = Counter()

    for e in raw:
        action = (e.get("action") or "").lower()
        if "login" not in action and "auth" not in action:
            continue
        ts = _parse_iso(e.get("timestamp", ""))
        if ts is None or ts < start:
            continue
        bucket = _date_bucket(ts, freq)
        if "fail" in action:
            failure_by_bucket[bucket] += 1
        elif "success" in action or "ok" in action:
            success_by_bucket[bucket] += 1

    # Build continuous bucket list
    buckets: List[str] = []
    cursor = start
    step = timedelta(hours=1) if freq == "hour" else timedelta(days=1)
    while cursor <= now:
        buckets.append(_date_bucket(cursor, freq))
        cursor += step

    data = [
        {
            "bucket": b,
            "success": success_by_bucket.get(b, 0),
            "failure": failure_by_bucket.get(b, 0),
        }
        for b in buckets
    ]
    return {"status": "ok", "data": data, "freq": freq, "days": days}


@router.get("/top-groups", summary="Top groups by member count")
async def top_groups(
    _: ApiKeyDep,
    limit: int = Query(default=10, ge=1, le=100),
) -> Dict[str, Any]:
    """Return top-N groups ranked by member count.

    Uses ldbsearch to fetch all groups with ``member`` attributes,
    counts unique members per group, and returns the top N.
    """
    from app.ldb_reader import fetch_groups_full
    try:
        groups = fetch_groups_full()
    except Exception as exc:
        return {"status": "ok", "data": [], "error": str(exc)[:200]}

    counts = []
    for g in groups:
        members = g.get("member") or []
        if isinstance(members, str):
            members = [members]
        counts.append({
            "name": g.get("sAMAccountName") or g.get("cn") or g.get("dn", "?"),
            "member_count": len(members),
        })
    counts.sort(key=lambda x: x["member_count"], reverse=True)
    return {"status": "ok", "data": counts[:limit]}


@router.get("/os-distribution", summary="Computer OS distribution")
async def os_distribution(_: ApiKeyDep) -> Dict[str, Any]:
    """Aggregate operating-system distribution across all computer accounts."""
    from app.ldb_reader import fetch_computers_full
    try:
        computers = fetch_computers_full()
    except Exception as exc:
        return {"status": "ok", "data": [], "error": str(exc)[:200]}

    counter: Counter = Counter()
    for c in computers:
        os_name = (c.get("operatingSystem") or c.get("operating-system") or "Unknown")
        # Normalize common variants
        os_str = str(os_name)
        if not os_str:
            os_str = "Unknown"
        counter[os_str] += 1

    data = [
        {"os": os_name, "count": count}
        for os_name, count in counter.most_common()
    ]
    return {"status": "ok", "data": data, "total": sum(counter.values())}


@router.get("/users-by-ou", summary="Users grouped by OU")
async def users_by_ou(_: ApiKeyDep) -> Dict[str, Any]:
    """Count users per top-level OU (based on DN)."""
    from app.ldb_reader import fetch_users_full
    try:
        users = fetch_users_full()
    except Exception as exc:
        return {"status": "ok", "data": [], "error": str(exc)[:200]}

    counter: Counter = Counter()
    for u in users:
        dn = u.get("dn", "")
        # Extract the first OU= segment
        ou = "Unknown"
        for part in dn.split(","):
            part = part.strip()
            if part.upper().startswith("OU="):
                ou = part[3:]
                break
            elif part.upper().startswith("CN="):
                # Skip CN= containers, but use as fallback
                if ou == "Unknown":
                    ou = part[3:]
        counter[ou] += 1

    data = [
        {"ou": ou, "count": count}
        for ou, count in counter.most_common()
    ]
    return {"status": "ok", "data": data, "total": sum(counter.values())}


@router.get("/recent-events", summary="Recent audit events (timeline)")
async def recent_events(
    _: ApiKeyDep,
    limit: int = Query(default=20, ge=1, le=200),
) -> Dict[str, Any]:
    """Return the most recent audit events for the dashboard timeline."""
    from app.api_ma import list_audit_log
    raw = list_audit_log(action=None, endpoint=None, offset=0, limit=limit)
    return {"status": "ok", "data": raw, "total": len(raw)}


@router.get("/mgmt-summary", summary="Management summary (counts)")
async def mgmt_summary(_: ApiKeyDep) -> Dict[str, Any]:
    """Return management-side counts: users, keys, roles, audit total."""
    from app.api_ma import get_mgmt_stats
    return {"status": "ok", "data": get_mgmt_stats()}
