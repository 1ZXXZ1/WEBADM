"""
Report generation router for Samba AD DC Management API.

Provides ONE-STEP report generation that creates a multi-sheet XLSX file
with all AD data: users, groups, computers, contacts, OUs, DNS, domain.

Sheet 1: Summary (кратко) — counts + download link
Sheet 2: Users (пользователи)
Sheet 3: Groups (группы)
Sheet 4: Computers (компьютеры)
Sheet 5: Contacts (контакты)
Sheet 6: OUs (подразделения)
Sheet 7: DNS Zones
Sheet 8: Domain (домен)

Uses direct ldbsearch (app.ldb_reader) — NO SDB dependency, NO NumPy.
All XLSX generation uses openpyxl directly.

v1.9-3-4: Initial report router — one-step AD report generation.
v1.9-3-5: Fix IllegalCharacterError (sanitize control chars in DNS zone data),
          NumPy X86_V2 guard in main.py prevents numpy RuntimeError.
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile as zipfile_mod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.auth import ApiKeyDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/report", tags=["Report — AD Report Generation"])


# ═══════════════════════════════════════════════════════════════════════
#  Request Models
# ═══════════════════════════════════════════════════════════════════════


class ReportGenerateRequest(BaseModel):
    """Request for AD report generation."""
    filename: str = Field(default="ad_report.xlsx", description="Output filename (.xlsx)")
    exclude: str = Field(default="Administrator,Guest,krbtgt,default", description="Comma-separated sAMAccountNames to exclude from Users sheet")
    include_groups: bool = Field(default=True, description="Add 'groups' column to Users sheet")
    as_zip: bool = Field(default=True, description="Package report as .zip for download")


# ═══════════════════════════════════════════════════════════════════════
#  Utility: flatten LDB list values
# ═══════════════════════════════════════════════════════════════════════


# XML 1.0 illegal characters: 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F
# openpyxl raises IllegalCharacterError if these are present in cell values.
_ILLEGAL_XML_RE = __import__("re").compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f]"
)


def _sanitize_excel_string(val: Any) -> Any:
    """Strip illegal XML characters from string values for openpyxl compatibility.

    Samba/AD DNS zone data may contain control characters (0x00-0x1F) that
    openpyxl rejects with IllegalCharacterError.  This function removes them.
    Non-string values are returned unchanged.
    """
    if isinstance(val, str):
        return _ILLEGAL_XML_RE.sub("", val)
    return val


def _flatten_value(val: Any) -> Any:
    """Flatten LDB list values to scalars."""
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


def _priority_columns(attr_list: List[str], all_keys: set) -> List[str]:
    """Return columns in priority order, then remaining keys alphabetically."""
    priority = [
        "sAMAccountName", "cn", "name", "displayName", "description",
        "mail", "department", "title", "company", "telephoneNumber",
        "physicalDeliveryOfficeName", "ou", "dNSHostName", "operatingSystem",
        "objectClass", "userAccountControl", "whenCreated", "whenChanged",
        "memberOf", "groups", "dn",
    ]
    columns = []
    seen = set()
    for attr in priority:
        if attr in all_keys and attr not in seen:
            columns.append(attr)
            seen.add(attr)
    for key in sorted(all_keys):
        if key not in seen:
            columns.append(key)
            seen.add(key)
    return columns


# ═══════════════════════════════════════════════════════════════════════
#  XLSX Generation (openpyxl only, NO NumPy/pandas)
# ═══════════════════════════════════════════════════════════════════════


def _write_sheet(wb, sheet_name: str, records: List[Dict[str, Any]],
                 title_override: str = None) -> None:
    """Write a list of flattened dicts as a sheet in an openpyxl Workbook.

    Args:
        wb: openpyxl Workbook
        sheet_name: Sheet name (max 31 chars)
        records: List of flat dicts
        title_override: Optional display title (e.g. "Пользователи")
    """
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    if len(records) > 0:
        ws = wb.create_sheet(title=sheet_name[:31])
    else:
        ws = wb.create_sheet(title=sheet_name[:31])
        ws.cell(row=1, column=1, value="Нет данных")
        ws.cell(row=1, column=1).font = Font(italic=True, size=11, color="888888")
        return

    # Determine columns
    all_keys = set()
    for rec in records:
        all_keys.update(rec.keys())
    columns = _priority_columns([], all_keys)

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
        cell = ws.cell(row=1, column=col_idx, value=_sanitize_excel_string(str(col_name).upper()))
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    # Write data
    data_font = Font(size=10)
    data_align = Alignment(vertical="top", wrap_text=True)

    for row_idx, rec in enumerate(records, 2):
        for col_idx, col in enumerate(columns, 1):
            value = rec.get(col, "")
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False, default=str)
            elif value is None:
                value = ""
            # Sanitize illegal XML characters (control chars 0x00-0x1F)
            # that openpyxl rejects with IllegalCharacterError
            value = _sanitize_excel_string(value)
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


def _write_summary_sheet(wb, stats: Dict[str, Any], download_url: str,
                         filename: str) -> None:
    """Write the summary (кратко) sheet with counts and download link."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    ws = wb.active
    ws.title = "Кратко"

    # Title styling
    title_font = Font(bold=True, size=16, color="1F4E79")
    section_font = Font(bold=True, size=12, color="2E75B6")
    value_font = Font(size=11)
    link_font = Font(size=12, color="0563C1", underline="single", bold=True)

    light_fill = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    row = 1
    ws.cell(row=row, column=1, value="Отчёт Samba AD DC").font = title_font
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
    row += 1

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    ws.cell(row=row, column=1, value=f"Дата: {now}").font = Font(size=10, color="666666")
    row += 2

    # Section: Object Counts
    ws.cell(row=row, column=1, value="Количество объектов").font = section_font
    row += 1

    count_data = [
        ("Пользователи", stats.get("users_count", 0)),
        ("Группы", stats.get("groups_count", 0)),
        ("Компьютеры", stats.get("computers_count", 0)),
        ("Контакты", stats.get("contacts_count", 0)),
        ("Подразделения (OU)", stats.get("ous_count", 0)),
        ("DNS зоны", stats.get("dns_zones_count", 0)),
        ("Домен", stats.get("domain_name", "—")),
    ]

    for label, value in count_data:
        cell_label = ws.cell(row=row, column=1, value=label)
        cell_label.font = value_font
        cell_label.border = thin_border
        cell_label.fill = light_fill

        cell_value = ws.cell(row=row, column=2, value=value)
        cell_value.font = Font(size=11, bold=True)
        cell_value.border = thin_border
        cell_value.alignment = Alignment(horizontal="center")
        row += 1

    row += 1

    # Domain info
    domain_info = stats.get("domain_info", {})
    if domain_info:
        ws.cell(row=row, column=1, value="Информация о домене").font = section_font
        row += 1

        domain_fields = [
            ("Имя домена", domain_info.get("domain_name", "—")),
            ("Уровень домена", domain_info.get("domain_functional_level", "—")),
            ("Уровень леса", domain_info.get("forest_functional_level", "—")),
        ]
        for label, value in domain_fields:
            ws.cell(row=row, column=1, value=label).font = value_font
            ws.cell(row=row, column=1).border = thin_border
            ws.cell(row=row, column=1).fill = light_fill
            ws.cell(row=row, column=2, value=str(value) if value else "—").font = value_font
            ws.cell(row=row, column=2).border = thin_border
            row += 1

    row += 1

    # Download link
    ws.cell(row=row, column=1, value="Скачать файл:").font = Font(bold=True, size=11)
    cell_link = ws.cell(row=row, column=2, value=download_url)
    cell_link.font = link_font
    cell_link.hyperlink = download_url
    row += 1
    ws.cell(row=row, column=1, value="Имя файла:").font = Font(bold=True, size=11)
    ws.cell(row=row, column=2, value=filename).font = value_font

    # Column widths
    ws.column_dimensions['A'].width = 28
    ws.column_dimensions['B'].width = 55
    ws.column_dimensions['C'].width = 20


# ═══════════════════════════════════════════════════════════════════════
#  Data Fetching (direct ldbsearch, NO SDB)
# ═══════════════════════════════════════════════════════════════════════


async def _fetch_all_ad_data(exclude: str = "", include_groups: bool = True) -> Dict[str, Any]:
    """Fetch all AD data via ldb_reader (direct ldbsearch).

    Returns dict with:
        - users, groups, computers, contacts, ous, dns_zones, domain_info
        - stats (counts, domain_name)
    """
    from app.ldb_reader import (
        fetch_users, fetch_groups, fetch_computers, fetch_contacts,
        fetch_ous, fetch_dns_zones, fetch_domain_info, fetch_domain_level,
    )

    # Fetch all data in parallel
    import asyncio
    users_raw, groups_raw, computers_raw, contacts_raw, ous_raw, dns_raw, domain_raw, domain_level = await asyncio.gather(
        fetch_users(),
        fetch_groups(),
        fetch_computers(),
        fetch_contacts(),
        fetch_ous(),
        fetch_dns_zones(),
        fetch_domain_info(),
        fetch_domain_level(),
    )

    # Flatten records
    users = [_flatten_record(r) for r in users_raw]
    groups = [_flatten_record(r) for r in groups_raw]
    computers = [_flatten_record(r) for r in computers_raw]
    contacts = [_flatten_record(r) for r in contacts_raw]
    ous = [_flatten_record(r) for r in ous_raw]
    dns_zones = [_flatten_record(r) for r in dns_raw]

    # Apply exclude filter to users
    if exclude:
        exclude_names = {n.strip().lower() for n in exclude.split(",") if n.strip()}
        users = [u for u in users if str(u.get("sAMAccountName", "")).lower() not in exclude_names]

    # Add groups column to users if requested
    if include_groups and users:
        # Build user->groups mapping from memberOf
        for user in users:
            member_of = user.get("memberOf", "")
            if isinstance(member_of, str) and member_of:
                # Extract CN from DN
                group_names = []
                for dn in member_of.split(", "):
                    if dn.startswith("CN="):
                        cn = dn[3:]
                        # Remove remaining DN parts if DN was split incorrectly
                        group_names.append(cn)
                user["groups"] = ", ".join(group_names) if group_names else ""
            elif isinstance(member_of, list):
                group_names = []
                for dn in member_of:
                    if isinstance(dn, str) and dn.startswith("CN="):
                        cn = dn.split(",")[0][3:]
                        group_names.append(cn)
                user["groups"] = ", ".join(group_names) if group_names else ""
            else:
                user["groups"] = ""

    # Extract domain name
    domain_name = "—"
    if domain_raw:
        dn = domain_raw[0].get("dn", "") if domain_raw else ""
        if dn:
            # Extract DC parts from DN
            dc_parts = [p for p in dn.split(",") if p.strip().startswith("DC=")]
            domain_name = ".".join(p.strip()[3:] for p in dc_parts) if dc_parts else dn

    # Build domain info
    domain_info = {
        "domain_name": domain_name,
        "domain_functional_level": domain_level.get("domain_functional_level", "—") if domain_level else "—",
        "forest_functional_level": domain_level.get("forest_functional_level", "—") if domain_level else "—",
    }

    stats = {
        "users_count": len(users),
        "groups_count": len(groups),
        "computers_count": len(computers),
        "contacts_count": len(contacts),
        "ous_count": len(ous),
        "dns_zones_count": len(dns_zones),
        "domain_name": domain_name,
        "domain_info": domain_info,
    }

    return {
        "users": users,
        "groups": groups,
        "computers": computers,
        "contacts": contacts,
        "ous": ous,
        "dns_zones": dns_zones,
        "domain_info": domain_info,
        "stats": stats,
    }


# ═══════════════════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════════════════


@router.post(
    "/generate",
    summary="Generate multi-sheet AD report (XLSX, 8 sheets)",
    description=(
        "ONE-STEP report generation. Creates an XLSX file with 8 sheets: "
        "1) Кратко (summary with counts + download link), "
        "2) Пользователи (users), 3) Группы (groups), 4) Компьютеры (computers), "
        "5) Контакты (contacts), 6) Подразделения (OUs), 7) DNS зоны, 8) Домен (domain). "
        "Uses direct ldbsearch — NO SDB dependency, NO NumPy. "
        "Returns download_url for file access."
    ),
)
async def generate_report(
    request: Request,
    body: ReportGenerateRequest = None,
    api_key: ApiKeyDep = None,
) -> dict:
    """Generate a comprehensive AD report as multi-sheet XLSX.

    This is the ONE-STEP replacement for the multi-step AI workflow:
    Instead of: ldbsearch_ad users → ldbsearch_ad groups → ... → data_export
    Just call: POST /report/generate → get download URL

    Uses direct ldbsearch (no SDB, no NumPy, no pandas).
    All formatting with openpyxl.
    """
    if body is None:
        body = ReportGenerateRequest()

    try:
        import openpyxl
    except ImportError:
        return {"success": False, "error": "openpyxl not installed. Run: pip install openpyxl"}

    # Fetch all AD data
    try:
        data = await _fetch_all_ad_data(
            exclude=body.exclude,
            include_groups=body.include_groups,
        )
    except Exception as exc:
        logger.error("[REPORT] Failed to fetch AD data: %s", exc)
        return {"success": False, "error": f"Failed to fetch AD data: {exc}"}

    # Create workbook
    wb = openpyxl.Workbook()

    # Sheet 1: Summary (Кратко) — will be written last after we know download URL
    # First write data sheets

    # Sheet 2: Users (Пользователи)
    _write_sheet(wb, "Пользователи", data["users"])

    # Sheet 3: Groups (Группы)
    _write_sheet(wb, "Группы", data["groups"])

    # Sheet 4: Computers (Компьютеры)
    _write_sheet(wb, "Компьютеры", data["computers"])

    # Sheet 5: Contacts (Контакты)
    _write_sheet(wb, "Контакты", data["contacts"])

    # Sheet 6: OUs (Подразделения)
    _write_sheet(wb, "Подразделения", data["ous"])

    # Sheet 7: DNS Zones
    _write_sheet(wb, "DNS зоны", data["dns_zones"])

    # Sheet 8: Domain (Домен)
    domain_records = []
    if data["domain_info"]:
        domain_records = [data["domain_info"]]
    _write_sheet(wb, "Домен", domain_records)

    # Now write Sheet 1: Summary (remove default empty sheet first)
    # The default "Sheet" was already replaced by wb.active
    export_dir = _get_export_dir()
    os.makedirs(export_dir, exist_ok=True)
    filename = os.path.basename(body.filename)
    if not filename.endswith('.xlsx'):
        filename += '.xlsx'

    filepath = os.path.join(export_dir, filename)

    # Build download URL
    download_url = f"/api/v1/report/exports/{filename}"
    try:
        from app.config import get_settings
        settings = get_settings()
        api_base = getattr(settings, "AI_API_BASE", "http://127.0.0.1:8099")
        download_url_full = f"{api_base}/api/v1/report/exports/{filename}"
    except Exception:
        download_url_full = f"http://127.0.0.1:8099/api/v1/report/exports/{filename}"

    # Write summary sheet (replace the default active sheet)
    # Remove the default "Sheet" that openpyxl creates
    default_sheet = wb.active
    _write_summary_sheet(wb, data["stats"], download_url_full, filename)
    if default_sheet and default_sheet.title != "Кратко":
        wb.remove(default_sheet)

    # Save XLSX
    wb.save(filepath)
    file_size = os.path.getsize(filepath)

    logger.info("[REPORT] Generated report: %s (%d bytes, users=%d, groups=%d, computers=%d)",
                filepath, file_size,
                data["stats"]["users_count"],
                data["stats"]["groups_count"],
                data["stats"]["computers_count"])

    # Package as ZIP if requested
    if body.as_zip:
        zip_name = filename.replace('.xlsx', '.zip')
        zip_path = os.path.join(export_dir, zip_name)

        with open(filepath, "rb") as f:
            file_data = f.read()

        with zipfile_mod.ZipFile(zip_path, 'w', zipfile_mod.ZIP_DEFLATED) as zf:
            zf.writestr(filename, file_data)

        zip_size = os.path.getsize(zip_path)
        zip_download_url = f"/api/v1/report/exports/{zip_name}"

        return {
            "success": True,
            "filename": filename,
            "zip_filename": zip_name,
            "path": filepath,
            "zip_path": zip_path,
            "download_url": zip_download_url,
            "download_url_full": f"{api_base}/api/v1/report/exports/{zip_name}" if 'api_base' in dir() else download_url_full.replace(filename, zip_name),
            "format": "xlsx",
            "sheets": 8,
            "stats": data["stats"],
            "size_bytes": file_size,
            "zip_size_bytes": zip_size,
        }

    return {
        "success": True,
        "filename": filename,
        "path": filepath,
        "download_url": download_url,
        "download_url_full": download_url_full,
        "format": "xlsx",
        "sheets": 8,
        "stats": data["stats"],
        "size_bytes": file_size,
    }


@router.get(
    "/generate",
    summary="Generate AD report via GET (quick download)",
    description=(
        "Quick report generation via GET request. "
        "Same as POST /report/generate but with query parameters. "
        "Returns the XLSX file directly as a download."
    ),
)
async def generate_report_get(
    request: Request,
    api_key: ApiKeyDep,
    exclude: str = Query(default="Administrator,Guest,krbtgt,default", description="Comma-separated sAMAccountNames to exclude"),
    include_groups: bool = Query(default=True, description="Add groups column to users"),
) -> dict:
    """Quick GET-based report generation."""
    body = ReportGenerateRequest(
        exclude=exclude,
        include_groups=include_groups,
        as_zip=False,
    )
    return await generate_report(request, body, api_key)


@router.get(
    "/exports/{filename}",
    summary="Download exported report file",
    description="Download a previously generated report file.",
)
async def download_report_file(
    request: Request,
    filename: str,
    api_key: ApiKeyDep,
):
    """Download a report export file."""
    from fastapi.responses import FileResponse

    export_dir = _get_export_dir()
    filepath = os.path.join(export_dir, os.path.basename(filename))

    if not os.path.exists(filepath):
        # Also try the SDB exports directory
        try:
            from app.config import get_settings
            settings = get_settings()
            alt_dir = getattr(settings, "AI_AGENT_EXPORT_DIR", "/home/AD-API-USER/ai-exports")
            alt_path = os.path.join(alt_dir, os.path.basename(filename))
            if os.path.exists(alt_path):
                filepath = alt_path
            else:
                from fastapi import HTTPException
                raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    # Determine media type
    ext = os.path.splitext(filename)[1].lower()
    media_types = {
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.zip': 'application/zip',
        '.tsv': 'text/tab-separated-values',
        '.ldif': 'text/plain',
    }
    media_type = media_types.get(ext, 'application/octet-stream')

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type=media_type,
    )


def _get_export_dir() -> str:
    """Get export directory from settings or default."""
    try:
        from app.config import get_settings
        settings = get_settings()
        return getattr(settings, "AI_AGENT_EXPORT_DIR", "/home/AD-API-USER/ai-exports")
    except Exception:
        return "/home/AD-API-USER/ai-exports"
