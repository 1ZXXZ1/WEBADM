"""
SDB Service - wrapper for SDB (Samba Database Query Tool) integration.

Provides a high-level API for:
  - Direct Samba LDB database queries (1-step instead of N-step via shell)
  - samba-tool commands via SDB connectors
  - SDB script execution for batch operations
  - Data export in multiple formats (JSON, CSV, XLSX, TSV, LDIF, DataFrame)
  - SQL-like SELECT queries against AD objects
  - SYNTHESIS schema analysis

This enables the AI agent to perform complex AD data operations in ONE step,
replacing the typical 10-24 step approach with ldbsearch_ad + data_import +
data_transform + data_export chains.

v1.0: Initial integration with SDB v1.2.3-5
v1.9-3: NumPy-free export (uses openpyxl directly, no pandas/NumPy dependency).
         Fixed X86_V2 CPU compatibility error on older servers.
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile as zipfile_mod
import tempfile
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Lazy-loaded SDB client singleton
_sdb_client = None


def _get_sdb_client():
    """Get or create SdbClient instance (singleton)."""
    global _sdb_client
    if _sdb_client is None:
        try:
            from app.sdb_lib import SdbClient
            _sdb_client = SdbClient(default_database="sam", use_sudo=True)
            logger.info("[SDB] SdbClient initialized successfully")
        except Exception as exc:
            logger.error("[SDB] Failed to initialize SdbClient: %s", exc)
            raise
    return _sdb_client


def _reset_client():
    """Reset the SDB client (for testing or after errors)."""
    global _sdb_client
    _sdb_client = None


# ═══════════════════════════════════════════════════════════════════════
#  NumPy-free XLSX export (openpyxl only)
# ═══════════════════════════════════════════════════════════════════════


def _xlsx_export_openpyxl(
    rows: List[Dict[str, Any]],
    filepath: str,
    fields: Optional[List[str]] = None,
    sheet_name: str = "Data",
) -> str:
    """Export list of dicts to XLSX using openpyxl directly (no NumPy/pandas).

    This avoids the NumPy X86_V2 CPU compatibility error.
    """
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise ImportError(
            "openpyxl is required for XLSX export. Install: pip install openpyxl"
        )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]

    if not rows:
        wb.active.title = "Empty"
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        wb.save(filepath)
        return filepath

    # Determine columns
    if fields and fields != ["*"]:
        columns = list(fields)
    else:
        columns = []
        seen = set()
        priority = ["sAMAccountName", "cn", "name", "displayName", "objectClass",
                     "description", "mail", "department", "ou", "dn"]
        for attr in priority:
            for rec in rows:
                if attr in rec and attr not in seen:
                    columns.append(attr)
                    seen.add(attr)
                    break
        for rec in rows:
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

    # Write headers
    for col_idx, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=col_idx, value=str(col_name).upper())
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    # Write data
    data_font = Font(size=10)
    data_align = Alignment(vertical="top", wrap_text=True)

    for row_idx, rec in enumerate(rows, 2):
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

    # Auto-width columns
    for col_idx in range(1, len(columns) + 1):
        max_len = 0
        col_letter = get_column_letter(col_idx)
        for row in ws.iter_rows(min_row=1, max_row=min(len(rows) + 1, 100),
                                 min_col=col_idx, max_col=col_idx):
            for cell in row:
                if cell.value:
                    max_len = max(max_len, len(str(cell.value)))
        adjusted_width = min(max(max_len + 2, 8), 50)
        ws.column_dimensions[col_letter].width = adjusted_width

    # Auto-filter
    if columns:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(rows) + 1}"

    # Freeze header
    ws.freeze_panes = "A2"

    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    wb.save(filepath)
    return filepath


def _write_records_to_file(
    rows: List[Dict[str, Any]],
    filepath: str,
    fmt: str = "xlsx",
    fields: Optional[List[str]] = None,
) -> str:
    """Write records to file using NumPy-free export methods.

    Supported formats: xlsx, csv, json, tsv, ldif
    XLSX uses openpyxl directly (no pandas/NumPy).
    CSV/TSV/JSON/LDIF use standard library.
    """
    ext = os.path.splitext(filepath)[1].lower()
    if ext in ('.xlsx', '.xls'):
        fmt = 'xlsx'
    elif ext == '.csv':
        fmt = 'csv'
    elif ext == '.json':
        fmt = 'json'
    elif ext == '.tsv':
        fmt = 'tsv'
    elif ext == '.ldif':
        fmt = 'ldif'

    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

    if fmt == 'xlsx':
        return _xlsx_export_openpyxl(rows, filepath, fields=fields)

    elif fmt == 'csv':
        import csv
        if not rows:
            with open(filepath, 'w', encoding='utf-8') as f:
                pass
            return filepath
        if fields and fields != ["*"]:
            columns = list(fields)
        else:
            columns = []
            seen = set()
            for rec in rows:
                for key in rec.keys():
                    if key not in seen:
                        columns.append(key)
                        seen.add(key)
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            for rec in rows:
                row = {}
                for col in columns:
                    val = rec.get(col, "")
                    if isinstance(val, (list, dict)):
                        val = json.dumps(val, ensure_ascii=False, default=str)
                    elif val is None:
                        val = ""
                    row[col] = val
                writer.writerow(row)
        return filepath

    elif fmt == 'json':
        data = rows
        if fields and fields != ["*"]:
            data = [{k: rec.get(k, "") for k in fields if k in rec} for rec in rows]
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        return filepath

    elif fmt == 'tsv':
        if not rows:
            with open(filepath, 'w', encoding='utf-8') as f:
                pass
            return filepath
        if fields and fields != ["*"]:
            columns = list(fields)
        else:
            columns = []
            seen = set()
            for rec in rows:
                for key in rec.keys():
                    if key not in seen:
                        columns.append(key)
                        seen.add(key)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("\t".join(columns) + "\n")
            for rec in rows:
                row_vals = []
                for col in columns:
                    val = rec.get(col, "")
                    if isinstance(val, (list, dict)):
                        val = json.dumps(val, ensure_ascii=False, default=str)
                    elif val is None:
                        val = ""
                    row_vals.append(str(val).replace("\t", " ").replace("\n", " "))
                f.write("\t".join(row_vals) + "\n")
        return filepath

    elif fmt == 'ldif':
        lines = []
        for rec in rows:
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
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines))
        return filepath

    else:
        # Default to CSV
        return _write_records_to_file(rows, filepath, fmt='csv', fields=fields)


def _flatten_value(val: Any) -> Any:
    """Flatten LDB list values to scalars where possible."""
    if isinstance(val, list):
        if len(val) == 0:
            return ""
        elif len(val) == 1:
            return val[0] if not isinstance(val[0], list) else _flatten_value(val[0])
        else:
            return ", ".join(str(v) for v in val if v)
    return val


def _flatten_record(row: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten all list values in a record dict to scalars."""
    return {key: _flatten_value(val) for key, val in row.items()}


def _convert_records(records: list) -> List[Dict[str, Any]]:
    """Convert LdifRecord objects or dicts to flat dicts with scalar values.

    LDB returns attributes as lists (e.g. sAMAccountName=['admin']).
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


# ═══════════════════════════════════════════════════════════════════════
#  Core SDB Operations for AI Agent
# ═══════════════════════════════════════════════════════════════════════


def sdb_query(
    database: str = "sam",
    filter_expr: str = "",
    attrs: Optional[List[str]] = None,
    base_dn: Optional[str] = None,
    fmt: str = "json",
    exclude: str = "",
    limit: int = 0,
    export_path: Optional[str] = None,
) -> str:
    """Execute an SDB query and return results.

    This is the primary 1-step operation that replaces multi-step
    ldbsearch_ad + data_import + data_transform + data_export chains.
    """
    # Try SDB client first, fall back to ldbsearch if NumPy crashes
    client = None
    try:
        client = _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible in sdb_query, using ldbsearch fallback: %s", err_msg)
            client = None
        else:
            return json.dumps({"error": f"SDB client init failed: {exc}"})

    if client is not None:
        try:
            # Switch database if needed
            if database.lower() != "sam":
                try:
                    client.use_database(database)
                except Exception as exc:
                    return json.dumps({"error": f"Failed to switch to database '{database}': {exc}"})

            # Execute query
            records = client.query(
                database=database,
                filter_expr=filter_expr,
                attrs=attrs,
                base_dn=base_dn,
            )

            if not records:
                return json.dumps({
                    "success": True,
                    "database": database,
                    "filter": filter_expr,
                    "rows": 0,
                    "data": [],
                    "message": "No records found",
                })

            # Apply exclude filter (records are now flattened by _convert_records)
            if exclude:
                exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
                records = [
                    r for r in records
                    if (r.get("sAMAccountName", "") if isinstance(r, dict) else
                        r.attrs.get("sAMAccountName", "") if hasattr(r, 'attrs') else "") not in exclude_names
                ]

        except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                logger.warning("[SDB] NumPy crash during query, using ldbsearch fallback: %s", err_msg)
                client = None  # Fall through to ldbsearch fallback below
            else:
                return json.dumps({"error": f"SDB query failed: {exc}"})

    if client is None:
        # Fallback: direct ldbsearch (no NumPy needed)
        logger.info("[SDB] Using ldbsearch fallback for query")
        from app.routers.sdb import _query_via_ldbsearch, _flatten_record
        raw_rows = _query_via_ldbsearch(database, filter_expr, attrs, base_dn)
        records = raw_rows  # Already flattened by _query_via_ldbsearch

        if not records:
            return json.dumps({
                "success": True,
                "database": database,
                "filter": filter_expr,
                "rows": 0,
                "data": [],
                "message": "No records found (ldbsearch fallback)",
            })

        # Apply exclude filter
        if exclude:
            exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
            records = [r for r in records if str(r.get("sAMAccountName", "")) not in exclude_names]

        # Apply limit
        if limit > 0:
            records = records[:limit]

    # Convert LdifRecords to dicts (flattens list values)
    rows = _convert_records(records)

    # Export to file if requested (NumPy-free)
    export_info = None
    if export_path:
        try:
            _write_records_to_file(rows, export_path, fmt=fmt, fields=attrs)
            export_info = {
                "success": True,
                "path": export_path,
                "filename": os.path.basename(export_path),
                "format": fmt,
            }
        except Exception as exc:
            export_info = {"error": f"Export failed: {exc}"}

    # Format output for AI consumption
    result = {
        "success": True,
        "database": database,
        "filter": filter_expr,
        "rows": len(rows),
        "columns": list(rows[0].keys()) if rows else [],
        "data": rows[:50],  # Preview: first 50 rows
        "total_rows": len(rows),
        "preview_rows": min(len(rows), 50),
    }

    if client is None:
        result["note"] = "Queried via ldbsearch fallback (NumPy incompatible)"

    if export_info:
        result["export"] = export_info

    return json.dumps(result, ensure_ascii=False, default=str)


def sdb_show(
    object_type: str,
    name: str = "",
    fmt: str = "json",
    export_path: Optional[str] = None,
) -> str:
    """Show AD objects via SDB SHOW command (direct LDB access).

    Falls back to ldbsearch if SDB client can't initialize (NumPy X86_V2).
    """
    # Try SDB client first
    client = None
    try:
        client = _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible in sdb_show, using ldbsearch fallback: %s", err_msg)
            client = None
        else:
            return json.dumps({"error": f"SDB client init failed: {exc}"})

    if client is not None:
        try:
            engine = client._engine

            # Build SDB script command
            if name:
                script = f'SHOW {object_type.upper()} "{name}"'
            else:
                script = f'SHOW {object_type.upper()}'

            if fmt and fmt != "table":
                script = f'FORMAT {fmt}\n{script}'

            # Execute
            engine.execute(script)
            records = engine.last_records

            # Convert to dicts (flattens list values)
            rows = _convert_records(records or [])

            # If SDB returned 0 rows but name was given, try ldbsearch fallback
            if name and len(rows) == 0:
                logger.info("[SDB] SDB SHOW returned 0 rows for name='%s', trying ldbsearch fallback", name)
                client = None  # Fall through to ldbsearch below

        except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                logger.warning("[SDB] NumPy crash during show, using ldbsearch fallback: %s", err_msg)
                client = None
                rows = []
            else:
                return json.dumps({"error": f"SDB show failed: {exc}"})

    if client is None:
        # Fallback: direct ldbsearch (no NumPy)
        logger.info("[SDB] Using ldbsearch fallback for show")
        from app.routers.sdb import _query_via_ldbsearch
        obj_filters = {
            "user": "(&(objectClass=user)(sAMAccountType=805306368))",
            "group": "(objectClass=group)",
            "computer": "(objectClass=computer)",
            "ou": "(objectClass=organizationalUnit)",
            "gpo": "(objectClass=groupPolicyContainer)",
            "contact": "(objectClass=contact)",
            "dns": "(objectClass=dnsNode)",
        }
        filter_expr = obj_filters.get(object_type.lower(), "(objectClass=*)")
        if name:
            # Try multiple name matching strategies
            filter_expr = f"(&{filter_expr}(|(cn={name})(sAMAccountName={name})(name={name})))"
        rows = _query_via_ldbsearch("sam", filter_expr)

    # Export if requested (NumPy-free)
    export_info = None
    if export_path and rows:
        try:
            _write_records_to_file(rows, export_path, fmt=fmt, fields=None)
            export_info = {
                "success": True,
                "path": export_path,
                "filename": os.path.basename(export_path),
            }
        except Exception as exc:
            export_info = {"error": f"Export failed: {exc}"}

    result = {
        "success": True,
        "object_type": object_type,
        "name": name,
        "rows": len(rows),
        "data": rows[:50],
        "total_rows": len(rows),
    }
    if client is None:
        result["note"] = "Queried via ldbsearch fallback (NumPy incompatible)"
    if export_info:
        result["export"] = export_info

    return json.dumps(result, ensure_ascii=False, default=str)


def sdb_select(
    fields: str = "*",
    scope: str = "USERS",
    where: str = "",
    fmt: str = "json",
    export_path: Optional[str] = None,
) -> str:
    """Execute SQL-like SELECT query via SDB.

    Falls back to ldbsearch if SDB client can't initialize (NumPy X86_V2).
    Also falls back if SDB WHERE parsing returns 0 rows for a non-empty WHERE.
    """
    # Try SDB client first
    client = None
    try:
        client = _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible in sdb_select, using ldbsearch fallback: %s", err_msg)
            client = None
        else:
            return json.dumps({"error": f"SDB client init failed: {exc}"})

    rows = []
    script = ""

    if client is not None:
        try:
            engine = client._engine

            # Build SDB script
            script_parts = []
            if fmt and fmt != "table":
                script_parts.append(f'FORMAT {fmt}')

            if fields == "*":
                script_parts.append(f'SELECT * FROM {scope}')
            else:
                field_list = ", ".join(f.strip() for f in fields.split(","))
                script_parts.append(f'SELECT {field_list} FROM {scope}')

            if where:
                script_parts[0 if fmt == "table" else 1] += f' WHERE {where}'

            script = "\n".join(script_parts)

            # Execute
            engine.execute(script)
            records = engine.last_records

            # Convert to dicts (flattens list values)
            rows = _convert_records(records or [])

            # If SDB returned 0 rows with WHERE, try ldbsearch fallback
            if where and len(rows) == 0:
                logger.info("[SDB] SDB SELECT returned 0 rows with WHERE, trying ldbsearch fallback")
                client = None  # Fall through to ldbsearch below

        except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                logger.warning("[SDB] NumPy crash during select, using ldbsearch fallback: %s", err_msg)
                client = None
            else:
                return json.dumps({"error": f"SDB SELECT failed: {exc}"})

    if client is None:
        # Fallback: direct ldbsearch with WHERE post-filtering
        logger.info("[SDB] Using ldbsearch fallback for select")
        from app.routers.sdb import _query_via_ldbsearch, _match_where, _flatten_record

        scope_filters = {
            "USERS": "(&(objectClass=user)(sAMAccountType=805306368))",
            "GROUPS": "(objectClass=group)",
            "COMPUTERS": "(objectClass=computer)",
            "OUS": "(objectClass=organizationalUnit)",
            "GPOS": "(objectClass=groupPolicyContainer)",
            "CONTACTS": "(objectClass=contact)",
            "DNS_RECORDS": "(objectClass=dnsNode)",
        }
        filter_expr = scope_filters.get(scope.upper(), "(objectClass=*)")
        attrs = [a.strip() for a in fields.split(",") if a.strip()] if fields != "*" else None
        raw_rows = _query_via_ldbsearch("sam", filter_expr, attrs)
        rows = raw_rows  # Already flattened by _query_via_ldbsearch

        # Apply WHERE filter
        if where:
            rows = [r for r in rows if _match_where(r, where)]

    # Export if requested (NumPy-free)
    export_info = None
    if export_path and rows:
        try:
            _write_records_to_file(rows, export_path, fmt=fmt, fields=None)
            export_info = {
                "success": True,
                "path": export_path,
                "filename": os.path.basename(export_path),
            }
        except Exception as exc:
            export_info = {"error": f"Export failed: {exc}"}

    result = {
        "success": True,
        "query": script or f"SELECT {fields} FROM {scope}" + (f" WHERE {where}" if where else ""),
        "rows": len(rows),
        "columns": list(rows[0].keys()) if rows else [],
        "data": rows[:50],
        "total_rows": len(rows),
        "preview_rows": min(len(rows), 50),
    }
    if client is None:
        result["note"] = "Queried via ldbsearch fallback (SDB WHERE bug workaround or NumPy incompatible)"
    if export_info:
        result["export"] = export_info

    return json.dumps(result, ensure_ascii=False, default=str)


def sdb_script(
    script_text: str,
    export_path: Optional[str] = None,
) -> str:
    """Execute an SDB script (DSL with multi-command support).

    Falls back to simple ldbsearch if SDB client can't initialize.
    """
    # Try SDB client first
    client = None
    try:
        client = _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible in sdb_script: %s", err_msg)
            client = None
        else:
            return json.dumps({"error": f"SDB client init failed: {exc}"})

    if client is None:
        # SDB script engine not available — provide helpful error
        return json.dumps({
            "success": False,
            "error": "SDB script engine unavailable (NumPy incompatible on this server)",
            "hint": "Use individual endpoints instead: /sdb/query, /sdb/select, /sdb/export",
            "alternative": "POST /report/generate for one-step multi-sheet XLSX report",
        })

    try:
        # Add OUTPUT command if export_path specified
        if export_path:
            script_text = f'{script_text}\nOUTPUT {export_path}'

        # Execute
        script_result = client.run_script(script_text)

        # Get last records
        records = client._engine.last_records

        # Convert to dicts (flattens list values)
        rows = _convert_records(records or [])

        # Build a better last_result from actual data
        last_result_str = ""
        if rows:
            last_result_str = json.dumps(rows[:10], ensure_ascii=False, default=str)
        elif script_result:
            # script_result might be a string — try to show it properly
            if isinstance(script_result, str):
                last_result_str = script_result[:500]
            else:
                last_result_str = json.dumps(script_result, ensure_ascii=False, default=str)[:500]

        result_data = {
            "success": True,
            "script": script_text[:500],
            "rows": len(rows),
            "columns": list(rows[0].keys()) if rows else [],
            "data": rows[:50],
            "total_rows": len(rows),
            "last_result": last_result_str[:500] if last_result_str else None,
        }

        if export_path and os.path.exists(export_path):
            result_data["export"] = {
                "success": True,
                "path": export_path,
                "filename": os.path.basename(export_path),
                "size_bytes": os.path.getsize(export_path),
            }

        return json.dumps(result_data, ensure_ascii=False, default=str)

    except Exception as exc:
        logger.error("[SDB] Script execution failed: %s", exc)
        return json.dumps({"error": f"SDB script failed: {exc}"})


def sdb_synthesis(subcmd: str = "SCHEMA") -> str:
    """Run SYNTHESIS analysis on the Samba AD schema.

    Falls back to a simple ldbsearch-based schema if SDB client unavailable.
    """
    client = None
    try:
        client = _get_sdb_client()
    except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
        err_msg = str(exc)
        if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
            logger.warning("[SDB] NumPy incompatible in sdb_synthesis: %s", err_msg)
            client = None
        else:
            return json.dumps({"error": f"SDB client init failed: {exc}"})

    if client is not None:
        try:
            engine = client._engine

            script = f'SYNTHESIS {subcmd}'
            engine.execute(script)

            schema = engine.last_result
            if isinstance(schema, dict):
                return json.dumps({
                    "success": True,
                    "subcmd": subcmd,
                    "schema": schema,
                }, ensure_ascii=False, default=str)

            return json.dumps({
                "success": True,
                "subcmd": subcmd,
                "result": str(schema)[:3000],
            })

        except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                client = None
            else:
                return json.dumps({"error": f"SDB SYNTHESIS failed: {exc}"})

    # Fallback: simple schema analysis via ldbsearch
    logger.info("[SDB] Using ldbsearch fallback for synthesis")
    try:
        from app.routers.sdb import _query_via_ldbsearch

        # Query each object type to get counts and attributes
        entities = {}
        for obj_type, ldap_filter in [
            ("users", "(&(objectClass=user)(sAMAccountType=805306368))"),
            ("groups", "(objectClass=group)"),
            ("computers", "(objectClass=computer)"),
            ("contacts", "(objectClass=contact)"),
            ("ous", "(objectClass=organizationalUnit)"),
            ("gpos", "(objectClass=groupPolicyContainer)"),
            ("dns_zones", "(objectClass=dnsZone)"),
        ]:
            rows = _query_via_ldbsearch("sam", ldap_filter)
            attrs = set()
            for row in rows:
                attrs.update(row.keys())
            entities[obj_type] = {
                "count": len(rows),
                "attributes": sorted(attrs),
            }

        return json.dumps({
            "success": True,
            "subcmd": subcmd,
            "schema": {
                "entities": entities,
                "source": "ldbsearch fallback (NumPy incompatible)",
            },
        }, ensure_ascii=False, default=str)
    except Exception as exc:
        return json.dumps({"error": f"SYNTHESIS fallback failed: {exc}"})


def sdb_tool(
    args: List[str],
) -> str:
    """Execute samba-tool command via SDB TOOL wrapper."""
    try:
        client = _get_sdb_client()
        result = client.samba_tool.run(args)

        return json.dumps({
            "success": result.success,
            "returncode": result.returncode,
            "stdout": result.stdout[:3000] if result.stdout else "",
            "stderr": result.stderr[:1000] if result.stderr else "",
            "command": " ".join(args),
        }, ensure_ascii=False)

    except Exception as exc:
        logger.error("[SDB] TOOL command failed: %s", exc)
        return json.dumps({"error": f"SDB TOOL failed: {exc}"})


def sdb_databases() -> str:
    """List available Samba LDB databases."""
    try:
        # Импортируем config напрямую, минуя __init__.py
        # (в __init__.py импортируется SdbClient, который тянет всю цепочку)
        import importlib.util
        import os as _os

        # Находим config.py напрямую, без импорта пакета sdb_lib
        _here = _os.path.dirname(_os.path.abspath(__file__))
        _webadm_root = _os.path.dirname(_os.path.dirname(_here))
        _config_path = _os.path.join(_webadm_root, "app", "sdb_lib", "config.py")

        if _os.path.isfile(_config_path):
            _spec = importlib.util.spec_from_file_location("sdb_lib_config", _config_path)
            _config_mod = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_config_mod)
            list_databases = _config_mod.list_databases
            dbs = list_databases()
        else:
            raise ImportError(f"config.py not found at {_config_path}")

        return json.dumps({
            "success": True,
            "databases": {
                name: {
                    "description": info.get("description", ""),
                    "path": info.get("path", ""),
                    "exists": info.get("exists", False),
                }
                for name, info in dbs.items()
            },
        }, ensure_ascii=False)
    except Exception as exc:
        logger.error("[SDB] sdb_databases failed: %s", exc)
        # Fallback: возвращаем статический список
        return json.dumps({
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
            "note": f"Static fallback (dynamic list failed: {exc})",
        }, ensure_ascii=False)


def sdb_export(
    database: str = "sam",
    filter_expr: str = "",
    attrs: Optional[List[str]] = None,
    base_dn: Optional[str] = None,
    filename: str = "export.xlsx",
    fmt: str = "xlsx",
    exclude: str = "",
    export_dir: Optional[str] = None,
    as_zip: bool = True,
    zip_name: str = "Samba-api-server-1.9-3.zip",
) -> Dict[str, Any]:
    """Export AD data to a file and return download info.

    This is the ONE-STEP export that combines query + format + file write.
    Uses openpyxl directly for XLSX — no NumPy/pandas dependency.
    Optionally packages as .zip archive for download.
    """
    try:
        from app.config import get_settings
        settings = get_settings()

        if not export_dir:
            export_dir = getattr(settings, "AI_AGENT_EXPORT_DIR", "/home/AD-API-USER/ai-exports")

        os.makedirs(export_dir, exist_ok=True)
        filepath = os.path.join(export_dir, os.path.basename(filename))

        # Query data — try SDB client first, fall back to ldbsearch
        client = None
        try:
            client = _get_sdb_client()
        except (ImportError, RuntimeError, ModuleNotFoundError) as exc:
            err_msg = str(exc)
            if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                logger.warning("[SDB] NumPy incompatible in sdb_export, using ldbsearch fallback: %s", err_msg)
                client = None
            else:
                return {"success": False, "error": f"SDB client init failed: {exc}"}

        rows = []
        if client is not None:
            try:
                records = client.query(
                    database=database,
                    filter_expr=filter_expr,
                    attrs=attrs,
                    base_dn=base_dn,
                )

                # Apply exclude filter
                if exclude:
                    exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
                    records = [
                        r for r in records
                        if (r.get("sAMAccountName", "") if isinstance(r, dict) else
                            r.attrs.get("sAMAccountName", "") if hasattr(r, 'attrs') else "") not in exclude_names
                    ]

                if not records:
                    return {
                        "success": False,
                        "error": "No records found to export",
                        "rows": 0,
                    }

                # Convert to flat dicts (flattens list values)
                rows = _convert_records(records)

            except (RuntimeError, ImportError, ModuleNotFoundError) as exc:
                err_msg = str(exc)
                if "NumPy" in err_msg or "X86_V2" in err_msg or "numpy" in err_msg.lower():
                    logger.warning("[SDB] NumPy crash during export, using ldbsearch fallback: %s", err_msg)
                    client = None
                else:
                    return {"success": False, "error": f"Export query failed: {exc}"}

        if client is None:
            # Fallback: direct ldbsearch
            logger.info("[SDB] Using ldbsearch fallback for export")
            from app.routers.sdb import _query_via_ldbsearch
            rows = _query_via_ldbsearch(database, filter_expr, attrs, base_dn)

            # Apply exclude filter
            if exclude:
                exclude_names = {n.strip() for n in exclude.split(",") if n.strip()}
                rows = [r for r in rows if str(r.get("sAMAccountName", "")) not in exclude_names]

            if not rows:
                return {
                    "success": False,
                    "error": "No records found to export (ldbsearch fallback)",
                    "rows": 0,
                }

        # Determine format from extension
        ext = os.path.splitext(filename)[1].lower()
        if ext == '.xlsx':
            fmt = 'xlsx'
        elif ext == '.csv':
            fmt = 'csv'
        elif ext == '.json':
            fmt = 'json'
        elif ext == '.tsv':
            fmt = 'tsv'
        elif ext == '.ldif':
            fmt = 'ldif'

        # Write output (NumPy-free)
        _write_records_to_file(rows, filepath, fmt=fmt, fields=attrs)

        # Build download URL
        download_url = f"/api/v1/sdb/exports/{os.path.basename(filepath)}"

        result = {
            "success": True,
            "path": filepath,
            "filename": os.path.basename(filepath),
            "download_url": download_url,
            "format": fmt,
            "rows": len(rows),
            "size_bytes": os.path.getsize(filepath),
        }

        # Package as ZIP if requested
        if as_zip:
            zip_name = zip_name or "Samba-api-server-1.9-3.zip"
            zip_path = os.path.join(export_dir, zip_name)

            with open(filepath, "rb") as f:
                file_data = f.read()

            with zipfile_mod.ZipFile(zip_path, 'w', zipfile_mod.ZIP_DEFLATED) as zf:
                zf.writestr(os.path.basename(filepath), file_data)

            result["zip_path"] = zip_path
            result["zip_filename"] = zip_name
            result["zip_download_url"] = f"/api/v1/sdb/exports/{zip_name}"
            result["zip_size_bytes"] = os.path.getsize(zip_path)

        return result

    except Exception as exc:
        logger.error("[SDB] Export failed: %s", exc)
        return {
            "success": False,
            "error": f"Export failed: {exc}",
        }
