"""
SDB (Samba Database Query Tool) REST API router.

Provides web-accessible endpoints for:
  - SDB queries (direct LDB database access)
  - SQL-like SELECT queries against AD objects
  - SDB script execution
  - Data export with web download links (ZIP download support)
  - Schema analysis (SYNTHESIS)
  - List available databases

v1.0: Initial SDB API integration
v1.9-3: Fixed NumPy X86_V2 crash, added ZIP export/download,
        fixed parameter ordering (api_key before defaults),
        export uses openpyxl directly (no pandas/NumPy dependency).
v1.9-3-2: Completely isolated export path from sdb_service/sdb_lib
          to prevent NumPy import chain crash. Export is self-contained.
v1.9-3-4: Fixed 'unhashable type: list' (LDB returns attrs as lists),
          fixed NumPy crash in export-download (wrapped client.query),
          fixed SELECT WHERE=0 rows (ldbsearch fallback for WHERE).
"""

from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import zipfile as zipfile_mod
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sdb", tags=["SDB — Samba Database Query"])


# ═══════════════════════════════════════════════════════════════════════
#  Request/Response Models
# ═══════════════════════════════════════════════════════════════════════


class SdbQueryRequest(BaseModel):
    """Request for SDB LDB query."""
    database: str = Field(default="sam", description="LDB database name: sam, share, privilege, hklm, idmap, secrets, dns")
    filter: str = Field(default="", description="LDAP filter expression")
    attrs: Optional[str] = Field(default=None, description="Comma-separated attributes to return")
    base_dn: Optional[str] = Field(default=None, description="Base DN for search")
    exclude: str = Field(default="", description="Comma-separated sAMAccountNames to exclude")
    limit: int = Field(default=0, description="Max records (0=all)")
    format: str = Field(default="json", description="Output format: json, csv, tsv, xlsx, ldif")


class SdbSelectRequest(BaseModel):
    """Request for SQL-like SELECT query."""
    fields: str = Field(default="*", description="Comma-separated field names or * for all")
    scope: str = Field(default="USERS", description="Table: USERS, GROUPS, COMPUTERS, OUS, GPOS, CONTACTS, DNS_RECORDS")
    where: str = Field(default="", description="WHERE condition")
    format: str = Field(default="json", description="Output format")
    filename: Optional[str] = Field(default=None, description="Export filename (e.g. report.xlsx)")


class SdbShowRequest(BaseModel):
    """Request for SHOW AD object."""
    object_type: str = Field(description="Object type: user, group, computer, ou, gpo, dns, contact, databases")
    name: str = Field(default="", description="Object name (empty = list all)")
    format: str = Field(default="json", description="Output format")


class SdbScriptRequest(BaseModel):
    """Request for SDB script execution."""
    script: str = Field(description="SDB script text (multi-line supported)")
    filename: Optional[str] = Field(default=None, description="Export filename for OUTPUT commands")


class SdbExportRequest(BaseModel):
    """Request for one-step export."""
    database: str = Field(default="sam", description="LDB database name")
    filter: str = Field(default="", description="LDAP filter expression")
    attrs: Optional[str] = Field(default=None, description="Comma-separated attributes")
    filename: str = Field(default="export.xlsx", description="Output filename (extension determines format)")
    exclude: str = Field(default="", description="Comma-separated sAMAccountNames to exclude")
    base_dn: Optional[str] = Field(default=None, description="Base DN for search")
    as_zip: bool = Field(default=True, description="Package export as .zip for download")
    zip_name: str = Field(default="Samba-api-server-1.9-3.zip", description="ZIP archive filename")


# ═══════════════════════════════════════════════════════════════════════
#  NumPy-safe SDB client access
#  We never import sdb_service at module level to avoid the
#  sdb_service → sdb_lib → dataframe_fmt → pandas → numpy chain.
#  All sdb_service imports are lazy and wrapped in try/except.
# ═══════════════════════════════════════════════════════════════════════


def _flatten_value(val: Any) -> Any:
    """Flatten LDB list values to scalars where possible.

    LDB/ldbsearch returns attributes as lists even for single values:
      sAMAccountName: ["Administrator"]  →  "Administrator"
      objectClass: ["top", "person"]      →  "top, person"
      cn: []                            →  ""
    """
    if isinstance(val, list):
        if len(val) == 0:
            return ""
        elif len(val) == 1:
            return val[0] if not isinstance(val[0], list) else _flatten_value(val[0])
        else:
            # Multi-valued: join as comma-separated string
            return ", ".join(str(v) for v in val if v)
    return val


def _flatten_record(row: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten all list values in a record dict to scalars."""
    flat = {}
    for key, val in row.items():
        flat[key] = _flatten_value(val)
    return flat


def _safe_get_sdb_client():
    """Get SDB client, catching NumPy/pandas import errors gracefully."""
    try:
        from app.services.sdb_service import _get_sdb_client
        return _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible, falling back to direct ldbsearch: %s", err_msg)
            return None
        raise


def _query_via_ldbsearch(
    database: str = "sam",
    filter_expr: str = "",
    attrs: Optional[List[str]] = None,
    base_dn: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fallback: query LDB directly via ldbsearch subprocess (no NumPy needed).

    Used when SDB client can't initialize due to NumPy incompatibility.
    """
    # Map database name to LDB file path
    db_paths = {
        "sam": "/var/lib/samba/private/sam.ldb",
        "share": "/var/lib/samba/share.ldb",
        "privilege": "/var/lib/samba/private/privilege.ldb",
        "hklm": "/var/lib/samba/registry/hklm.ldb",
        "idmap": "/var/lib/samba/private/idmap.ldb",
        "secrets": "/var/lib/samba/private/secrets.ldb",
        "dns": "/var/lib/samba/private/dns/sam.ldb",
    }
    ldb_path = db_paths.get(database, database)
    cmd = ["sudo", "ldbsearch", "-H", ldb_path]

    if base_dn:
        cmd.extend(["-b", base_dn])
    if filter_expr:
        cmd.append(filter_expr)
    if attrs:
        cmd.extend(attrs)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.error("[SDB] ldbsearch failed: %s", result.stderr[:500])
            return []

        # Parse LDIF output and flatten list values
        raw_records = _parse_ldif_output(result.stdout)
        return [_flatten_record(r) for r in raw_records]
    except Exception as exc:
        logger.error("[SDB] ldbsearch subprocess failed: %s", exc)
        return []


def _parse_ldif_output(ldif_text: str) -> List[Dict[str, Any]]:
    """Parse ldbsearch LDIF output into list of dicts."""
    records = []
    current = {}

    for line in ldif_text.split("\n"):
        line = line.rstrip()
        if not line:
            if current:
                records.append(current)
                current = {}
            continue

        if line.startswith("#") or line.startswith("record"):
            continue

        if ": " in line:
            key, _, value = line.partition(": ")
            # Handle base64 encoded values
            if value.startswith(": "):
                # base64 encoded — store as-is
                current[key] = value[2:]
            else:
                # Multi-valued attributes
                if key in current:
                    existing = current[key]
                    if isinstance(existing, list):
                        existing.append(value)
                    else:
                        current[key] = [existing, value]
                else:
                    current[key] = value
        elif line.startswith("dn:"):
            current["dn"] = line[3:].strip()

    if current:
        records.append(current)

    return records


# ═══════════════════════════════════════════════════════════════════════
#  NumPy-free export functions (openpyxl + stdlib only)
# ═══════════════════════════════════════════════════════════════════════


def _records_to_xlsx_bytes(records: List[Dict[str, Any]], fields: Optional[List[str]] = None) -> bytes:
    """Convert list of dicts to XLSX bytes using openpyxl only (no NumPy/pandas)."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise ImportError("openpyxl is required for XLSX export. Install: pip install openpyxl")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"[:31]

    if not records:
        wb.active.title = "Empty"
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # Determine columns
    if fields and fields != ["*"]:
        columns = list(fields)
    else:
        columns = []
        seen = set()
        priority = ["sAMAccountName", "cn", "name", "displayName", "objectClass",
                     "description", "mail", "department", "ou", "dn"]
        for attr in priority:
            for rec in records:
                if attr in rec and attr not in seen:
                    columns.append(attr)
                    seen.add(attr)
                    break
        for rec in records:
            for key in rec.keys():
                if key not in seen:
                    columns.append(key)
                    seen.add(key)

    # Header styling
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=str(col_name).upper())
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    data_font = Font(size=10)
    data_align = Alignment(vertical="top", wrap_text=True)

    for row_idx, rec in enumerate(records, 2):
        for col_idx, col in enumerate(columns, 1):
            value = rec.get(col, "")
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False, default=str)
            elif value is None:
                value = ""
            if isinstance(value, str) and len(value) > 32767:
                value = value[:32767]
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font = data_font
            cell.alignment = data_align
            cell.border = thin_border

    # Auto-width
    for col_idx in range(1, len(columns) + 1):
        max_len = 0
        col_letter = get_column_letter(col_idx)
        for row in ws.iter_rows(min_row=1, max_row=min(len(records) + 1, 100),
                                 min_col=col_idx, max_col=col_idx):
            for cell in row:
                if cell.value:
                    max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max(max_len + 2, 8), 50)

    # Auto-filter
    if columns:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(records) + 1}"

    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _records_to_csv_bytes(records: List[Dict[str, Any]], fields: Optional[List[str]] = None) -> bytes:
    """Convert list of dicts to CSV bytes."""
    import csv

    if not records:
        return b""

    if fields and fields != ["*"]:
        columns = list(fields)
    else:
        columns = []
        seen = set()
        for rec in records:
            for key in rec.keys():
                if key not in seen:
                    columns.append(key)
                    seen.add(key)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for rec in records:
        row = {}
        for col in columns:
            val = rec.get(col, "")
            if isinstance(val, (list, dict)):
                val = json.dumps(val, ensure_ascii=False, default=str)
            elif val is None:
                val = ""
            row[col] = val
        writer.writerow(row)

    return buf.getvalue().encode("utf-8")


def _records_to_json_bytes(records: List[Dict[str, Any]], fields: Optional[List[str]] = None) -> bytes:
    """Convert list of dicts to JSON bytes."""
    if fields and fields != ["*"]:
        records = [{k: rec.get(k, "") for k in fields if k in rec} for rec in records]
    return json.dumps(records, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def _records_to_tsv_bytes(records: List[Dict[str, Any]], fields: Optional[List[str]] = None) -> bytes:
    """Convert list of dicts to TSV bytes."""
    if not records:
        return b""

    if fields and fields != ["*"]:
        columns = list(fields)
    else:
        columns = []
        seen = set()
        for rec in records:
            for key in rec.keys():
                if key not in seen:
                    columns.append(key)
                    seen.add(key)

    lines = ["\t".join(columns)]
    for rec in records:
        row = []
        for col in columns:
            val = rec.get(col, "")
            if isinstance(val, (list, dict)):
                val = json.dumps(val, ensure_ascii=False, default=str)
            elif val is None:
                val = ""
            row.append(str(val).replace("\t", " ").replace("\n", " "))
        lines.append("\t".join(row))

    return "\n".join(lines).encode("utf-8")


def _records_to_ldif_bytes(records: List[Dict[str, Any]]) -> bytes:
    """Convert list of dicts to LDIF bytes."""
    lines = []
    for rec in records:
        dn = rec.get("dn", "")
        if dn:
            lines.append(f"dn: {dn}")
        for key, value in rec.items():
            if key == "dn":
                continue
            if isinstance(value, list):
                for v in value:
                    lines.append(f"{key}: {v}")
            else:
                lines.append(f"{key}: {value}")
        lines.append("")
    return "\n".join(lines).encode("utf-8")


def _format_records(rows: List[Dict[str, Any]], ext: str,
                    attrs: Optional[List[str]] = None) -> bytes:
    """Format records to bytes based on file extension.

    If XLSX formatting fails (e.g. NumPy crash from openpyxl internals),
    falls back to CSV format.
    """
    try:
        if ext in ('.xlsx', '.xls'):
            return _records_to_xlsx_bytes(rows, attrs)
        elif ext == '.csv':
            return _records_to_csv_bytes(rows, attrs)
        elif ext == '.json':
            return _records_to_json_bytes(rows, attrs)
        elif ext == '.tsv':
            return _records_to_tsv_bytes(rows, attrs)
        elif ext == '.ldif':
            return _records_to_ldif_bytes(rows)
        else:
            return _records_to_csv_bytes(rows, attrs)
    except (RuntimeError, ImportError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg:
            logger.warning("[SDB] NumPy crash during format, falling back to CSV")
            return _records_to_csv_bytes(rows, attrs)
        raise


def _create_zip_bytes(inner_filename: str, data_bytes: bytes) -> bytes:
    """Create a ZIP archive in memory containing the exported file."""
    buf = io.BytesIO()
    with zipfile_mod.ZipFile(buf, 'w', zipfile_mod.ZIP_DEFLATED) as zf:
        zf.writestr(inner_filename, data_bytes)
    return buf.getvalue()


def _get_export_dir() -> str:
    """Get export directory from settings or default."""
    try:
        from app.config import get_settings
        settings = get_settings()
        return getattr(settings, "AI_AGENT_EXPORT_DIR", "/home/AD-API-USER/ai-exports")
    except Exception:
        return "/home/AD-API-USER/ai-exports"


def _convert_records(records: list) -> List[Dict[str, Any]]:
    """Convert LdifRecord objects or dicts to flat dicts with scalar values.

    LDB returns attributes as lists (e.g. sAMAccountName=["admin"]).
    We flatten single-element lists to scalars and multi-valued to comma strings.
    This prevents 'unhashable type: list' errors in set operations and
    ensures clean XLSX/CSV/JSON output.
    """
    rows = []
    for rec in records:
        if hasattr(rec, 'attrs') and hasattr(rec, 'dn'):
            row = dict(rec.attrs)
            if rec.dn:
                row['dn'] = rec.dn
        elif isinstance(rec, dict):
            row = dict(rec)
        else:
            row = {"value": str(rec)}
        # Flatten LDB list values to scalars
        row = _flatten_record(row)
        rows.append(row)
    return rows


def _get_format_name(ext: str) -> str:
    """Get format name from extension."""
    ext = ext.lower()
    mapping = {'.xlsx': 'xlsx', '.xls': 'xlsx', '.csv': 'csv',
               '.json': 'json', '.tsv': 'tsv', '.ldif': 'ldif'}
    return mapping.get(ext, 'csv')


def _query_records(database: str, filter_expr: str,
                   attrs: Optional[List[str]], base_dn: Optional[str],
                   exclude: str) -> List[Dict[str, Any]]:
    """Query records using SDB client or fallback to ldbsearch.

    This function is completely NumPy-safe: if the SDB client
    can't initialize (due to NumPy X86_V2), it falls back to
    direct ldbsearch subprocess.
    """
    client = _safe_get_sdb_client()

    if client is not None:
        try:
            records = client.query(
                database=database,
                filter_expr=filter_expr,
                attrs=attrs,
                base_dn=base_dn,
            )
            rows = _convert_records(records)
        except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                logger.warning("[SDB] NumPy crash during query, using ldbsearch fallback: %s", err_msg)
                rows = _query_via_ldbsearch(
                    database=database,
                    filter_expr=filter_expr,
                    attrs=attrs,
                    base_dn=base_dn,
                )
            else:
                raise
    else:
        # NumPy crash — fallback to direct ldbsearch
        logger.info("[SDB] Using ldbsearch fallback (NumPy incompatible)")
        rows = _query_via_ldbsearch(
            database=database,
            filter_expr=filter_expr,
            attrs=attrs,
            base_dn=base_dn,
        )

    # Apply exclude filter (values are already flattened by _convert_records)
    if exclude:
        exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
        rows = [r for r in rows if str(r.get("sAMAccountName", "")) not in exclude_names]

    return rows


# ═══════════════════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════════════════


@router.get(
    "/databases",
    summary="List available Samba LDB databases",
)
async def list_databases(
    request: Request,
    api_key: ApiKeyDep,
) -> dict:
    """List all available Samba LDB databases with paths and descriptions."""
    try:
        from app.services.sdb_service import sdb_databases
        result = json.loads(sdb_databases())
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            # Fallback: return hardcoded database list
            result = {
                "success": True,
                "databases": {
                    "sam": {"description": "Main AD database", "path": "/var/lib/samba/private/sam.ldb", "exists": True},
                    "share": {"description": "Share definitions", "path": "/var/lib/samba/share.ldb", "exists": True},
                    "privilege": {"description": "Privilege definitions", "path": "/var/lib/samba/private/privilege.ldb", "exists": True},
                    "hklm": {"description": "Registry HKLM", "path": "/var/lib/samba/registry/hklm.ldb", "exists": True},
                    "idmap": {"description": "ID mapping", "path": "/var/lib/samba/private/idmap.ldb", "exists": True},
                    "secrets": {"description": "Secrets", "path": "/var/lib/samba/private/secrets.ldb", "exists": True},
                    "dns": {"description": "DNS zones", "path": "/var/lib/samba/private/dns/sam.ldb", "exists": True},
                },
                "note": "NumPy fallback — paths may not reflect actual state",
            }
        else:
            result = {"error": f"Failed to list databases: {exc}"}
    return result


# ═══════════════════════════════════════════════════════════════════════
#  /sdb/full/{N} and /sdb/info/{N} — web-friendly entity endpoints
#  v-a.1.2: Lightweight, web-oriented read endpoints that return only
#           the data the web frontend actually needs. No SDB script
#           engine required — uses ldbsearch directly (NumPy-safe).
#
#  Supported entity types N (case-insensitive):
#    users, groups, computers, ous, gpos, contacts, dns
# ═══════════════════════════════════════════════════════════════════════


# Map entity type → LDAP filter used to fetch all records of that type.
_ENTITY_FILTERS: Dict[str, str] = {
    "users":     "(&(objectClass=user)(sAMAccountType=805306368))",
    "groups":    "(objectClass=group)",
    "computers": "(objectClass=computer)",
    "ous":       "(objectClass=organizationalUnit)",
    "gpos":      "(objectClass=groupPolicyContainer)",
    "contacts":  "(objectClass=contact)",
    "dns":       "(objectClass=dnsNode)",
}

# Map entity type → recommended default fields for /full/ when client asks
# for "*" or omits the fields parameter. This keeps responses predictable
# and avoids dumping dozens of internal LDAP attributes into the web UI.
_DEFAULT_FULL_FIELDS: Dict[str, List[str]] = {
    "users":     ["sAMAccountName", "cn", "displayName", "mail",
                  "department", "title", "whenCreated", "lastLogon",
                  "userAccountControl", "memberOf", "dn"],
    "groups":    ["sAMAccountName", "cn", "description", "groupType",
                  "member", "whenCreated", "dn"],
    "computers": ["sAMAccountName", "cn", "operatingSystem",
                  "operatingSystemVersion", "lastLogon", "whenCreated",
                  "userAccountControl", "dn"],
    "ous":       ["ou", "name", "description", "whenCreated", "dn"],
    "gpos":      ["cn", "displayName", "gPCFileSysPath",
                  "versionNumber", "whenCreated", "dn"],
    "contacts":  ["cn", "displayName", "mail", "telephoneNumber",
                  "whenCreated", "dn"],
    "dns":       ["dc", "dnsRecord", "objectClass", "dn"],
}

# Aliases accepted from clients (Russian + English variants).
_ENTITY_ALIASES: Dict[str, str] = {
    "user": "users", "users": "users",
    "пользователь": "users", "пользователи": "users",
    "group": "groups", "groups": "groups",
    "группа": "groups", "группы": "groups",
    "computer": "computers", "computers": "computers",
    "компьютер": "computers", "компьютеры": "computers",
    "ou": "ous", "ous": "ous",
    "organizationalunit": "ous",
    "организационное подразделение": "ous",
    "организационные подразделения": "ous",
    "gpo": "gpos", "gpos": "gpos",
    "grouppolicy": "gpos",
    "групповая политика": "gpos",
    "групповые политики": "gpos",
    "contact": "contacts", "contacts": "contacts",
    "контакт": "contacts", "контакты": "contacts",
    "dns": "dns", "dns_records": "dns", "dnsrecords": "dns",
    "dns запись": "dns", "dns записи": "dns",
}


def _normalize_entity(n: str) -> str:
    """Normalize user-provided entity name to canonical key.

    Returns the canonical key (e.g. 'users') or raises HTTPException(404)
    if the entity type is unknown.
    """
    if not n:
        raise HTTPException(status_code=404, detail="Entity type required")
    key = n.strip().lower()
    canonical = _ENTITY_ALIASES.get(key, key)
    if canonical not in _ENTITY_FILTERS:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown entity type '{n}'. "
                f"Supported: {', '.join(sorted(_ENTITY_FILTERS.keys()))} "
                f"(also Russian names accepted)."
            ),
        )
    return canonical


def _parse_fields_param(fields: str) -> List[str]:
    """Parse comma-separated fields param into a list of attribute names."""
    if not fields:
        return []
    return [f.strip() for f in fields.split(",") if f.strip()]


def _fetch_entity_rows(
    entity: str,
    attrs: Optional[List[str]],
    where: str = "",
    exclude: str = "",
    limit: int = 0,
) -> List[Dict[str, Any]]:
    """Fetch records for an entity type, NumPy-safe (uses ldbsearch)."""
    filter_expr = _ENTITY_FILTERS[entity]

    rows = _query_records(
        database="sam",
        filter_expr=filter_expr,
        attrs=attrs,
        base_dn=None,
        exclude=exclude or "",
    )

    # Apply optional WHERE filter (client-side post-filter, like /select)
    if where:
        rows = [r for r in rows if _match_where(r, where)]

    # Apply limit
    if limit and limit > 0:
        rows = rows[:limit]

    return rows


def _project_fields(
    rows: List[Dict[str, Any]],
    fields: List[str],
) -> List[Dict[str, Any]]:
    """Project each row down to the requested fields (preserve order)."""
    if not fields or fields == ["*"]:
        return rows
    return [{k: rec.get(k, "") for k in fields} for rec in rows]


@router.get(
    "/full/{entity}",
    summary="Полный список записей сущности (web-friendly)",
    description=(
        "Возвращает полный список записей указанного типа сущности.\n\n"
        "Поддерживаемые типы: `users`, `groups`, `computers`, `ous`, "
        "`gpos`, `contacts`, `dns` (принимаются также русские названия).\n\n"
        "Параметр `fields`:\n"
        "- не указан → curated-набор (минимальный набор полей, удобный для веба)\n"
        "- `*` → ВСЕ атрибуты LDAP, которые есть у записей (без фильтрации)\n"
        "- `name,mail,...` → только конкретные поля\n\n"
        "Эндпоинт полностью NumPy-safe: использует ldbsearch напрямую, "
        "без SDB script engine и без pandas/numpy."
    ),
)
async def sdb_full_entity_endpoint(
    request: Request,
    entity: str,
    api_key: ApiKeyDep,                                  # ← BEFORE default params (fixes SyntaxError)
    fields: str = Query(
        default="*",
        description=(
            "Список атрибутов через запятую. "
            "`*` = все атрибуты LDAP (без фильтрации). "
            "Если параметр не указан — curated-набор для веба."
        ),
    ),
    where: str = Query(
        default="",
        description="Необязательный фильтр вида `cn=*Admin*` (post-filter).",
    ),
    exclude: str = Query(
        default="",
        description="Исключить sAMAccountName через запятую (например Administrator,Guest).",
    ),
    limit: int = Query(
        default=0,
        ge=0,
        description="Максимум записей (0 = все).",
    ),
) -> dict:
    """Полный список записей сущности с возможностью выбора атрибутов.

    Логика работы параметра `fields`:
      • не указан (или пустой)        → curated-набор для веба
      • `*`                            → ВСЕ атрибуты LDAP (без фильтрации)
      • `sAMAccountName,cn,mail`       → только указанные поля
    """
    canonical = _normalize_entity(entity)
    requested = _parse_fields_param(fields)

    # Three modes for fields parameter:
    #   - not specified (empty) → curated default set
    #   - '*' → ALL LDAP attributes (no projection, no attr filter)
    #   - specific list → fetch & project only those
    if not requested:
        # curated mode: query specific attrs + project to them in order
        attrs_for_query = list(_DEFAULT_FULL_FIELDS.get(canonical) or [])
        project_fields = list(attrs_for_query)
        fields_mode = "curated"
    elif requested == ["*"]:
        # ALL attributes: pass attrs=None to ldbsearch (returns everything),
        # do not project — preserve whatever LDB returned.
        attrs_for_query = None
        project_fields = []
        fields_mode = "all"
    else:
        attrs_for_query = requested
        project_fields = requested
        fields_mode = "specific"

    try:
        rows = _fetch_entity_rows(
            entity=canonical,
            attrs=attrs_for_query,
            where=where,
            exclude=exclude,
            limit=limit,
        )
    except Exception as exc:
        logger.exception("[SDB /full/%s] query failed", canonical)
        return {
            "success": False,
            "type": canonical,
            "error": f"Query failed: {exc}",
            "count": 0,
            "fields_mode": fields_mode,
            "fields": project_fields,
            "data": [],
        }

    # Project to the requested fields (preserves order, fills missing as "")
    # Only project in 'curated' and 'specific' modes; in 'all' mode return
    # whatever LDB gave us verbatim.
    if project_fields:
        data = _project_fields(rows, project_fields)
    else:
        data = rows
        # In 'all' mode, derive the actual field list from the first record
        # so the web frontend knows what columns came back.
        if data:
            seen = []
            seen_set = set()
            for rec in data:
                for k in rec.keys():
                    if k not in seen_set:
                        seen.append(k)
                        seen_set.add(k)
            project_fields = seen

    return {
        "success": True,
        "type": canonical,
        "count": len(data),
        "fields_mode": fields_mode,
        "fields": project_fields,
        "data": data,
    }


@router.get(
    "/info/{entity}",
    summary="Лёгкая информация о сущности (count или выбранные поля)",
    description=(
        "Возвращает лёгкую сводку по сущности — только то, что нужно вебу.\n\n"
        "Поддерживаемые типы: `users`, `groups`, `computers`, `ous`, "
        "`gpos`, `contacts`, `dns`.\n\n"
        "Параметр `fields`:\n"
        "- `count` (по умолчанию) → ответ `{'success': true, 'type': 'users', 'count': 17}`\n"
        "- `*` → ВСЕ атрибуты LDAP (без фильтрации)\n"
        "- `name,mail` → только указанные поля для каждой записи\n\n"
        "Эндпоинт оптимизирован для дашбордов: можно сначала получить "
        "только `count`, а потом дозагрузить нужные поля."
    ),
)
async def sdb_info_entity_endpoint(
    request: Request,
    entity: str,
    api_key: ApiKeyDep,                                  # ← BEFORE default params (fixes SyntaxError)
    fields: str = Query(
        default="count",
        description=(
            "Что вернуть: `count` (только количество, по умолчанию), "
            "`*` (ВСЕ атрибуты LDAP), или список конкретных атрибутов через запятую."
        ),
    ),
    where: str = Query(
        default="",
        description="Необязательный фильтр вида `cn=*Admin*` (применяется только если fields != count).",
    ),
    exclude: str = Query(
        default="",
        description="Исключить sAMAccountName через запятую.",
    ),
    limit: int = Query(
        default=0,
        ge=0,
        description="Максимум записей (0 = все). Применяется только если fields != count.",
    ),
) -> dict:
    """Лёгкая информация о сущности: count или выбранные поля.

    Логика работы параметра `fields`:
      • `count` (или не указан)        → только счётчик записей
      • `*`                            → ВСЕ атрибуты LDAP (без фильтрации)
      • `sAMAccountName,cn,mail`       → только указанные поля
    """
    canonical = _normalize_entity(entity)
    requested = _parse_fields_param(fields)

    # Mode 1: count only — cheapest possible query
    if not requested or requested == ["count"]:
        try:
            rows = _fetch_entity_rows(
                entity=canonical,
                attrs=None,            # let ldbsearch return minimal set
                where="",              # ignore WHERE in count mode
                exclude=exclude,
                limit=0,
            )
        except Exception as exc:
            logger.exception("[SDB /info/%s] count failed", canonical)
            return {
                "success": False,
                "type": canonical,
                "error": f"Count failed: {exc}",
                "count": 0,
            }
        return {
            "success": True,
            "type": canonical,
            "count": len(rows),
        }

    # Mode 2: '*' → ALL LDAP attributes, no projection
    if requested == ["*"]:
        attrs_for_query = None
        project_fields = []
        fields_mode = "all"
    else:
        # Mode 3: specific fields → fetch only those
        attrs_for_query = requested
        project_fields = requested
        fields_mode = "specific"

    try:
        rows = _fetch_entity_rows(
            entity=canonical,
            attrs=attrs_for_query,
            where=where,
            exclude=exclude,
            limit=limit,
        )
    except Exception as exc:
        logger.exception("[SDB /info/%s] query failed", canonical)
        return {
            "success": False,
            "type": canonical,
            "error": f"Query failed: {exc}",
            "count": 0,
            "fields_mode": fields_mode,
            "fields": project_fields,
            "data": [],
        }

    # Project only in 'specific' mode; in 'all' mode return LDB data verbatim
    if project_fields:
        data = _project_fields(rows, project_fields)
    else:
        data = rows
        # In 'all' mode, derive the actual field list from the records
        if data:
            seen = []
            seen_set = set()
            for rec in data:
                for k in rec.keys():
                    if k not in seen_set:
                        seen.append(k)
                        seen_set.add(k)
            project_fields = seen

    return {
        "success": True,
        "type": canonical,
        "count": len(data),
        "fields_mode": fields_mode,
        "fields": project_fields,
        "data": data,
    }


@router.post(
    "/query",
    summary="Execute SDB LDB query",
    description=(
        "Execute a direct LDB database query. Bypasses samba-tool, reads "
        "directly from LDB databases. Supports LDAP filters and attribute selection."
    ),
)
async def sdb_query_endpoint(
    request: Request,
    body: SdbQueryRequest,
    api_key: ApiKeyDep,
) -> dict:
    """Execute an SDB query against Samba LDB database."""
    attrs = [a.strip() for a in body.attrs.split(",") if a.strip()] if body.attrs else None

    try:
        from app.services.sdb_service import sdb_query
        result = json.loads(sdb_query(
            database=body.database,
            filter_expr=body.filter,
            attrs=attrs,
            base_dn=body.base_dn,
            fmt=body.format,
            exclude=body.exclude,
            limit=body.limit,
        ))
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            # Fallback: query directly via ldbsearch
            rows = _query_records(body.database, body.filter, attrs, body.base_dn, body.exclude)
            if body.limit > 0:
                rows = rows[:body.limit]
            result = {
                "success": True,
                "database": body.database,
                "filter": body.filter,
                "rows": len(rows),
                "columns": list(rows[0].keys()) if rows else [],
                "data": rows[:50],
                "total_rows": len(rows),
                "note": "Queried via ldbsearch fallback (NumPy incompatible)",
            }
        else:
            result = {"error": f"SDB query failed: {exc}"}
    return result


@router.post(
    "/select",
    summary="SQL-like SELECT query",
    description=(
        "Execute SQL-like SELECT query against AD objects. "
        "Examples: SELECT sAMAccountName,cn,mail FROM USERS; "
        "SELECT * FROM GROUPS WHERE cn=*Admin*"
    ),
)
async def sdb_select_endpoint(
    request: Request,
    body: SdbSelectRequest,
    api_key: ApiKeyDep,
) -> dict:
    """Execute SQL-like SELECT query via SDB.

    If SDB engine returns 0 rows with WHERE clause (known bug in sdb_lib
    WHERE parsing), falls back to ldbsearch with post-filtering.
    """
    try:
        from app.services.sdb_service import sdb_select

        export_path = None
        if body.filename:
            export_dir = _get_export_dir()
            os.makedirs(export_dir, exist_ok=True)
            export_path = os.path.join(export_dir, os.path.basename(body.filename))

        result = json.loads(sdb_select(
            fields=body.fields,
            scope=body.scope,
            where=body.where,
            fmt=body.format,
            export_path=export_path,
        ))

        if body.filename and result.get("export", {}).get("success"):
            result["export"]["download_url"] = f"/api/v1/sdb/exports/{os.path.basename(body.filename)}"

        # If SDB returned 0 rows with WHERE, try ldbsearch fallback
        # (SDB script engine WHERE has known bugs with list-valued attrs)
        if body.where and result.get("success") and result.get("rows", 0) == 0:
            logger.info("[SDB] SDB SELECT returned 0 rows with WHERE, trying ldbsearch fallback")
            scope_filters = {
                "USERS": "(&(objectClass=user)(sAMAccountType=805306368))",
                "GROUPS": "(objectClass=group)",
                "COMPUTERS": "(objectClass=computer)",
                "OUS": "(objectClass=organizationalUnit)",
                "GPOS": "(objectClass=groupPolicyContainer)",
                "CONTACTS": "(objectClass=contact)",
                "DNS_RECORDS": "(objectClass=dnsNode)",
            }
            filter_expr = scope_filters.get(body.scope.upper(), "(objectClass=*)")
            attrs = [a.strip() for a in body.fields.split(",") if a.strip()] if body.fields != "*" else None
            rows = _query_via_ldbsearch("sam", filter_expr, attrs)
            # Flatten records
            rows = [_flatten_record(r) for r in rows]
            # Apply WHERE filter
            rows = [r for r in rows if _match_where(r, body.where)]
            if rows:
                result = {
                    "success": True,
                    "query": f"SELECT {body.fields} FROM {body.scope} WHERE {body.where} (ldbsearch fallback)",
                    "rows": len(rows),
                    "columns": list(rows[0].keys()) if rows else [],
                    "data": rows[:50],
                    "total_rows": len(rows),
                    "preview_rows": min(len(rows), 50),
                    "note": "SDB WHERE bug workaround: used ldbsearch + post-filter",
                }
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            # Fallback: use ldbsearch with predefined filters for each scope
            scope_filters = {
                "USERS": "(&(objectClass=user)(sAMAccountType=805306368))",
                "GROUPS": "(objectClass=group)",
                "COMPUTERS": "(objectClass=computer)",
                "OUS": "(objectClass=organizationalUnit)",
                "GPOS": "(objectClass=groupPolicyContainer)",
                "CONTACTS": "(objectClass=contact)",
                "DNS_RECORDS": "(objectClass=dnsNode)",
            }
            filter_expr = scope_filters.get(body.scope.upper(), "(objectClass=*)")
            attrs = [a.strip() for a in body.fields.split(",") if a.strip()] if body.fields != "*" else None
            rows = _query_via_ldbsearch("sam", filter_expr, attrs)
            if body.where:
                # Simple where filter: cn=*Admin*
                rows = [r for r in rows if _match_where(r, body.where)]
            result = {
                "success": True,
                "query": f"SELECT {body.fields} FROM {body.scope}" + (f" WHERE {body.where}" if body.where else ""),
                "rows": len(rows),
                "columns": list(rows[0].keys()) if rows else [],
                "data": rows[:50],
                "total_rows": len(rows),
                "note": "Queried via ldbsearch fallback (NumPy incompatible)",
            }
        else:
            result = {"error": f"SDB SELECT failed: {exc}"}
    return result


def _match_where(record: dict, where: str) -> bool:
    """Simple WHERE matching: field=*pattern* or field=value.

    Handles both scalar and list values (LDB returns lists).
    For list values, checks if ANY element matches.
    """
    if "=" not in where:
        return True
    field, _, pattern = where.partition("=")
    field = field.strip()
    pattern = pattern.strip()

    # Get value (already flattened by _convert_records, but just in case)
    raw_val = record.get(field, "")
    if isinstance(raw_val, list):
        # Check if ANY element in the list matches
        return any(_match_pattern(str(v), pattern) for v in raw_val)
    else:
        return _match_pattern(str(raw_val), pattern)


def _match_pattern(val: str, pattern: str) -> bool:
    """Match a value against a pattern with * wildcards."""
    if pattern.startswith("*") and pattern.endswith("*"):
        return pattern[1:-1].lower() in val.lower()
    elif pattern.startswith("*"):
        return val.lower().endswith(pattern[1:].lower())
    elif pattern.endswith("*"):
        return val.lower().startswith(pattern[:-1].lower())
    else:
        return val.lower() == pattern.lower()


@router.post(
    "/show",
    summary="Show AD object from database",
    description=(
        "Show AD object details directly from LDB database (not via samba-tool). "
        "Works even when samba-tool can't connect to DC."
    ),
)
async def sdb_show_endpoint(
    request: Request,
    body: SdbShowRequest,
    api_key: ApiKeyDep,
) -> dict:
    """Show AD object from database via SDB."""
    try:
        from app.services.sdb_service import sdb_show
        result = json.loads(sdb_show(
            object_type=body.object_type,
            name=body.name,
            fmt=body.format,
        ))
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            # Fallback: query via ldbsearch
            obj_filters = {
                "user": "(&(objectClass=user)(sAMAccountType=805306368))",
                "group": "(objectClass=group)",
                "computer": "(objectClass=computer)",
                "ou": "(objectClass=organizationalUnit)",
                "gpo": "(objectClass=groupPolicyContainer)",
                "contact": "(objectClass=contact)",
                "dns": "(objectClass=dnsNode)",
            }
            filter_expr = obj_filters.get(body.object_type.lower(), "(objectClass=*)")
            if body.name:
                filter_expr = f"(&{filter_expr}(cn={body.name}))"
            rows = _query_via_ldbsearch("sam", filter_expr)
            result = {
                "success": True,
                "object_type": body.object_type,
                "name": body.name,
                "rows": len(rows),
                "data": rows[:50],
                "note": "Queried via ldbsearch fallback (NumPy incompatible)",
            }
        else:
            result = {"error": f"SDB show failed: {exc}"}
    return result


@router.post(
    "/script",
    summary="Execute SDB script",
    description=(
        "Execute SDB DSL script with multiple commands. "
        "Commands: USE, SELECT, FORMAT, OUTPUT, SHOW, TOOL, LIST, "
        "ENABLE, DISABLE, DELETE, SYNTHESIS, FIELDS, LIMIT, SEARCH, DATAFRAME."
    ),
)
async def sdb_script_endpoint(
    request: Request,
    body: SdbScriptRequest,
    api_key: ApiKeyDep,
) -> dict:
    """Execute SDB script."""
    try:
        from app.services.sdb_service import sdb_script

        export_path = None
        if body.filename:
            export_dir = _get_export_dir()
            os.makedirs(export_dir, exist_ok=True)
            export_path = os.path.join(export_dir, os.path.basename(body.filename))

        result = json.loads(sdb_script(
            script_text=body.script,
            export_path=export_path,
        ))
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            result = {
                "error": "SDB script engine unavailable (NumPy incompatible). Use individual endpoints instead.",
                "hint": "Use /sdb/query, /sdb/select, /sdb/export endpoints as alternatives.",
            }
        else:
            result = {"error": f"SDB script failed: {exc}"}
    return result


@router.get(
    "/synthesis",
    summary="Analyze AD database schema",
    description=(
        "Run SYNTHESIS analysis on the Samba AD schema. "
        "Sub-commands: SCHEMA, ENTITY, RELATION, ASSOCIATION, NORMALIZE."
    ),
)
async def sdb_synthesis_endpoint(
    request: Request,
    api_key: ApiKeyDep,                              # ← BEFORE default params (fixes SyntaxError)
    subcmd: str = Query(default="SCHEMA", description="SYNTHESIS sub-command"),
) -> dict:
    """Analyze AD database schema via SDB SYNTHESIS."""
    try:
        from app.services.sdb_service import sdb_synthesis
        result = json.loads(sdb_synthesis(subcmd=subcmd))
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        if "NumPy" in str(exc) or "X86_V2" in str(exc):
            result = {
                "error": "SYNTHESIS requires SDB engine (NumPy incompatible on this server)",
                "hint": "Use /sdb/query to inspect schema attributes directly.",
            }
        else:
            result = {"error": f"SDB SYNTHESIS failed: {exc}"}
    return result


# ═══════════════════════════════════════════════════════════════════════
#  Export + Download (completely NumPy-free, ZIP support)
#  This path NEVER imports sdb_service for formatting.
#  All formatting is done locally with openpyxl + stdlib.
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/export",
    summary="One-step export AD data to file (ZIP download)",
    description=(
        "One-step export: query LDB database + format + save file. "
        "Returns download_url for web access. "
        "Format by filename extension: .xlsx, .csv, .json, .tsv, .ldif. "
        "By default exports as .zip (as_zip=true). "
        "Uses openpyxl directly — no NumPy/pandas dependency. "
        "Falls back to ldbsearch if SDB client can't initialize."
    ),
)
async def sdb_export_endpoint(
    request: Request,
    body: SdbExportRequest,
    api_key: ApiKeyDep,
) -> dict:
    """One-step export AD data to downloadable file (ZIP archive).

    This endpoint is completely NumPy-safe:
    1. Tries SDB client for query (fast, feature-rich)
    2. Falls back to ldbsearch subprocess if NumPy crashes
    3. All formatting uses openpyxl + stdlib (never pandas/NumPy)
    4. ZIP packaging is done with Python's zipfile module
    """
    export_dir = _get_export_dir()
    os.makedirs(export_dir, exist_ok=True)

    # Parse attrs
    attrs = [a.strip() for a in body.attrs.split(",") if a.strip()] if body.attrs else None

    # Query records (NumPy-safe: uses _query_records which has ldbsearch fallback)
    try:
        rows = _query_records(body.database, body.filter, attrs, body.base_dn, body.exclude)
    except Exception as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg:
            # Double fallback — should not reach here, but just in case
            logger.error("[SDB] NumPy crash during export query, using direct ldbsearch")
            rows = _query_via_ldbsearch(body.database, body.filter, attrs, body.base_dn)
            if body.exclude:
                exclude_names = {n.strip() for n in body.exclude.split(",") if n.strip()}
                rows = [r for r in rows if r.get("sAMAccountName", "") not in exclude_names]
        else:
            return {"success": False, "error": f"Query failed: {exc}"}

    if not rows:
        return {"success": False, "error": "No records found to export", "rows": 0}

    # Determine format and convert
    ext = os.path.splitext(body.filename)[1].lower()
    try:
        file_bytes = _format_records(rows, ext, attrs)
    except Exception as exc:
        return {"success": False, "error": f"Format conversion failed: {exc}"}

    fmt = _get_format_name(ext)

    # Save raw file
    raw_filepath = os.path.join(export_dir, os.path.basename(body.filename))
    with open(raw_filepath, "wb") as f:
        f.write(file_bytes)

    # Package as ZIP
    if body.as_zip:
        zip_name = body.zip_name or "Samba-api-server-1.9-3.zip"
        zip_bytes = _create_zip_bytes(os.path.basename(body.filename), file_bytes)
        zip_filepath = os.path.join(export_dir, zip_name)
        with open(zip_filepath, "wb") as f:
            f.write(zip_bytes)

        # Build download URL with server base
        download_url = f"/api/v1/sdb/exports/{zip_name}"
        download_url_full = f"http://127.0.0.1:8099/api/v1/sdb/exports/{zip_name}"
        try:
            from app.config import get_settings
            settings = get_settings()
            api_base = getattr(settings, "AI_API_BASE", "http://127.0.0.1:8099")
            download_url_full = f"{api_base}/api/v1/sdb/exports/{zip_name}"
        except Exception:
            pass

        return {
            "success": True,
            "path": zip_filepath,
            "filename": zip_name,
            "inner_filename": os.path.basename(body.filename),
            "download_url": download_url,
            "download_url_full": download_url_full,
            "format": fmt,
            "rows": len(rows),
            "size_bytes": len(zip_bytes),
            "raw_size_bytes": len(file_bytes),
        }
    else:
        download_url = f"/api/v1/sdb/exports/{os.path.basename(body.filename)}"
        return {
            "success": True,
            "path": raw_filepath,
            "filename": os.path.basename(body.filename),
            "download_url": download_url,
            "format": fmt,
            "rows": len(rows),
            "size_bytes": len(file_bytes),
        }


@router.get(
    "/export-download",
    summary="One-step export and immediately download as ZIP",
    description=(
        "Query + export + download in one GET request. "
        "Returns the ZIP file directly as streaming download. "
        "Default ZIP name: Samba-api-server-1.9-3.zip"
    ),
)
async def sdb_export_download_endpoint(
    request: Request,
    api_key: ApiKeyDep,
    database: str = Query(default="sam", description="LDB database name"),
    filter: str = Query(default="", description="LDAP filter expression"),
    filename: str = Query(default="export.xlsx", description="Output filename"),
    attrs: str = Query(default="", description="Comma-separated attributes"),
    exclude: str = Query(default="", description="Comma-separated sAMAccountNames to exclude"),
    zip_name: str = Query(default="Samba-api-server-1.9-3.zip", description="ZIP filename"),
) -> StreamingResponse:
    """Export and immediately stream download as ZIP (NumPy-safe)."""
    attr_list = [a.strip() for a in attrs.split(",") if a.strip()] if attrs else None

    # Query (NumPy-safe: _query_records handles fallback internally)
    try:
        rows = _query_records(database, filter, attr_list, None, exclude)
    except Exception as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy crash in export-download, ldbsearch fallback")
            rows = _query_via_ldbsearch(database, filter, attr_list)
            if exclude:
                exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
                rows = [r for r in rows if str(r.get("sAMAccountName", "")) not in exclude_names]
        else:
            raise HTTPException(status_code=500, detail=f"Query failed: {exc}")

    if not rows:
        raise HTTPException(status_code=404, detail="No records found to export")

    # Format
    ext = os.path.splitext(filename)[1].lower()
    try:
        file_bytes = _format_records(rows, ext, attr_list)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Format failed: {exc}")

    # ZIP
    zip_bytes = _create_zip_bytes(os.path.basename(filename), file_bytes)

    # Save to disk
    export_dir = _get_export_dir()
    os.makedirs(export_dir, exist_ok=True)
    zip_path = os.path.join(export_dir, zip_name)
    with open(zip_path, "wb") as f:
        f.write(zip_bytes)

    # Stream
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_name}"',
            "X-Export-Rows": str(len(rows)),
            "X-Export-Format": ext.lstrip('.'),
            "X-Zip-Size": str(len(zip_bytes)),
        },
    )


@router.get(
    "/exports",
    summary="List all SDB export files",
)
async def list_sdb_exports(
    request: Request,
    api_key: ApiKeyDep,
) -> dict:
    """List all exported files available for download."""
    export_dir = _get_export_dir()

    if not os.path.isdir(export_dir):
        return {"files": [], "total": 0, "export_dir": export_dir}

    files = []
    try:
        for fname in sorted(os.listdir(export_dir)):
            fpath = os.path.join(export_dir, fname)
            if os.path.isfile(fpath):
                stat = os.stat(fpath)
                files.append({
                    "filename": fname,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "download_url": f"/api/v1/sdb/exports/{fname}",
                })
    except Exception as exc:
        logger.error("[SDB] Failed to list exports: %s", exc)
        return {"files": [], "total": 0, "error": str(exc)}

    return {"files": files, "total": len(files), "export_dir": export_dir}


@router.get(
    "/exports/{filename}",
    summary="Download an exported file",
)
async def download_sdb_export(
    request: Request,
    api_key: ApiKeyDep,
    filename: str,
) -> FileResponse:
    """Download an exported file by filename."""
    export_dir = _get_export_dir()

    safe_filename = os.path.basename(filename)
    if safe_filename != filename:
        raise HTTPException(status_code=400, detail="Invalid filename (path separators not allowed)")

    filepath = os.path.join(export_dir, safe_filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"File '{safe_filename}' not found")

    if not os.path.isfile(filepath):
        raise HTTPException(status_code=400, detail=f"'{safe_filename}' is not a file")

    ext = os.path.splitext(safe_filename)[1].lower()
    media_types = {
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".csv": "text/csv",
        ".json": "application/json",
        ".tsv": "text/tab-separated-values",
        ".ldif": "text/plain",
        ".png": "image/png",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".zip": "application/zip",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=filepath,
        filename=safe_filename,
        media_type=media_type,
    )
