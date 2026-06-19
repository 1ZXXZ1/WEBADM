"""
Audit log export router.

GET /api/v1/mgmt/audit/export?format=csv&from=...&to=...&user_id=...&action=...

v2.3: Exports audit log entries to CSV or XLSX format. Supports the
same filters as the regular audit list endpoint plus date-range
filtering. Returns a file download response.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.auth import ApiKeyDep
from app.models.common import ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/mgmt/audit",
    tags=["Audit — Export"],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse},
        status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    },
)

MAX_EXPORT_ROWS = 50000


@router.get("/export", summary="Export audit log to CSV or XLSX")
async def export_audit_log(
    _: ApiKeyDep,
    format: str = Query(default="csv", description="Output format: csv | xlsx | json"),
    date_from: Optional[str] = Query(default=None, alias="from",
                                     description="ISO 8601 start (e.g. 2026-01-01 or 2026-01-01T00:00:00)"),
    date_to: Optional[str] = Query(default=None, alias="to",
                                   description="ISO 8601 end (inclusive)"),
    user_id: Optional[int] = Query(default=None),
    action: Optional[str] = Query(default=None),
    endpoint: Optional[str] = Query(default=None),
    event_type: Optional[str] = Query(
        default=None,
        description="(v2.3.2) Filter by semantic event type (e.g. 'user.created')",
    ),
    auth_method: Optional[str] = Query(
        default=None,
        description="(v2.3.2) Filter by auth method: jwt / api_key / static_api_key / credentials",
    ),
    ip_address: Optional[str] = Query(default=None),
    limit: int = Query(default=MAX_EXPORT_ROWS, ge=1, le=MAX_EXPORT_ROWS),
) -> StreamingResponse:
    """Export audit log entries as a downloadable file.

    Formats:
      * ``csv``  — CSV file (UTF-8 with BOM for Excel)
      * ``xlsx`` — Excel workbook (openpyxl)
      * ``json`` — JSON array

    Date range:
      * ``from`` — start (inclusive)
      * ``to``   — end (inclusive)
      Both can be date-only (``2026-01-01``) or full ISO 8601
      (``2026-01-01T00:00:00Z``).

    v2.3.2: New filters ``event_type``, ``auth_method``, ``ip_address``.
    """
    # Parse dates
    ts_from = _parse_date(date_from)
    ts_to = _parse_date(date_to, end_of_day=True)

    # Fetch entries
    from app.api_ma import list_audit_log
    raw = list_audit_log(
        user_id=user_id, action=action, endpoint=endpoint,
        offset=0, limit=limit,
        event_type=event_type, auth_method=auth_method, ip_address=ip_address,
    )

    # Apply date filtering in Python (timestamps are stored as ISO strings)
    entries = []
    for e in raw:
        ts = e.get("timestamp", "")
        try:
            ts_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            ts_dt = None
        if ts_dt is None:
            continue
        if ts_from and ts_dt < ts_from:
            continue
        if ts_to and ts_dt > ts_to:
            continue
        entries.append(e)

    # Generate output
    if format == "csv":
        return _csv_response(entries)
    elif format == "xlsx":
        return _xlsx_response(entries)
    elif format == "json":
        return _json_response(entries)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {format}. Use csv, xlsx, or json.",
        )


# ── Helpers ────────────────────────────────────────────────────────────

def _parse_date(s: Optional[str], end_of_day: bool = False):
    """Parse an ISO 8601 date or datetime string to a timezone-aware datetime."""
    if not s:
        return None
    try:
        # Try full ISO first
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        pass
    # Try date-only
    try:
        dt = datetime.fromisoformat(s)
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {s!r}. Use ISO 8601 (e.g. 2026-01-01 or 2026-01-01T00:00:00).",
        )


def _csv_response(entries):
    """Build a CSV file response."""
    output = io.StringIO()
    output.write("\ufeff")  # UTF-8 BOM for Excel
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "id", "timestamp", "username", "user_id", "api_key_id",
            "auth_method", "method", "action", "endpoint",
            "status_code", "duration_ms", "ip_address", "user_agent",
            "event_type", "request_body", "details",
        ],
    )
    writer.writeheader()
    for e in entries:
        writer.writerow({
            "id": e.get("id", ""),
            "timestamp": e.get("timestamp", ""),
            "username": e.get("username", "") or "",
            "user_id": e.get("user_id", "") or "",
            "api_key_id": e.get("api_key_id", "") or "",
            "auth_method": e.get("auth_method", "") or "",
            "method": e.get("method", "") or "",
            "action": e.get("action", ""),
            "endpoint": e.get("endpoint", ""),
            "status_code": e.get("status_code", "") or "",
            "duration_ms": e.get("duration_ms", "") or "",
            "ip_address": e.get("ip_address", ""),
            "user_agent": e.get("user_agent", "") or "",
            "event_type": e.get("event_type", "") or "",
            "request_body": e.get("request_body", "") or "",
            "details": e.get("details", "") or "",
        })
    csv_bytes = output.getvalue().encode("utf-8")

    headers = {
        "Content-Disposition": 'attachment; filename="audit-log.csv"',
    }
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


def _xlsx_response(entries):
    """Build an XLSX file response using openpyxl."""
    try:
        from openpyxl import Workbook
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="openpyxl is not installed. Use format=csv or json instead.",
        )

    wb = Workbook()
    ws = wb.active
    ws.title = "Audit Log"
    headers = [
        "ID", "Timestamp", "Username", "User ID", "API Key ID",
        "Auth Method", "HTTP Method", "Action", "Endpoint",
        "Status", "Duration ms", "IP Address", "User-Agent",
        "Event Type", "Request Body", "Details",
    ]
    ws.append(headers)
    # Bold header row
    for cell in ws[1]:
        cell.font = cell.font.copy(bold=True)

    for e in entries:
        ws.append([
            e.get("id", ""),
            e.get("timestamp", ""),
            e.get("username", "") or "",
            e.get("user_id", "") or "",
            e.get("api_key_id", "") or "",
            e.get("auth_method", "") or "",
            e.get("method", "") or "",
            e.get("action", ""),
            e.get("endpoint", ""),
            e.get("status_code", "") or "",
            e.get("duration_ms", "") or "",
            e.get("ip_address", ""),
            e.get("user_agent", "") or "",
            e.get("event_type", "") or "",
            e.get("request_body", "") or "",
            e.get("details", "") or "",
        ])

    # Auto-fit column widths (approximate)
    for col_idx, header in enumerate(headers, 1):
        max_len = len(header)
        for row in ws.iter_rows(min_row=2, min_col=col_idx, max_col=col_idx, values_only=True):
            for v in row:
                if v is not None:
                    max_len = max(max_len, min(len(str(v)), 60))
        from openpyxl.utils import get_column_letter
        ws.column_dimensions[get_column_letter(col_idx)].width = max_len + 2

    # Write to buffer
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    headers = {
        "Content-Disposition": 'attachment; filename="audit-log.xlsx"',
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


def _json_response(entries):
    """Build a JSON file response."""
    import json
    payload = json.dumps({"status": "ok", "total": len(entries), "data": entries},
                         ensure_ascii=False, indent=2, default=str)
    headers = {
        "Content-Disposition": 'attachment; filename="audit-log.json"',
    }
    return StreamingResponse(
        io.BytesIO(payload.encode("utf-8")),
        media_type="application/json",
        headers=headers,
    )
