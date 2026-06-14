"""
WebADC SPA Router — Serves Web Panel at / (root path).

Mounts static files from app/web/static/ and provides SPA fallback.
Controlled by WEB_ENABLED in .env (default: true).
When disabled, returns 404 for all non-API paths.

v2.0.1: Fixed PyInstaller _MEIPASS path resolution for static files.
        Fixed /web/api/health endpoint registration.
v2.0.4: Made is_web_enabled() more robust — reads /etc/webadc/.env
        directly as fallback when pydantic-settings can't find the file.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

router = APIRouter(tags=["web"])

# ─── Configuration ────────────────────────────────────────────────────────────

# Static directory: app/web/static/
# IMPORTANT: In PyInstaller bundle mode, __file__ does NOT point to _MEIPASS.
# We must use sys._MEIPASS directly to locate bundled data files.
_FROZEN = getattr(sys, "frozen", False)

if _FROZEN:
    # In PyInstaller onefile mode, data files are in sys._MEIPASS
    _BASE_DATA = Path(sys._MEIPASS)
    _WEB_DIR = _BASE_DATA / "app" / "web"
else:
    # In source mode, use __file__ relative path
    _WEB_DIR = Path(__file__).resolve().parent.parent / "web"

STATIC_DIR = Path(os.getenv("WEB_STATIC_DIR", str(_WEB_DIR / "static")))

# Pre-load index.html content (cached in memory for fast SPA fallback)
_index_html_content: str | None = None
_index_html_loaded: bool = False


def _get_index_html() -> str | None:
    """Load and cache index.html content."""
    global _index_html_content, _index_html_loaded
    if _index_html_loaded:
        return _index_html_content
    _index_html_loaded = True
    index_path = STATIC_DIR / "index.html"
    if index_path.is_file():
        _index_html_content = index_path.read_text(encoding="utf-8")
    return _index_html_content


def _read_web_enabled_from_env_file() -> bool | None:
    """Read WEB_ENABLED directly from .env file as a robust fallback.

    v2.0.4: When pydantic-settings can't find the .env file (e.g. wrong
    CWD in systemd), this function reads the file directly and parses
    WEB_ENABLED/SAMBA_WEB_ENABLED from it.

    Returns True/False if found, None if not found in .env.
    """
    _ENV_PATHS = [
        Path("/etc/webadc/.env"),   # Production path (systemd service)
        Path("/etc/apiadc/.env"),   # Legacy path
        Path(".env"),               # Development (CWD)
    ]
    for env_path in _ENV_PATHS:
        try:
            if env_path.is_file():
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    # Skip comments and empty lines
                    if not line or line.startswith("#") or line.startswith(";"):
                        continue
                    if "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key in ("WEB_ENABLED", "SAMBA_WEB_ENABLED"):
                        return value.lower() in ("true", "1", "yes", "on")
        except Exception:
            continue
    return None


def is_web_enabled() -> bool:
    """Check if web panel is enabled via WEB_ENABLED env var.

    v2.0.4: Now uses a 3-tier fallback strategy:

    1. **Settings model** (pydantic-settings) — reads from os.environ
       and .env file using the configured env_file paths.  With the
       v2.0.4 fix to config.py (env_file includes /etc/webadc/.env),
       this should work correctly.

    2. **Direct .env file reading** — reads /etc/webadc/.env directly
       as a fallback for cases where pydantic-settings doesn't load
       the file (e.g., if the env_file list in config.py hasn't been
       updated yet).

    3. **os.environ** — systemd's EnvironmentFile directive sets
       variables in the service's environment, so we can read them
       directly.

    4. **Default: True** (web enabled) — if no configuration is found,
       assume web panel should be served (backward compatible).
    """
    # Method 1: Settings model (primary)
    try:
        from app.config import get_settings
        settings = get_settings()
        return settings.WEB_ENABLED
    except Exception:
        pass

    # Method 2: Direct .env file reading (robust fallback)
    env_file_value = _read_web_enabled_from_env_file()
    if env_file_value is not None:
        return env_file_value

    # Method 3: os.environ (set by systemd EnvironmentFile)
    val = os.environ.get("WEB_ENABLED", os.environ.get("SAMBA_WEB_ENABLED", ""))
    if val:
        return val.lower() in ("true", "1", "yes", "on")

    # Default: True (web enabled — backward compatible)
    return True


def get_static_dir() -> Path:
    """Get the static files directory path."""
    return STATIC_DIR


def has_index_html() -> bool:
    """Check if index.html exists in static directory."""
    return (STATIC_DIR / "index.html").is_file()


# ─── Health endpoint for web panel ────────────────────────────────────────────

@router.get("/web/api/health")
async def web_health():
    """Health check for WebADC panel."""
    enabled = is_web_enabled()
    has_index = has_index_html()
    return {
        "status": "ok" if enabled and has_index else "disabled",
        "service": "webadc",
        "web_enabled": enabled,
        "static_dir": str(STATIC_DIR),
        "index_html_found": has_index,
        "frozen": _FROZEN,
    }


# ─── Static file serving + SPA fallback ──────────────────────────────────────
# This MUST be registered as the LAST route in app.main so it doesn't
# catch /api/v1/* or /health/* paths.
#
# Usage in app/main.py:
#   from app.routers.web import setup_web_routes
#   setup_web_routes(app)
#
# The SPA fallback route handles:
#   - Exact file matches (JS, CSS, images, etc.)
#   - SPA fallback: any non-file path returns index.html

# Trailing-slash endpoints that the SPA may route to
_SPA_ROUTES = frozenset({
    "users", "groups", "computers", "contacts",
    "ous", "sites", "fsmo", "gpo",
    "service-accounts", "shell", "batch",
    "ai/chat", "dashboard",
})


def setup_web_routes(app):
    """Register web panel routes on the FastAPI app.

    This function MUST be called AFTER all API routers are registered,
    so the SPA catch-all route is the last one and doesn't shadow /api/v1/*.

    Args:
        app: FastAPI application instance
    """
    # Skip if web is disabled
    if not is_web_enabled():
        print("[WEB] Web panel is DISABLED (WEB_ENABLED=false)")

        @app.get("/{full_path:path}")
        async def web_disabled(full_path: str):
            """Return 404 when web panel is disabled."""
            # Don't block /health, /docs, /openapi.json, /metrics etc.
            # Those are handled by their own routes and won't reach this fallback.
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "detail": "Web panel is disabled. Set WEB_ENABLED=true in .env to enable.",
                    "error_code": "WEB_DISABLED",
                },
            )
        return

    # Web is enabled — serve static files
    if not STATIC_DIR.is_dir():
        print(f"[WEB] WARNING: Static directory not found: {STATIC_DIR}")
        print(f"[WEB] Web panel will not be available")

        @app.get("/{full_path:path}")
        async def web_no_static(full_path: str):
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "detail": f"Web panel static directory not found: {STATIC_DIR}",
                    "error_code": "NO_STATIC_DIR",
                },
            )
        return

    index_html = _get_index_html()
    if not index_html:
        print(f"[WEB] WARNING: index.html not found in {STATIC_DIR}")

    # Pre-load index.html
    if index_html:
        print(f"[WEB] index.html loaded from {STATIC_DIR}")
    print(f"[WEB] Serving Web Panel at / from {STATIC_DIR}")
    print(f"[WEB] PyInstaller frozen={_FROZEN}, _MEIPASS={getattr(sys, '_MEIPASS', 'N/A')}")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        """Serve static files, fallback to index.html for SPA routing.

        This route catches all paths that aren't matched by API routes.
        - If the path matches a real file in static/, serve it.
        - Otherwise, return index.html for SPA client-side routing.
        """
        # Root path → index.html
        if not full_path:
            if index_html:
                return HTMLResponse(
                    content=index_html,
                    headers={"Cache-Control": "no-store, must-revalidate"},
                )
            return JSONResponse(
                status_code=404,
                content={"status": "error", "detail": "index.html not found"},
            )

        # Try to serve exact file from static directory
        file_path = STATIC_DIR / full_path

        exists = await asyncio.to_thread(file_path.is_file)
        if exists:
            # Cache static assets aggressively
            if "_next/static/" in full_path or "_next/image" in full_path:
                return FileResponse(
                    file_path,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"},
                )
            # Other files: no cache (HTML, JSON, etc.)
            return FileResponse(
                file_path,
                headers={"Cache-Control": "no-store, must-revalidate"},
            )

        # SPA fallback: return index.html for client-side routing
        if index_html:
            return HTMLResponse(
                content=index_html,
                headers={"Cache-Control": "no-store, must-revalidate"},
            )

        # No index.html available
        return JSONResponse(
            status_code=404,
            content={"status": "error", "detail": "File not found"},
        )
