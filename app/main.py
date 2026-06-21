"""
FastAPI application entry-point for the Samba AD DC Management API.

Creates the application instance, registers middleware, exception
handlers, startup/shutdown hooks, and mounts all API routers.

v1.4.3: Added shell router for bash/python3 command execution.
v2.8:   Added batch router for multi-step sequential operations.
v2.7:   Major upgrade — JWT auth, rate limiting, caching, pagination,
        WebSocket task notifications, Prometheus metrics, structured
        logging, extended user/OU management, CSV import/export,
        OU tree, system stats, Dockerfile, config.yaml support.
"""

from __future__ import annotations

# ═══════════════════════════════════════════════════════════════════════
#  NumPy X86_V2 compatibility guard (v1.9-3-5)
#
#  If the installed NumPy was compiled for a newer CPU (e.g. X86_V2)
#  than the host, importing it raises RuntimeError, which crashes
#  openpyxl, matplotlib, pandas, and any other library that tries to
#  import numpy at module level.  By detecting this early and setting
#  sys.modules['numpy'] = None, we force all downstream libraries to
#  fall back to their pure-Python code paths (openpyxl works fine
#  without numpy, matplotlib falls back gracefully, etc.).
# ═══════════════════════════════════════════════════════════════════════
import sys as _sys
try:
    import numpy as _np_check  # noqa: F401 — test import only
except RuntimeError as _np_err:
    _sys.modules['numpy'] = None  # block all future numpy imports → ImportError
    import logging as _logging
    _logging.getLogger(__name__).warning(
        "[NUMPY-GUARD] NumPy import failed: %s — numpy blocked in sys.modules, "
        "libraries will use pure-Python fallbacks", _np_err,
    )
except Exception:
    pass  # other errors (e.g. ImportError) are fine — numpy not installed

import logging
import os
import time
from pathlib import Path
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import asyncio as _asyncio

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app.config import Settings, get_settings
from app.executor import SambaToolError, classify_samba_error
from app.models.common import ErrorResponse
from app.worker import shutdown_worker_pool

# Import Pydantic models at module level so that FastAPI/Pydantic can resolve
# them even when ``from __future__ import annotations`` is active.
# (Annotations become strings and are evaluated in the *module* global namespace,
# so names imported inside a function are invisible to Pydantic.)
from app.auth_jwt import LoginRequest, TokenResponse, RefreshRequest, MeResponse, CheckCredentialsRequest

logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown) ──────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage resources that live for the duration of the application."""
    settings = get_settings()

    # ---- Startup ----
    _tmpdir = os.environ.get("TMPDIR", "")
    if not _tmpdir or _tmpdir == "/tmp":
        os.environ["TMPDIR"] = "/var/tmp"
        os.environ["TMP"] = "/var/tmp"
        os.environ["TEMP"] = "/var/tmp"
        logger.info("Set TMPDIR=/var/tmp in server process environment")

    # v2.7: Structured logging setup
    from app.logging_config import setup_logging
    log_format_json = os.environ.get("SAMBA_LOG_FORMAT", "standard").lower() == "json"
    setup_logging(settings.LOG_LEVEL, json_format=log_format_json)

    logger.info(
        "Samba API Server starting – host=%s port=%d workers=%d",
        settings.API_HOST,
        settings.API_PORT,
        settings.WORKER_POOL_SIZE,
    )

    from app.worker import get_worker_pool  # noqa: WPS433
    get_worker_pool()

    # v2.7: Initialize management database (api_ma) — now uses PostgreSQL via mgmt_db
    try:
        from app.api_ma import init_db
        init_db()
        logger.info("Management database initialized (PostgreSQL)")
    except Exception as exc:
        logger.warning("Failed to initialize management database: %s", exc)

    # v3.0: Initialize unified SQLAlchemy layer (SQLite via DB_URL by default).
    # This creates all tables from app.models_sqla + seeds the default
    # admin/admin user and built-in roles. Idempotent — safe to call on
    # every startup. For schema migrations use `alembic upgrade head`.
    try:
        from app.db_sqlalchemy import init_db as _sqla_init_db
        _sqla_init_db(seed=True)
        from app.config import get_settings as _get_settings
        _s = _get_settings()
        logger.info(
            "SQLAlchemy layer initialized (DB_URL=%s, seed=admin/admin)",
            getattr(_s, "DB_URL", "sqlite:///app.db"),
        )
    except Exception as exc:
        logger.warning("Failed to initialize SQLAlchemy layer: %s", exc)

    # v3.0: Best-effort DuckDB analytics layer. Auto-disables if the
    # main DB is not SQLite or duckdb is not installed.
    try:
        from app.db_analytics import is_enabled as _duck_enabled, stats as _duck_stats
        if _duck_enabled():
            logger.info("DuckDB analytics layer enabled: %s", _duck_stats())
        else:
            logger.info("DuckDB analytics layer disabled (non-SQLite DB_URL or duckdb missing)")
    except Exception as exc:
        logger.warning("Failed to initialize DuckDB analytics layer: %s", exc)

    # v1.2.7_ban: Initialize ban table schema (mgmt_bans).
    # Safe no-op if mgmt_db pool failed to initialize — ban features
    # will simply return 503 when called.
    try:
        from app.ban_db import ensure_schema
        ensure_schema()
        logger.info("Ban database schema verified (mgmt_bans table)")
    except Exception as exc:
        logger.warning("Failed to initialize ban schema: %s", exc)

    # v2.3: Initialize webhooks + TOTP schemas (idempotent ALTER TABLE).
    try:
        from app.webhooks import ensure_schema as _ensure_webhooks_schema
        _ensure_webhooks_schema()
        logger.info("Webhooks schema verified (mgmt_webhooks table)")
    except Exception as exc:
        logger.warning("Failed to initialize webhooks schema: %s", exc)
    try:
        from app.totp import ensure_schema as _ensure_totp_schema
        _ensure_totp_schema()
        logger.info("TOTP schema verified (mgmt_users.totp_secret column)")
    except Exception as exc:
        logger.warning("Failed to initialize TOTP schema: %s", exc)

    # v2.4: Initialize chat tables
    try:
        from app.chat_db import ensure_schema as _ensure_chat_schema
        _ensure_chat_schema()
        logger.info("Chat schema verified (chat_rooms, chat_messages, etc.)")
    except Exception as exc:
        logger.warning("Failed to initialize chat schema: %s", exc)

    # v2.5: Initialize chat_calls table
    try:
        from app.chat_calls import ensure_schema as _ensure_calls_schema
        _ensure_calls_schema()
        logger.info("Chat calls schema verified (chat_calls table)")
    except Exception as exc:
        logger.warning("Failed to initialize chat calls schema: %s", exc)

    # v2.7: Initialize cache
    try:
        from app.cache import get_cache
        cache = get_cache()
        stats = cache.stats()
        logger.info("Response cache initialized (max_size=%d, default_ttl=%ds)",
                     stats["maxsize"], cache._default_ttl)
    except Exception as exc:
        logger.warning("Failed to initialize cache: %s", exc)

    # v2.7: Install WebSocket hooks on TaskManager
    try:
        from app.tasks import get_task_manager
        from app.ws import get_ws_manager, install_task_hooks
        tm = get_task_manager()
        wsm = get_ws_manager()
        install_task_hooks(tm, wsm)
        logger.info("WebSocket task hooks installed")
    except Exception as exc:
        logger.warning("Failed to install WebSocket task hooks: %s", exc)

    logger.info("Registered API routes:")
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            methods = ",".join(route.methods - {"HEAD", "OPTIONS"})  # type: ignore[operator]
            logger.info("  %s %s", methods, route.path)

    yield  # <- application is running

    # ---- Shutdown ----
    logger.info("Samba API Server shutting down")

    # v1.6.8-2: Call projet graceful shutdown from lifespan (not atexit/signal)
    try:
        from app.routers.shell_projet import graceful_shutdown_projet
        graceful_shutdown_projet()
    except Exception as exc:
        logger.warning("Error during projet shutdown: %s", exc)

    try:
        from app.samdb_direct import reset_all_samdb_connections
        reset_all_samdb_connections()
    except ImportError:
        pass

    # v2.7: Cleanup WebSocket connections
    try:
        from app.ws import get_ws_manager
        wsm = get_ws_manager()
        # Close all active WebSocket connections
        for task_id, connections in list(wsm._task_connections.items()):
            for ws in list(connections):
                try:
                    await ws.close(code=1001, reason="Server shutting down")
                except Exception:
                    pass
        for ws in list(wsm._global_connections):
            try:
                await ws.close(code=1001, reason="Server shutting down")
            except Exception:
                pass
        logger.info("WebSocket connections closed")
    except Exception as exc:
        logger.warning("Error closing WebSocket connections: %s", exc)

    # v2.7: Cleanup cache
    try:
        from app.cache import get_cache
        cache = get_cache()
        cache.invalidate_all()
    except Exception:
        pass

    shutdown_worker_pool(wait=True)


# ── Application factory ────────────────────────────────────────────────

def create_app() -> FastAPI:
    """Build and return the fully configured :class:`FastAPI` instance."""

    app = FastAPI(
        title="Samba AD DC Management API",
        version="pr-a.1.3",
        redirect_slashes=False,
        description=(
            "REST API for administering Samba AD DC via samba-tool.\n\n"
            "## Authentication\n"
            "Supports both **API Key** (``X-API-Key`` header) and "
            "**JWT Bearer** (``Authorization: Bearer <token>``) authentication.\n\n"
            "## Versions\n"
            "- v1.2.1_fix: Added fast ldbsearch-based /full endpoints and dashboard\n"
            "- v1.2.2_fix: Fixed cache AttributeError, replaced TTLCache internals\n"
            "- v1.2.3_fix: ALL read endpoints now use ldbsearch instead of samba-tool\n"
            "- v1.4.3: Shell execution router\n"
            "- v2.8: Batch operations with rollback\n"
            "- v2.7: JWT auth, rate limiting, caching, pagination, WebSocket, "
            "Prometheus metrics, structured logging, CSV import/export, OU tree, "
            "system stats, user/API-key management\n"
            "- v3.7: Added ``/api/v1/auth/me`` and ``/api/v1/auth/check``\n"
            "- v3.8: ``/auth/check`` now also accepts X-API-Key and JWT Bearer (not only login/password)\n"
            "- v3.9: Fixed contact add ``--ou`` (was ``--contactou``), fixed contact show/move/delete name resolution, added missing contact fields\n"
            "- v1.6.7: Shell Project — fixed async run race, config from settings, concurrent run protection, WS client compat\n"
            "- v1.6.6: Shell Project /list routing fix, separate rate limit category, debug delays\n"
        ),
        lifespan=lifespan,
    )

    # ── v2.0.4: WEB_ENABLED enforcement helper ──────────────────────
    def _is_web_enabled() -> bool:
        """Check if web panel is enabled.

        Tries multiple methods in order of reliability:
        1. Settings model (pydantic-settings) — primary
        2. Direct /etc/webadc/.env file reading — fallback for cases
           where pydantic-settings doesn't load the .env file
        3. os.environ — set by systemd EnvironmentFile directive
        4. Default: True (web enabled)

        Returns True if web panel should be served, False to disable.
        """
        # Method 1: Settings model (preferred)
        try:
            from app.config import get_settings
            settings = get_settings()
            return settings.WEB_ENABLED
        except Exception:
            pass

        # Method 2: Direct .env file reading (most reliable fallback)
        try:
            for env_path in [Path("/etc/webadc/.env"), Path(".env")]:
                if env_path.is_file():
                    for line in env_path.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if line.startswith("#") or line.startswith(";") or "=" not in line:
                            continue
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key in ("WEB_ENABLED", "SAMBA_WEB_ENABLED"):
                            return value.lower() in ("true", "1", "yes", "on")
        except Exception:
            pass

        # Method 3: os.environ (set by systemd EnvironmentFile)
        val = os.environ.get("WEB_ENABLED", os.environ.get("SAMBA_WEB_ENABLED", ""))
        if val:
            return val.lower() in ("true", "1", "yes", "on")

        # Default: web enabled
        return True

    # ── CORS ───────────────────────────────────────────────────────
    # v2.7: Configurable CORS origins
    from app.middleware import get_cors_config
    cors_config = get_cors_config(settings=None)  # Will read from env
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_config.get("allow_origins", ["*"]),
        allow_credentials=cors_config.get("allow_credentials", True),
        allow_methods=cors_config.get("allow_methods", ["*"]),
        allow_headers=cors_config.get("allow_headers", ["*"]),
    )

    # ── v2.0.4: WEB_ENABLED enforcement middleware ────────────────────
    # When WEB_ENABLED=false, this middleware blocks ALL web panel routes
    # (SPA, static files, /web/* sub-app) while allowing API routes,
    # health checks, docs, and WebSocket connections to work normally.
    # This is a defense-in-depth measure — even if individual route
    # handlers don't check WEB_ENABLED, this middleware catches them.
    @app.middleware("http")
    async def web_disabled_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Block web panel routes when WEB_ENABLED=false.

        Allows: /api/*, /health*, /metrics, /docs, /openapi.json, /redoc, /ws/*
        Blocks: everything else (SPA, static files, /web/*) → 404
        """
        if not _is_web_enabled():
            path = request.url.path

            # Paths that are ALWAYS allowed regardless of WEB_ENABLED
            _ALWAYS_ALLOWED = (
                "/api/",            # All API endpoints
                "/health",          # Health checks
                "/metrics",         # Prometheus metrics
                "/docs",            # API documentation
                "/openapi.json",    # OpenAPI schema
                "/redoc",           # ReDoc documentation
                "/ws/",             # WebSocket connections
            )

            # Check if path should be allowed
            if path == "/" or not any(path.startswith(prefix) for prefix in _ALWAYS_ALLOWED):
                # Log the blocked request (only at debug level to avoid spam)
                if path not in ("/", "/favicon.ico", "/robots.txt"):
                    logger.debug("[WEB-DISABLED] Blocked request: %s %s", request.method, path)
                return JSONResponse(
                    status_code=404,
                    content={
                        "status": "error",
                        "detail": "Web panel is disabled. Set WEB_ENABLED=true in .env to enable.",
                        "error_code": "WEB_DISABLED",
                    },
                )

        return await call_next(request)

    # ── v2.7: Request ID middleware ────────────────────────────────
    from app.logging_config import RequestIDMiddleware
    app.add_middleware(RequestIDMiddleware)

    # ── v2.7: Prometheus metrics middleware ─────────────────────────
    from app.middleware import PrometheusMiddleware
    app.add_middleware(PrometheusMiddleware)

    # ── v2.7: Rate limiting middleware ──────────────────────────────
    from app.middleware import RateLimitMiddleware
    _rate_settings = get_settings()
    app.add_middleware(
        RateLimitMiddleware,
        auth_limit=_rate_settings.RATE_LIMIT_AUTH_PER_MIN,
        read_limit=_rate_settings.RATE_LIMIT_READ_PER_MIN,
        write_limit=_rate_settings.RATE_LIMIT_WRITE_PER_MIN,
        shell_projet_limit=getattr(_rate_settings, 'RATE_LIMIT_SHELL_PROJET_PER_MIN', 120),
        window_seconds=getattr(_rate_settings, 'RATE_LIMIT_WINDOW_SECONDS', 60),
        per_user_limit=getattr(_rate_settings, 'RATE_LIMIT_PER_USER_PER_MIN', 0),
    )

    # ── Combined Auth middleware (API Key + JWT) ──────────────────
    _PUBLIC_PATHS: frozenset[str] = frozenset({
        "/",                         # v2.0.1: Root — WebADC SPA entry point
        "/health",
        "/health/detailed",
        "/metrics",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/web/api/health",          # Web panel health check (public)
        "/api/v1/auth/login",      # v2.7: Login endpoint
        "/api/v1/auth/refresh",    # v2.7: Refresh token endpoint
        "/api/v1/auth/check",      # v3.7: Credentials check endpoint
        "/api/v1/auth/login/verify",  # v2.3: 2FA login step 2 (temp_token + TOTP code)
        "/api/v1/auth/test",        # v2.4.4: Credential diagnostic (always 200)
    })

    # v1.9.3: Auth is required ONLY for /api/ paths.
    # Everything else (SPA static files, /health, /ws/, etc.) is public.
    _AUTH_REQUIRED_PREFIXES: tuple[str, ...] = (
        "/api/",                     # All API endpoints require auth (unless in _PUBLIC_PATHS)
    )

    # v2.0.1: Web static file paths that never require auth.
    # These are served by the SPA fallback route at /{path:path}.
    _WEB_STATIC_PREFIXES: tuple[str, ...] = (
        "/_next/",                   # Next.js static assets
        "/locales/",                 # i18n translation files
        "/favicon",
        "/logo",
        "/robots.txt",
        "/404.html",
        "/ws/",                      # WebSocket connections
    )

    @app.middleware("http")
    async def combined_auth_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Enforce API-key or JWT authentication on /api/ paths only.

        v2.0.1: Auth is ONLY required for paths starting with /api/.
        ALL other paths are PUBLIC — this includes the root /, SPA
        static files, WebSocket connections, health checks, etc.

        v2.7: Supports both X-API-Key header and Bearer JWT tokens.
        """
        path = request.url.path

        # Skip auth for public paths (health, docs, login endpoints, etc.)
        if path in _PUBLIC_PATHS:
            return await call_next(request)

        # v2.0.1: Skip auth for web static file paths explicitly
        if any(path.startswith(prefix) for prefix in _WEB_STATIC_PREFIXES):
            return await call_next(request)

        # v2.0.1: Auth is ONLY required for /api/ paths.
        # Everything else is public (SPA, static files, WebSocket, etc.)
        is_api_path = any(path.startswith(prefix) for prefix in _AUTH_REQUIRED_PREFIXES)
        if not is_api_path:
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        settings = get_settings()

        # Try JWT Bearer token first
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                from app.auth_jwt import decode_token
                payload = decode_token(token)
                if payload and payload.get("type") == "access":
                    # v2.8: Permission check for JWT tokens
                    jwt_role = payload.get("role", "operator")
                    try:
                        from app.api_ma import has_permission
                        if not has_permission(jwt_role, request.method, path):
                            # Try to resolve the specific permission for better error msg
                            try:
                                from app.permissions import resolve_permission
                                req_perm = resolve_permission(request.method, path)
                                perm_msg = f" (requires: {req_perm})" if req_perm else ""
                            except Exception:
                                perm_msg = ""
                            return JSONResponse(
                                status_code=403,
                                content=ErrorResponse(
                                    status="error",
                                    message=f"Role '{jwt_role}' does not have permission for {request.method} {path}{perm_msg}",
                                ).model_dump(),
                            )
                    except Exception:
                        pass  # Permission system not available, allow
                    # Store user info in request state for downstream use
                    request.state.user = payload
                    request.state.auth_method = "jwt"
                    request.state.role = jwt_role

                    # v1.2.7_ban: Check if the JWT user is currently banned.
                    # Skip the check for admin role (admin cannot be banned
                    # by another admin in current implementation — but we
                    # still allow the check to run in case an admin was
                    # banned directly in DB).
                    jwt_username = payload.get("username") or payload.get("sub") or ""
                    if jwt_username:
                        try:
                            from app.ban_db import is_user_banned
                            ban_record = is_user_banned(jwt_username)
                            if ban_record:
                                return JSONResponse(
                                    status_code=403,
                                    content=ErrorResponse(
                                        status="error",
                                        message=(
                                            f"User '{jwt_username}' is banned"
                                            + (f": {ban_record.get('reason')}" if ban_record.get('reason') else "")
                                            + (f" (expires: {ban_record.get('expires_at')})" if ban_record.get('expires_at') else " (permanent)")
                                        ),
                                    ).model_dump(),
                                )
                        except Exception as ban_exc:
                            logger.debug("Ban check failed (non-fatal): %s", ban_exc)

                    # v2.3.4: Audit log for JWT-authenticated requests.
                    # Previously this path did `return await call_next(request)`
                    # which SKIPPED the audit log code at the bottom (that code
                    # was only reached by the API-key path). Now we inline the
                    # same audit logic here so JWT requests are logged too.
                    import time as _jwt_audit_time
                    _jwt_audit_start = _jwt_audit_time.monotonic()
                    _jwt_response = await call_next(request)
                    _jwt_audit_duration_ms = int((_jwt_audit_time.monotonic() - _jwt_audit_start) * 1000)

                    try:
                        from app.api_ma import log_action, get_user_by_username
                        _jwt_username = jwt_username or payload.get("sub") or payload.get("username") or ""
                        _jwt_user_id = None
                        if _jwt_username:
                            try:
                                _jwt_u = get_user_by_username(_jwt_username)
                                if _jwt_u:
                                    _jwt_user_id = _jwt_u["id"]
                            except Exception:
                                pass

                        log_action(
                            user_id=_jwt_user_id,
                            api_key_id=None,
                            action=f"{request.method} {path}",
                            endpoint=path,
                            ip_address=request.client.host if request.client else "",
                            username=_jwt_username,
                            method=request.method,
                            status_code=_jwt_response.status_code,
                            duration_ms=_jwt_audit_duration_ms,
                            user_agent=request.headers.get("user-agent", ""),
                            request_body=None,
                            auth_method="jwt",
                        )
                    except Exception:
                        pass  # Audit logging is best-effort

                    return _jwt_response
            except Exception as exc:
                logger.debug("JWT validation failed: %s", exc)
                return JSONResponse(
                    status_code=401,
                    content={"detail": {
                        "status": "error",
                        "message": "Invalid or expired JWT token. Please login again.",
                        "code": "INVALID_JWT",
                    }},
                )

        # Try API key
        api_key = request.headers.get("X-API-Key")
        if api_key:
            # v2.7: Check against management DB first, then static key
            validated = False
            role = "admin"

            # Check management DB (api_ma)
            try:
                from app.api_ma import validate_api_key
                result = validate_api_key(api_key)
                # v2.4.2: Check for disabled-account/role/expiry markers
                if result and result.get("_auth_status"):
                    _status = result["_auth_status"]
                    _uname = result.get("username", "")
                    if _status == "user_disabled":
                        return JSONResponse(
                            status_code=403,
                            content={"detail": {
                                "status": "error",
                                "message": f"Account '{_uname}' is disabled. Contact your administrator to re-enable it.",
                                "code": "ACCOUNT_DISABLED",
                                "username": _uname,
                            }},
                        )
                    elif _status == "key_disabled":
                        return JSONResponse(
                            status_code=403,
                            content={"detail": {
                                "status": "error",
                                "message": f"This API key is deactivated. Contact your administrator to re-enable it.",
                                "code": "KEY_DISABLED",
                                "username": _uname,
                            }},
                        )
                    elif _status == "role_disabled":
                        _rn = result.get("role", "")
                        return JSONResponse(
                            status_code=403,
                            content={"detail": {
                                "status": "error",
                                "message": f"Role '{_rn}' is disabled. All API keys with this role are rejected. Contact your administrator.",
                                "code": "ROLE_DISABLED",
                                "role": _rn,
                            }},
                        )
                    elif _status == "key_expired":
                        return JSONResponse(
                            status_code=401,
                            content={"detail": {
                                "status": "error",
                                "message": "This API key has expired. Contact your administrator to rotate it.",
                                "code": "KEY_EXPIRED",
                            }},
                        )
                if result and not result.get("_auth_status"):
                    validated = True
                    role = result.get("role", "operator")
                    request.state.api_key_info = result
                    request.state.auth_method = "api_key"
            except Exception:
                pass  # api_ma not available, fall back to static key

            # Fallback: check static API key from settings
            if not validated:
                import secrets
                if secrets.compare_digest(api_key, settings.API_KEY):
                    validated = True
                    request.state.auth_method = "static_api_key"

            if validated:
                request.state.role = role
                # v2.8: Granular permission-based access control
                from app.api_ma import has_permission
                if not has_permission(role, request.method, path):
                    # Try to resolve the specific permission for better error msg
                    perm_msg = ""
                    try:
                        from app.permissions import resolve_permission
                        req_perm = resolve_permission(request.method, path)
                        if req_perm:
                            perm_msg = f" (requires: {req_perm})"
                    except Exception:
                        pass
                    return JSONResponse(
                        status_code=403,
                        content=ErrorResponse(
                            status="error",
                            message=f"Role '{role}' does not have permission for {request.method} {path}{perm_msg}",
                        ).model_dump(),
                    )

                # v1.2.7_ban: Check if the API key (or its owning user)
                # is currently banned. We check both:
                #   1. The key itself (by key_prefix)
                #   2. The owning user (by username, if available)
                # Static API key (settings.API_KEY) cannot be banned — it
                # is the bootstrap admin key.
                if request.state.auth_method == "api_key":
                    try:
                        from app.ban_db import is_key_banned, is_user_banned
                        key_info = getattr(request.state, "api_key_info", {}) or {}
                        key_prefix = key_info.get("key_prefix") or ""
                        owner_username = key_info.get("username") or key_info.get("name") or ""

                        # Check key ban first
                        if key_prefix:
                            ban_rec = is_key_banned(key_prefix)
                            if ban_rec:
                                return JSONResponse(
                                    status_code=403,
                                    content=ErrorResponse(
                                        status="error",
                                        message=(
                                            f"API key '{key_prefix}…' is banned"
                                            + (f": {ban_rec.get('reason')}" if ban_rec.get('reason') else "")
                                            + (f" (expires: {ban_rec.get('expires_at')})" if ban_rec.get('expires_at') else " (permanent)")
                                        ),
                                    ).model_dump(),
                                )
                        # Then check owning user ban
                        if owner_username:
                            ban_rec = is_user_banned(owner_username)
                            if ban_rec:
                                return JSONResponse(
                                    status_code=403,
                                    content=ErrorResponse(
                                        status="error",
                                        message=(
                                            f"User '{owner_username}' (owner of this API key) is banned"
                                            + (f": {ban_rec.get('reason')}" if ban_rec.get('reason') else "")
                                            + (f" (expires: {ban_rec.get('expires_at')})" if ban_rec.get('expires_at') else " (permanent)")
                                        ),
                                    ).model_dump(),
                                )
                    except Exception as ban_exc:
                        logger.debug("Ban check failed (non-fatal): %s", ban_exc)

                # Audit log the authenticated action
                # v2.3.2: Rich audit log with HTTP context + semantic events
                import time as _time
                _audit_start = _time.monotonic()
                response = await call_next(request)
                _audit_duration_ms = int((_time.monotonic() - _audit_start) * 1000)

                try:
                    from app.api_ma import log_action
                    auth_method = getattr(request.state, "auth_method", None)
                    username = None
                    user_id = None
                    api_key_id = None

                    if auth_method == "jwt":
                        payload = getattr(request.state, "user", {}) or {}
                        username = payload.get("sub") or payload.get("username")
                        # Resolve user_id from DB by username (best-effort)
                        if username:
                            try:
                                from app.api_ma import get_user_by_username
                                u = get_user_by_username(username)
                                if u:
                                    user_id = u["id"]
                            except Exception:
                                pass
                    elif auth_method in ("api_key", "static_api_key"):
                        key_info = getattr(request.state, "api_key_info", None) or {}
                        user_id = key_info.get("user_id")
                        api_key_id = key_info.get("key_id")
                        username = key_info.get("username")
                        # v2.3.3: Static API key has no DB-backed user — give it
                        # a recognisable pseudo-username so audit log rows aren't
                        # completely empty. This makes it easy to filter requests
                        # made with the bootstrap admin key.
                        if auth_method == "static_api_key" and not username:
                            username = "(static-admin)"
                            # user_id stays None — static key has no DB user.
                            # If a get_user_by_username("(static-admin)") ever
                            # succeeds (it shouldn't), we'd assign that ID;
                            # otherwise leave null.

                    # Capture request body snippet (best-effort, ≤512 chars)
                    # — only for write methods (POST/PUT/PATCH/DELETE)
                    body_snippet = None
                    # NOTE: FastAPI consumes the body before this middleware runs,
                    # so we can't read it here without extra plumbing. Leaving as
                    # None — semantic events from individual routers can supply
                    # richer details via log_semantic().

                    # v2.3.3: Build a human-readable details string for non-JWT
                    # auth so the audit log row is self-describing even when
                    # user_id is null (static API key path).
                    details_str = None
                    if auth_method == "static_api_key":
                        details_str = "Request made with static bootstrap API key"

                    log_action(
                        user_id=user_id,
                        api_key_id=api_key_id,
                        action=f"{request.method} {path}",
                        endpoint=path,
                        ip_address=request.client.host if request.client else "",
                        username=username,
                        method=request.method,
                        status_code=response.status_code,
                        duration_ms=_audit_duration_ms,
                        user_agent=request.headers.get("user-agent", ""),
                        request_body=body_snippet,
                        auth_method=auth_method,
                        details=details_str,
                    )

                    # v2.3.2: Emit webhook for failed login attempts
                    if (path == "/api/v1/auth/login"
                            and response.status_code == 401
                            and username is None):
                        # body may contain the username — but we can't read
                        # it here. Just emit a generic auth.login_failure.
                        try:
                            from app.webhooks import emit_auth_event
                            emit_auth_event(
                                "login_failure",
                                username="(unknown)",
                                ip=request.client.host if request.client else "",
                            )
                        except Exception:
                            pass
                except Exception:
                    pass  # Audit logging is best-effort
                return response

            return JSONResponse(
                status_code=401,
                content={"detail": {
                    "status": "error",
                    "message": "Invalid API key",
                    "code": "INVALID_API_KEY",
                }},
            )

        # No authentication provided
        return JSONResponse(
            status_code=401,
            content={"detail": {
                "status": "error",
                "message": "Missing authentication. Provide X-API-Key header or Authorization: Bearer token",
                "code": "AUTH_REQUIRED",
            }},
        )

    # ── v2.7: Cache invalidation middleware ─────────────────────────
    # v1.2.1_fix: Also invalidates ldb_reader cache on write ops.
    @app.middleware("http")
    async def cache_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Invalidate cache on write operations.

        On POST/PUT/DELETE/PATCH requests, invalidates both the
        response cache (``app.cache``) and the ldb_reader internal
        cache so that subsequent ``/full`` endpoint reads return
        fresh data from ldbsearch.
        """
        response = await call_next(request)

        # Invalidate cache on write operations
        if request.method in ("POST", "PUT", "DELETE", "PATCH"):
            try:
                from app.cache import get_cache
                cache = get_cache()
                cache.invalidate_for_write(request.url.path)
            except Exception:
                pass
            # v1.2.1_fix: Also invalidate ldb_reader cache
            try:
                from app.ldb_reader import invalidate_cache
                invalidate_cache()
            except Exception:
                pass

        return response

    # ── Custom exception handlers ──────────────────────────────────

    @app.exception_handler(SambaToolError)
    async def samba_tool_error_handler(  # type: ignore[no-untyped-def]
        request: Request,
        exc: SambaToolError,
    ):
        http_status = exc.http_status
        if http_status == 500:
            http_status = classify_samba_error(exc)
        logger.error(
            "SambaToolError on %s (HTTP %d): %s",
            request.url.path, http_status, exc,
        )
        return JSONResponse(
            status_code=http_status,
            content=ErrorResponse(
                status="error",
                message=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(RuntimeError)
    async def runtime_error_handler(  # type: ignore[no-untyped-def]
        request: Request,
        exc: RuntimeError,
    ):
        http_status = classify_samba_error(exc)
        logger.error("RuntimeError on %s (HTTP %d): %s", request.url.path, http_status, exc)
        return JSONResponse(
            status_code=http_status,
            content=ErrorResponse(
                status="error",
                message=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(TimeoutError)
    async def timeout_error_handler(  # type: ignore[no-untyped-def]
        request: Request,
        exc: TimeoutError,
    ):
        logger.error("TimeoutError on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=504,
            content=ErrorResponse(
                status="error",
                message="Operation timed out",
                details=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(ValueError)
    async def value_error_handler(  # type: ignore[no-untyped-def]
        request: Request,
        exc: ValueError,
    ):
        logger.warning("ValueError on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                status="error",
                message=str(exc),
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def generic_error_handler(  # type: ignore[no-untyped-def]
        request: Request,
        exc: Exception,
    ):
        logger.exception("Unhandled exception on %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                status="error",
                message="Internal server error",
                details=str(exc) if logger.isEnabledFor(logging.DEBUG) else None,
            ).model_dump(),
        )

    # ── Health check ───────────────────────────────────────────────

    @app.get("/health", tags=["system"])
    async def health_check() -> dict[str, str]:
        settings = get_settings()
        role = settings.ensure_server_role()
        return {
            "status": "ok",
            "service": "samba-api-server",
            "server_role": role,
            "version": "pr-a.1.3",
        }

    # v2.7: Detailed health check
    @app.get("/health/detailed", tags=["system"])
    async def health_check_detailed() -> dict:
        from app.monitoring import get_health_detailed
        return get_health_detailed()

    # v2.7: Prometheus metrics endpoint
    @app.get("/metrics", tags=["system"])
    async def prometheus_metrics():
        from app.monitoring import get_metrics
        from app.middleware import get_prometheus_metrics
        metrics = get_metrics()
        # Merge middleware HTTP metrics
        mw_metrics = get_prometheus_metrics()
        return {**metrics.get_stats(), **mw_metrics}

    # v2.7: System stats endpoint
    @app.get("/api/v1/system/stats", tags=["system"])
    async def system_stats():
        from app.monitoring import get_system_stats, get_samba_stats
        return {
            "status": "ok",
            "system": get_system_stats(),
            "samba": get_samba_stats(),
        }

    # v2.7: Management API endpoints (api_ma router)
    from app.routers import mgmt  # Management API router
    app.include_router(mgmt.router)

    # ── Auth endpoints ─────────────────────────────────────────────
    from app.auth_jwt import authenticate_login, create_access_token, create_refresh_token, decode_token

    @app.post("/api/v1/auth/login", response_model=TokenResponse, tags=["Authentication"])
    async def login(body: LoginRequest, request: Request):
        """Authenticate with username/password and get JWT tokens.

        v2.3: If 2FA is enabled for the user, returns
        ``{totp_required: true, temp_token: "..."}`` instead of full
        tokens. The caller must then POST ``/api/v1/auth/login/verify``
        with the temp_token and a 6-digit TOTP code to obtain the
        full token pair.

        v2.3.2: Audit log enriched — captures username, IP, user-agent,
        success/failure status, duration.
        """
        import time as _time
        from fastapi.responses import JSONResponse as _JSONResp
        _login_start = _time.monotonic()

        def _audit_login(status_code: int, user_id: Optional[int], username_str: str):
            """Best-effort audit log for the login attempt."""
            try:
                from app.api_ma import log_action
                log_action(
                    user_id=user_id,
                    api_key_id=None,
                    action="POST /api/v1/auth/login",
                    endpoint="/api/v1/auth/login",
                    ip_address=request.client.host if request.client else "",
                    username=username_str or body.username,
                    method="POST",
                    status_code=status_code,
                    duration_ms=int((_time.monotonic() - _login_start) * 1000),
                    user_agent=request.headers.get("user-agent", ""),
                    request_body=None,  # don't log password
                    auth_method="credentials",
                    event_type="auth.login_success" if status_code == 200 else "auth.login_failure",
                )
            except Exception:
                pass

        from app.api_ma import authenticate_user
        user = authenticate_user(body.username, body.password)
        if not user:
            _audit_login(401, None, body.username)
            # v2.3.2: Emit webhook for failed login
            try:
                from app.webhooks import emit_auth_event
                emit_auth_event(
                    "login_failure",
                    username=body.username,
                    ip=request.client.host if request.client else "",
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=401,
                detail={"status": "error", "message": "Invalid username or password"},
            )

        # v2.4.1: Check if account is disabled — give clear message
        if user.get("_auth_status") == "disabled":
            _audit_login(403, user.get("id"), body.username)
            raise HTTPException(
                status_code=403,
                detail={
                    "status": "error",
                    "message": f"Account '{body.username}' is disabled. Contact your administrator to re-enable it.",
                    "code": "ACCOUNT_DISABLED",
                    "username": body.username,
                },
            )

        # v2.3: 2FA check — if enabled, return temp_token instead of full tokens
        try:
            from app.totp import is_enabled_for_user
            if is_enabled_for_user(user["id"]):
                from app.routers.twofa import _issue_temp_token
                temp_token = _issue_temp_token(user["id"], body.username)
                _audit_login(200, user["id"], body.username)
                # v2.3.2: Emit webhook for successful login (with 2FA pending)
                try:
                    from app.webhooks import emit_auth_event
                    emit_auth_event(
                        "login_success",
                        username=body.username,
                        ip=request.client.host if request.client else "",
                        user_id=user["id"],
                    )
                except Exception:
                    pass
                return _JSONResp(
                    status_code=200,
                    content={
                        "status": "ok",
                        "totp_required": True,
                        "temp_token": temp_token,
                        "expires_in": 300,  # 5 minutes
                        "username": body.username,
                        "next_step": "POST /api/v1/auth/login/verify with {temp_token, totp_code}",
                    },
                )
        except Exception as exc:
            logger.debug("2FA check failed (non-fatal, skipping): %s", exc)

        token_data = {"sub": user["username"], "role": user["role"]}
        # v2.8: Include permissions in the token
        try:
            from app.api_ma import get_role_permissions
            perms = sorted(get_role_permissions(user["role"]))
            token_data["permissions"] = perms
        except Exception:
            perms = []
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)
        _audit_login(200, user["id"], body.username)
        # v2.3.2: Emit webhook for successful login
        try:
            from app.webhooks import emit_auth_event
            emit_auth_event(
                "login_success",
                username=body.username,
                ip=request.client.host if request.client else "",
                user_id=user["id"],
            )
        except Exception:
            pass
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=1800,
            role=user["role"],
            permissions=perms,
        )

    @app.post("/api/v1/auth/refresh", tags=["Authentication"])
    async def refresh(body: RefreshRequest):
        """Refresh an access token using a refresh token."""
        try:
            payload = decode_token(body.refresh_token)
            if not payload or payload.get("type") != "refresh":
                raise HTTPException(status_code=401, detail="Invalid refresh token")
            token_data = {"sub": payload["sub"], "role": payload["role"]}
            # v2.8: Re-fetch permissions from current role definition
            try:
                from app.api_ma import get_role_permissions
                perms = sorted(get_role_permissions(payload["role"]))
                token_data["permissions"] = perms
            except Exception:
                perms = payload.get("permissions", [])
                token_data["permissions"] = perms
            access_token = create_access_token(token_data)
            new_refresh = create_refresh_token(token_data)
            return TokenResponse(
                access_token=access_token,
                refresh_token=new_refresh,
                token_type="bearer",
                expires_in=1800,
                role=payload["role"],
                permissions=perms,
            )
        except Exception as exc:
            raise HTTPException(status_code=401, detail=f"Token refresh failed: {exc}")

    # ── /me endpoint — current user info ───────────────────────────
    @app.get("/api/v1/auth/me", response_model=MeResponse, tags=["Authentication"])
    async def me(request: Request):
        """Return the authenticated user's role, permissions, and expiry info.

        Works with **both** authentication methods:

        * **API Key** — provide the ``X-API-Key`` header.
        * **JWT Bearer** — provide the ``Authorization: Bearer <token>`` header.

        The response includes the user's role, the full list of permissions
        assigned to that role, and the token/key expiry timestamp (if any).
        """
        auth_method = getattr(request.state, "auth_method", None)

        if auth_method == "jwt":
            # JWT Bearer token authentication
            user_payload = getattr(request.state, "user", {})
            role = user_payload.get("role", "unknown")
            permissions = user_payload.get("permissions", [])

            # Re-fetch permissions from the role definition in case
            # they were updated after the token was issued.
            try:
                from app.api_ma import get_role_permissions
                fresh_perms = sorted(get_role_permissions(role))
                if fresh_perms:
                    permissions = fresh_perms
            except Exception:
                pass

            # JWT expiry from token payload
            expires_at = ""
            try:
                exp_ts = user_payload.get("exp")
                if exp_ts:
                    from datetime import datetime, timezone
                    expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat()
            except Exception:
                pass

            username = user_payload.get("sub", "")

            return MeResponse(
                status="ok",
                auth_method="jwt",
                username=username,
                role=role,
                permissions=permissions,
                expires_at=expires_at,
            )

        elif auth_method in ("api_key", "static_api_key"):
            # API Key authentication
            role = getattr(request.state, "role", "unknown")
            key_info = getattr(request.state, "api_key_info", {})

            # Fetch permissions for the role
            permissions = []
            try:
                from app.api_ma import get_role_permissions
                permissions = sorted(get_role_permissions(role))
            except Exception:
                pass

            # API key expiry
            expires_at = key_info.get("expires_at", "") or ""

            username = key_info.get("username", "")

            return MeResponse(
                status="ok",
                auth_method="api_key",
                username=username,
                role=role,
                permissions=permissions,
                expires_at=expires_at or "",
            )

        else:
            raise HTTPException(
                status_code=401,
                detail={"status": "error", "message": "Not authenticated"},
            )

    # ── /auth/check — check credentials (login/password OR X-API-Key OR JWT) ─
    @app.post("/api/v1/auth/check", response_model=MeResponse, tags=["Authentication"])
    async def check_credentials(request: Request, body: CheckCredentialsRequest = None):
        """Verify credentials and return role & permissions.

        Accepts **three** authentication methods (at least one required):

        1. **X-API-Key** header — validates the API key and returns its
           role, permissions, and expiry.
        2. **Authorization: Bearer <token>** — validates a JWT access
           token and returns the embedded role & permissions.
        3. **Username + password** in the request body — validates the
           login/password pair and returns the account's role &
           permissions.

        You can combine methods (e.g. send an API key *and* a body), but
        only the first successfully validated method is used.  Priority:
        API key → JWT → username/password.
        """
        # ── Method 1: X-API-Key header ───────────────────────────────
        api_key = request.headers.get("X-API-Key")
        if api_key:
            settings = get_settings()
            validated = False
            role = "admin"
            key_info = {}

            # Check management DB (api_ma)
            try:
                from app.api_ma import validate_api_key
                result = validate_api_key(api_key)
                if result:
                    validated = True
                    role = result.get("role", "operator")
                    key_info = result
            except Exception:
                pass

            # Fallback: check static API key
            if not validated:
                import secrets as _secrets
                if _secrets.compare_digest(api_key, settings.API_KEY):
                    validated = True
                    role = "admin"

            if validated:
                permissions = []
                try:
                    from app.api_ma import get_role_permissions
                    permissions = sorted(get_role_permissions(role))
                except Exception:
                    pass

                return MeResponse(
                    status="ok",
                    auth_method="api_key",
                    username=key_info.get("username", ""),
                    role=role,
                    permissions=permissions,
                    expires_at=key_info.get("expires_at", "") or "",
                )

        # ── Method 2: JWT Bearer token ───────────────────────────────
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                from app.auth_jwt import decode_token
                payload = decode_token(token)
                if payload and payload.get("type") == "access":
                    jwt_role = payload.get("role", "unknown")
                    permissions = payload.get("permissions", [])

                    # Re-fetch fresh permissions from role definition
                    try:
                        from app.api_ma import get_role_permissions
                        fresh_perms = sorted(get_role_permissions(jwt_role))
                        if fresh_perms:
                            permissions = fresh_perms
                    except Exception:
                        pass

                    # JWT expiry
                    expires_at = ""
                    try:
                        exp_ts = payload.get("exp")
                        if exp_ts:
                            from datetime import datetime, timezone
                            expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat()
                    except Exception:
                        pass

                    return MeResponse(
                        status="ok",
                        auth_method="jwt",
                        username=payload.get("sub", ""),
                        role=jwt_role,
                        permissions=permissions,
                        expires_at=expires_at,
                    )
            except Exception:
                pass  # Invalid JWT, fall through to next method

        # ── Method 3: Username + password in body ────────────────────
        if body and body.username and body.password:
            from app.api_ma import authenticate_user
            user = authenticate_user(body.username, body.password)
            if not user:
                raise HTTPException(
                    status_code=401,
                    detail={"status": "error", "message": "Invalid username or password"},
                )

            role = user.get("role", "unknown")
            permissions = []
            try:
                from app.api_ma import get_role_permissions
                permissions = sorted(get_role_permissions(role))
            except Exception:
                pass

            return MeResponse(
                status="ok",
                auth_method="credentials",
                username=user.get("username", body.username),
                role=role,
                permissions=permissions,
                expires_at="",
            )

        # ── No valid authentication provided ─────────────────────────
        raise HTTPException(
            status_code=401,
            detail={
                "status": "error",
                "message": "No valid authentication provided. Send X-API-Key header, Authorization: Bearer token, or username/password in body.",
            },
        )

    # ── /auth/test — FULL diagnostic (GET) — shows WHY auth succeeds/fails ─
    # v2.4.4: Returns the complete status of the provided credentials —
    # valid/invalid, user active/disabled, key active/disabled/expired,
    # role active/disabled, permissions. Always returns 200 (it's a
    # diagnostic endpoint, not a gatekeeper).
    @app.get("/api/v1/auth/test", tags=["Authentication"])
    async def test_credentials(request: Request):
        """Full credential diagnostic.

        Send ``X-API-Key`` or ``Authorization: Bearer`` — get back the
        complete status: is the key valid? is the user active? is the
        role active? what permissions? what expiry?

        Always returns HTTP 200 — this is a diagnostic endpoint, not
        a gatekeeper. The ``valid`` field tells you if the credentials
        would be accepted by the auth middleware.

        Examples::

            # Test an API key
            curl -s /api/v1/auth/test -H "X-API-Key: WEBADC-XXXXX-XXXXX-XXXXX"

            # Test a JWT
            curl -s /api/v1/auth/test -H "Authorization: Bearer eyJ..."
        """
        from app.config import get_settings
        settings = get_settings()
        result: Dict[str, Any] = {
            "valid": False,
            "auth_method": None,
            "message": "",
            "code": "",
        }

        # ── Try X-API-Key ────────────────────────────────────────────
        api_key = request.headers.get("X-API-Key")
        if api_key:
            result["auth_method"] = "api_key"
            result["key_provided"] = True

            # Check management DB
            try:
                from app.api_ma import validate_api_key
                vr = validate_api_key(api_key)

                if vr is None:
                    result["message"] = "Invalid API key — key not found, hash mismatch, or key deactivated with no owning user"
                    result["code"] = "INVALID_API_KEY"
                    return result

                if vr.get("_auth_status"):
                    _st = vr["_auth_status"]
                    _uname = vr.get("username", "")
                    if _st == "user_disabled":
                        result["message"] = f"Account '{_uname}' is disabled. The API key is valid but the owning user account has been deactivated."
                        result["code"] = "ACCOUNT_DISABLED"
                        result["username"] = _uname
                        result["user_id"] = vr.get("user_id")
                        result["key_id"] = vr.get("key_id")
                    elif _st == "key_disabled":
                        result["message"] = f"This API key is deactivated (but user '{_uname}' is still active)."
                        result["code"] = "KEY_DISABLED"
                        result["username"] = _uname
                        result["user_id"] = vr.get("user_id")
                        result["key_id"] = vr.get("key_id")
                    elif _st == "role_disabled":
                        result["message"] = f"Role '{vr.get('role','')}' is disabled. All API keys with this role are rejected."
                        result["code"] = "ROLE_DISABLED"
                        result["username"] = _uname
                        result["role"] = vr.get("role")
                    elif _st == "key_expired":
                        result["message"] = f"This API key has expired (expired at: {vr.get('expires_at','?')})."
                        result["code"] = "KEY_EXPIRED"
                        result["expires_at"] = vr.get("expires_at")
                    return result

                # Fully valid
                result["valid"] = True
                result["message"] = "API key is valid"
                result["username"] = vr.get("username", "")
                result["user_id"] = vr.get("user_id")
                result["key_id"] = vr.get("key_id")
                result["role"] = vr.get("role", "")
                result["key_prefix"] = vr.get("key_prefix", "")
                result["expires_at"] = vr.get("expires_at")
                result["permissions"] = vr.get("permissions", [])
                return result

            except Exception as exc:
                # api_ma not available — try static key
                pass

            # Fallback: static API key from .env
            import secrets as _secrets
            if _secrets.compare_digest(api_key, settings.API_KEY):
                result["valid"] = True
                result["auth_method"] = "static_api_key"
                result["message"] = "Static bootstrap API key (from .env SAMBA_API_KEY) is valid"
                result["username"] = "(static-admin)"
                result["role"] = "admin"
                try:
                    from app.api_ma import get_role_permissions
                    result["permissions"] = sorted(get_role_permissions("admin"))
                except Exception:
                    result["permissions"] = []
                return result

            result["message"] = "Invalid API key"
            result["code"] = "INVALID_API_KEY"
            return result

        # ── Try JWT Bearer ───────────────────────────────────────────
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            result["auth_method"] = "jwt"
            result["token_provided"] = True

            try:
                from app.auth_jwt import decode_token
                payload = decode_token(token)
                if payload and payload.get("type") == "access":
                    jwt_role = payload.get("role", "unknown")
                    jwt_username = payload.get("sub", "")

                    # Check if user is still active
                    user_active = True
                    user_id = None
                    if jwt_username:
                        try:
                            from app.api_ma import get_user_by_username
                            u = get_user_by_username(jwt_username)
                            if u:
                                user_id = u["id"]
                                user_active = bool(u.get("is_active", 1))
                        except Exception:
                            pass

                    if not user_active:
                        result["message"] = f"Account '{jwt_username}' is disabled. The JWT token is technically valid, but the account has been deactivated."
                        result["code"] = "ACCOUNT_DISABLED"
                        result["username"] = jwt_username
                        result["user_id"] = user_id
                        result["role"] = jwt_role
                        return result

                    # Check if role is still active
                    try:
                        from app.api_ma import get_role
                        role_info = get_role(jwt_role)
                        if role_info and not role_info.get("is_active", 1):
                            result["message"] = f"Role '{jwt_role}' is disabled. The JWT is valid but the role has been deactivated."
                            result["code"] = "ROLE_DISABLED"
                            result["username"] = jwt_username
                            result["role"] = jwt_role
                            return result
                    except Exception:
                        pass

                    # Fully valid
                    result["valid"] = True
                    result["message"] = "JWT token is valid"
                    result["username"] = jwt_username
                    result["user_id"] = user_id
                    result["role"] = jwt_role
                    result["permissions"] = payload.get("permissions", [])

                    # Fresh permissions from DB
                    try:
                        from app.api_ma import get_role_permissions
                        fresh = sorted(get_role_permissions(jwt_role))
                        if fresh:
                            result["permissions"] = fresh
                    except Exception:
                        pass

                    # Expiry
                    try:
                        exp_ts = payload.get("exp")
                        if exp_ts:
                            from datetime import datetime, timezone
                            result["expires_at"] = datetime.fromtimestamp(exp_ts, tz=timezone.utc).isoformat()
                    except Exception:
                        pass

                    return result
                else:
                    result["message"] = "JWT token is not an access token (wrong type)"
                    result["code"] = "INVALID_JWT_TYPE"
                    return result
            except Exception as exc:
                result["message"] = f"Invalid or expired JWT token: {exc}"
                result["code"] = "INVALID_JWT"
                return result

        # ── No credentials provided ──────────────────────────────────
        result["message"] = "No credentials provided. Send X-API-Key header or Authorization: Bearer token."
        result["code"] = "AUTH_REQUIRED"
        return result

    # ── Routers ────────────────────────────────────────────────────
    from app.routers import (
        user,
        group,
        computer,
        contact,
        ou,
        domain,
        dns,
        sites,
        fsmo,
        drs,
        gpo,
        schema,
        delegation,
        service_account,
        auth_policy,
        misc,
        shell,             # v1.4.3: Shell execution router
        batch,             # v2.8: Batch execution router
        user_mgmt,         # v2.7: Extended user management (search, import/export, batch)
        ou_mgmt,           # v2.7: Extended OU management (tree, stats, search)
        dashboard,         # v1.2.1_fix: Full AD dashboard via ldbsearch
        shell_projet,      # v1.6.4: Shell Project router (workspace + WebSocket)
        ai,                # v1.6.8-1: AI Assistant router (Polza.ai + Task Builder)
        sdb,               # v2.0: SDB — Samba Database Query Tool (direct LDB access, SQL-like, export)
        report,            # v1.9-3-4: Report — Multi-sheet AD report generation (XLSX, 8 sheets)
        cfg,               # v2.1: CFG — Runtime .env configuration management (hot-reload, no reboot)
        ban,               # v1.2.7_ban: Ban / Unban router (users + API keys)
        # v2.3 new routers
        webhooks,          # v2.3: Webhook registration + dispatch
        backup,            # v2.3: Backup / Restore (sam.ldb + mgmt DB)
        bulk_users,        # v2.3: Bulk operations on AD users
        shell_projet_files,  # v2.3: File manager for shell-project workspaces
        audit_export,      # v2.3: Audit log CSV/XLSX/JSON export
        dashboard_charts,  # v2.3: Aggregated data for dashboard charts
        live,              # v2.3: SSE live events stream
        twofa,             # v2.3: 2FA / TOTP setup + verify
        shell_ws,          # v2.3: WebSocket real-time shell execution
        twofa_admin,       # v2.3.1: Admin endpoints for managing 2FA on other users
        chat,              # v2.4: Chat REST API
        chat_ws,           # v2.4: Chat WebSocket
    )

    api_prefix = "/api/v1"
    app.include_router(user.router, prefix=api_prefix)
    app.include_router(group.router, prefix=api_prefix)
    app.include_router(computer.router, prefix=api_prefix)
    app.include_router(contact.router, prefix=api_prefix)
    app.include_router(ou.router, prefix=api_prefix)
    app.include_router(domain.router, prefix=api_prefix)
    app.include_router(dns.router, prefix=api_prefix)
    app.include_router(sites.router, prefix=api_prefix)
    app.include_router(fsmo.router, prefix=api_prefix)
    app.include_router(drs.router, prefix=api_prefix)
    app.include_router(gpo.router, prefix=api_prefix)
    app.include_router(schema.router, prefix=api_prefix)
    app.include_router(delegation.router, prefix=api_prefix)
    app.include_router(service_account.router, prefix=api_prefix)
    app.include_router(auth_policy.router, prefix=api_prefix)
    app.include_router(misc.router, prefix=api_prefix)
    app.include_router(shell.router, prefix=api_prefix)           # v1.4.3
    app.include_router(batch.router, prefix=api_prefix)           # v2.8
    app.include_router(user_mgmt.router, prefix=api_prefix)       # v2.7
    app.include_router(ou_mgmt.router, prefix=api_prefix)         # v2.7
    app.include_router(dashboard.router, prefix=api_prefix)       # v1.2.1_fix
    app.include_router(shell_projet.router, prefix=api_prefix)    # v1.6.4
    app.include_router(ai.router, prefix=api_prefix)               # v1.6.8-1
    app.include_router(sdb.router, prefix=api_prefix)               # v2.0: SDB
    app.include_router(report.router, prefix=api_prefix)             # v1.9-3-4: Report
    app.include_router(cfg.router, prefix=api_prefix)                # v2.1: CFG — Runtime .env management
    app.include_router(ban.router, prefix=api_prefix)                # v1.2.7_ban: Ban / Unban

    # ── v2.3 new routers ─────────────────────────────────────────────
    # Note: most of these have their own /api/v1 prefix baked in,
    # so we don't pass prefix here.
    app.include_router(webhooks.router)            # /api/v1/webhooks
    app.include_router(backup.router)              # /api/v1/backup
    app.include_router(bulk_users.router)          # /api/v1/users/bulk
    app.include_router(shell_projet_files.router)  # /api/v1/shell/projet/{id}/files/*
    app.include_router(audit_export.router)        # /api/v1/mgmt/audit/export
    app.include_router(dashboard_charts.router)    # /api/v1/dashboard/charts/*
    app.include_router(live.router)                # /api/v1/live/events
    app.include_router(twofa.router)               # /api/v1/auth/2fa/* (requires auth)
    app.include_router(twofa.public_router)        # /api/v1/auth/login/verify (PUBLIC)
    app.include_router(twofa_admin.router)         # /api/v1/mgmt/users/{id}/2fa/* (admin only)
    app.include_router(shell_ws.router)            # /ws/shell (WebSocket, no prefix)
    app.include_router(chat.router)                # /api/v1/chat/* (REST)
    app.include_router(chat_ws.router)             # /ws/chat/{room_id} (WebSocket)

    # ── Web Panel (SPA at /) ──────────────────────────────────────────
    # Include the web router (provides /web/api/health endpoint).
    # MUST be before setup_web_routes so the health endpoint is registered
    # before the catch-all /{path:path} route.
    from app.routers.web import router as web_router
    app.include_router(web_router)

    # setup_web_routes registers a catch-all /{path:path} route that serves
    # the WebADC SPA. It MUST be called after all API routers so the
    # catch-all doesn't shadow /api/v1/* paths.
    # Controlled by WEB_ENABLED in .env (default: true).
    from app.routers.web import setup_web_routes
    setup_web_routes(app)

    # v1.6.8-3 fix #1: Register app reference for in-memory OpenAPI access
    # This allows the AI service to get /openapi.json without making an HTTP
    # self-request (which caused a deadlock with single-worker uvicorn).
    try:
        from app.services.ai_service import register_app
        register_app(app)
    except Exception as exc:
        logger.warning("Failed to register app for AI service: %s", exc)

    # ── Task status endpoint ────────────────────────────────────────
    from app.tasks import get_task_manager

    @app.get("/api/v1/tasks/{task_id}")
    async def get_task(task_id: str):
        tm = get_task_manager()
        task_status = tm.get_task_status(task_id)
        if task_status is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return task_status

    # v2.7: List all tasks
    @app.get("/api/v1/tasks", tags=["Tasks"])
    async def list_tasks():
        tm = get_task_manager()
        return {"status": "ok", "tasks": tm.list_tasks()}

    # v2.7: WebSocket endpoints for task notifications
    from app.ws import get_ws_manager

    @app.websocket("/ws/tasks/{task_id}")
    async def ws_task_status(websocket: WebSocket, task_id: str):
        """WebSocket endpoint for real-time task status updates."""
        wsm = get_ws_manager()
        tm = get_task_manager()

        # Check if task exists
        task_status = tm.get_task_status(task_id)
        if task_status is None:
            await websocket.close(code=1008, reason="Task not found")
            return

        await wsm.connect(websocket, task_id)
        try:
            # Send current status immediately
            await websocket.send_json(task_status)
            # Keep connection alive, wait for disconnect
            while True:
                try:
                    data = await websocket.receive_text()
                    # Client can send "ping" to keep alive
                    if data == "ping":
                        await websocket.send_json({"type": "pong"})
                except WebSocketDisconnect:
                    break
        finally:
            wsm.disconnect(websocket, task_id)

    @app.websocket("/ws/tasks")
    async def ws_all_tasks(websocket: WebSocket):
        """WebSocket endpoint for monitoring all task updates (dashboard)."""
        wsm = get_ws_manager()
        tm = get_task_manager()

        await wsm.connect(websocket)
        try:
            # Send snapshot of all current tasks
            await websocket.send_json({
                "type": "tasks_snapshot",
                "tasks": tm.list_tasks(),
            })
            while True:
                try:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_json({"type": "pong"})
                except WebSocketDisconnect:
                    break
        finally:
            wsm.disconnect(websocket)

    # ── v1.6.4: WebSocket endpoints for Shell Project ──────────────────
    from app.shell_projet_ws import get_projet_ws_manager
    from app.routers.shell_projet import _projects as _projet_registry

    @app.websocket("/ws/projet/{projet_id}")
    async def ws_projet_output(websocket: WebSocket, projet_id: str):
        """WebSocket endpoint for real-time project execution output.

        Connect to this endpoint to receive real-time stdout/stderr
        output as a project's command executes. Also receives status
        changes (creating, running, completed, failed) and archive
        extraction events.

        Messages are JSON objects with a ``type`` field:
        - ``output`` — stdout/stderr data chunk
        - ``status`` — project status change
        - ``command_result`` — final result of command execution
        - ``extract_result`` — archive extraction result
        """
        pws_mgr = get_projet_ws_manager()

        # Check if project exists
        record = _projet_registry.get(projet_id)

        await pws_mgr.connect(websocket, projet_id=projet_id)
        try:
            # Send current project status immediately
            if record:
                import json as _json
                await websocket.send_text(_json.dumps({
                    "type": "status",
                    "projet_id": projet_id,
                    "status": record.status,
                    "workspace": record.workspace_path,
                    "ts": time.time(),
                }))
            else:
                import json as _json
                await websocket.send_text(_json.dumps({
                    "type": "error",
                    "projet_id": projet_id,
                    "message": f"Project '{projet_id}' not found in registry",
                }))

            # Keep connection alive
            while True:
                try:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_json({"type": "pong"})
                except WebSocketDisconnect:
                    break
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("WebSocket error for projet %s: %s", projet_id, exc)
        finally:
            await pws_mgr.disconnect(websocket, projet_id=projet_id)

    @app.websocket("/ws/projet")
    async def ws_all_projets(websocket: WebSocket):
        """WebSocket endpoint for monitoring all project events (dashboard).

        Receives every project event across the system: status changes,
        output chunks, extraction results, and command results.
        """
        pws_mgr = get_projet_ws_manager()

        await pws_mgr.connect(websocket, projet_id=None)
        try:
            # Send snapshot of current projects
            import json as _json
            await websocket.send_text(_json.dumps({
                "type": "projets_snapshot",
                "count": len(_projet_registry),
                "projects": [
                    p.to_workspace_info().model_dump()
                    for p in _projet_registry.values()
                ],
            }))

            while True:
                try:
                    data = await websocket.receive_text()
                    if data == "ping":
                        await websocket.send_json({"type": "pong"})
                except WebSocketDisconnect:
                    break
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("WebSocket error on global projet channel: %s", exc)
        finally:
            await pws_mgr.disconnect(websocket, projet_id=None)

    # v2.3: WebSocket /ws/live for live dashboard updates
    @app.websocket("/ws/live")
    async def ws_live(websocket: WebSocket):
        """WebSocket for real-time dashboard updates (user/key/role events)."""
        from app.routers.live import ws_live_endpoint
        await ws_live_endpoint(websocket)

    # ── Mount WebADC as sub-app (both API + Web on same port 8099) ───────
    # v1.9.3: WebADC panel mounted at /web/ — serves the SPA + API proxy.
    # The standalone webadc-python/main.py is no longer needed on a separate port.
    # When apiadc runs, it serves both the API and the WebADC panel.
    _mount_webadc = (
        os.environ.get("SAMBA_MOUNT_WEBADC", "1").strip().lower() not in ("0", "no", "false", "off")
        and _is_web_enabled()
    )
    if _mount_webadc:
        try:
            # Determine webadc-python location
            _frozen = getattr(_sys, "frozen", False)
            if _frozen:
                _webadc_base = Path(_sys.executable).parent
                _meipass = Path(_sys._MEIPASS)
                # Try _MEIPASS first (bundled data), then exe dir
                _webadc_dir = _meipass / "webadc-python"
                if not _webadc_dir.is_dir():
                    _webadc_dir = _webadc_base / "webadc-python"
            else:
                _webadc_dir = Path(__file__).parent.parent / "webadc-python"

            if _webadc_dir.is_dir():
                _webadc_main = _webadc_dir / "main.py"
                if _webadc_main.is_file():
                    from fastapi.staticfiles import StaticFiles
                    from fastapi.responses import FileResponse, HTMLResponse as _HTMLResp
                    import asyncio as _asyncio
                    import httpx as _httpx

                    _webadc_static = _webadc_dir / "static"
                    _webadc_index_html = _webadc_static / "index.html"

                    if _webadc_static.is_dir() and _webadc_index_html.is_file():
                        # Load index.html content
                        _webadc_index_content = _webadc_index_html.read_text(encoding="utf-8")

                        # Create a sub-app for WebADC
                        _webadc_app = FastAPI(
                            title="WebADC",
                            docs_url=None, redoc_url=None, openapi_url=None,
                        )

                        # Shared HTTP client for API proxy
                        _webadc_http_client: _httpx.AsyncClient | None = None

                        @_webadc_app.on_event("startup")
                        async def _webadc_startup():
                            nonlocal _webadc_http_client
                            _webadc_http_client = _httpx.AsyncClient(
                                timeout=_httpx.Timeout(60.0, connect=10.0),
                                verify=False,
                            )

                        @_webadc_app.on_event("shutdown")
                        async def _webadc_shutdown():
                            nonlocal _webadc_http_client
                            if _webadc_http_client:
                                await _webadc_http_client.aclose()
                                _webadc_http_client = None

                        # Health endpoint
                        @_webadc_app.get("/api/health")
                        async def webadc_health():
                            return {"status": "ok", "service": "webadc"}

                        # API reverse proxy — forward /web/api/v1/* → API backend
                        _api_port = os.environ.get("SAMBA_API_PORT", "8099")
                        _backend_url = os.environ.get(
                            "SAMBA_API_URL",
                            f"http://127.0.0.1:{_api_port}",
                        ).rstrip("/")
                        if _backend_url.endswith("/api/v1"):
                            _backend_url = _backend_url[:-7]
                        _backend_url = _backend_url.rstrip("/")

                        _TRAILING_SLASH_ENDPOINTS = frozenset({
                            "users", "groups", "computers", "contacts",
                            "ous", "sites", "sites/subnets", "fsmo",
                            "gpo", "service-accounts", "shell", "batch",
                            "shell/projet", "ai/chat",
                        })

                        @_webadc_app.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
                        async def webadc_api_proxy(path: str, request: Request):
                            """Proxy /web/api/v1/* to the API backend."""
                            target_path = f"/api/v1/{path}"
                            after_v1 = path.strip("/")
                            if not target_path.endswith("/") and after_v1 in _TRAILING_SLASH_ENDPOINTS:
                                parts = [p for p in after_v1.split("/") if p]
                                if len(parts) == 1:
                                    target_path += "/"
                            target_url = f"{_backend_url}{target_path}"
                            if request.url.query:
                                target_url += f"?{request.url.query}"
                            headers = {}
                            for hdr in ("authorization", "x-api-key", "content-type", "accept"):
                                val = request.headers.get(hdr)
                                if val:
                                    headers[hdr] = val
                            client_ip = request.client.host if request.client else ""
                            headers["X-Forwarded-For"] = client_ip
                            headers["X-Forwarded-Host"] = request.headers.get("host", "")
                            headers["X-Real-IP"] = client_ip
                            body = await request.body()
                            try:
                                accept = request.headers.get("accept", "")
                                if "text/event-stream" in accept and _webadc_http_client:
                                    from starlette.responses import StreamingResponse as _SR
                                    async def stream_resp():
                                        async with _webadc_http_client.stream(
                                            method=request.method, url=target_url,
                                            headers=headers, content=body if body else None,
                                        ) as resp:
                                            async for chunk in resp.aiter_bytes():
                                                yield chunk
                                    return _SR(stream_resp(), status_code=200,
                                               media_type="text/event-stream",
                                               headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
                                if _webadc_http_client:
                                    resp = await _webadc_http_client.request(
                                        method=request.method, url=target_url,
                                        headers=headers, content=body if body else None,
                                    )
                                    resp_headers = {}
                                    for key, val in resp.headers.items():
                                        if key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                                            resp_headers[key] = val
                                    return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)
                                return JSONResponse(status_code=503, content={"status": "error", "detail": "WebADC proxy not ready"})
                            except _httpx.ConnectError:
                                return JSONResponse(status_code=502, content={"status": "error", "detail": f"Cannot connect to API backend at {_backend_url}"})
                            except _httpx.TimeoutException:
                                return JSONResponse(status_code=504, content={"status": "error", "detail": f"Backend API timeout: {_backend_url}"})
                            except Exception as e:
                                return JSONResponse(status_code=500, content={"status": "error", "detail": f"Proxy error: {e}"})

                        # Mount static files under /web/static/
                        _webadc_app.mount("/static", StaticFiles(directory=str(_webadc_static)), name="webadc_static")

                        # SPA fallback — must be last route in sub-app
                        @_webadc_app.get("/{full_path:path}")
                        async def webadc_spa_fallback(full_path: str):
                            if not full_path:
                                return _HTMLResp(content=_webadc_index_content)
                            file_path = _webadc_static / full_path
                            exists = await _asyncio.to_thread(file_path.is_file)
                            if exists:
                                if "_next/static/" in full_path or "_next/image" in full_path:
                                    return FileResponse(file_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
                                return FileResponse(file_path, headers={"Cache-Control": "no-store, must-revalidate"})
                            return _HTMLResp(content=_webadc_index_content, headers={"Cache-Control": "no-store, must-revalidate"})

                        # Mount WebADC sub-app under /web
                        app.mount("/web", _webadc_app)
                        logger.info("WebADC panel mounted at /web/ (static: %s)", _webadc_static)
                    else:
                        logger.info("WebADC static dir not found, WebADC panel not mounted (static=%s)", _webadc_static)
                else:
                    logger.info("WebADC main.py not found, WebADC panel not mounted (path=%s)", _webadc_main)
            else:
                logger.info("WebADC dir not found, WebADC panel not mounted (path=%s)", _webadc_dir)
        except Exception as exc:
            logger.warning("Failed to mount WebADC panel: %s", exc)

    # ── v1.9.3: WebADC SPA — serve static files at root / ────────────
    # This MUST be the last route registered so that API routes (/api/v1/...),
    # health checks (/health), WebSocket (/ws/), etc. take precedence.
    # The catch-all serves files from webadc-python/static/ and falls back
    # to index.html for SPA client-side routing.

    # Resolve static directory: in PyInstaller bundle it's in _MEIPASS,
    # in source mode it's next to the project root.
    _webadc_static_dir: Path | None = None
    for _base in ([Path(_sys._MEIPASS)] if getattr(_sys, 'frozen', False) else [Path(__file__).parent.parent, Path(__file__).parent]):
        _candidate = _base / "webadc-python" / "static"
        if _candidate.is_dir():
            _webadc_static_dir = _candidate
            break

    _webadc_index_html: str | None = None
    if _webadc_static_dir:
        _idx = _webadc_static_dir / "index.html"
        if _idx.is_file():
            _webadc_index_html = _idx.read_text(encoding="utf-8")
            logger.info("WebADC SPA mounted at / — static dir: %s", _webadc_static_dir)

    if _webadc_static_dir and _webadc_index_html and _is_web_enabled():
        @app.get("/{full_path:path}", tags=["webadc"], include_in_schema=False)
        async def webadc_spa(full_path: str):
            """Serve WebADC SPA static files, fallback to index.html."""
            if not full_path:
                return HTMLResponse(content=_webadc_index_html)

            file_path = _webadc_static_dir / full_path

            # Try to serve exact file
            exists = await _asyncio.to_thread(file_path.is_file)
            if exists:
                if "_next/static/" in full_path or "_next/image" in full_path:
                    return FileResponse(file_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
                return FileResponse(file_path, headers={"Cache-Control": "no-store, must-revalidate"})

            # SPA fallback — return index.html for client-side routing
            return HTMLResponse(
                content=_webadc_index_html,
                headers={"Cache-Control": "no-store, must-revalidate"},
            )

        # Backward-compatible health check for WebADC
        @app.get("/web/api/health", tags=["webadc"], include_in_schema=False)
        async def webadc_health():
            return {"status": "ok", "service": "webadc"}
    elif not _is_web_enabled():
        # v2.0.4: Web panel disabled — register 404 catch-all
        logger.info("[WEB] Web panel is DISABLED (WEB_ENABLED=false) — all non-API paths return 404")

        @app.get("/{full_path:path}", tags=["webadc"], include_in_schema=False)
        async def web_disabled_catchall(full_path: str):
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "detail": "Web panel is disabled. Set WEB_ENABLED=true in .env to enable.",
                    "error_code": "WEB_DISABLED",
                },
            )
    else:
        logger.warning("WebADC static files not found — SPA not available at /")

    return app


# ── Module-level app instance ──────────────────────────────────────────
app = create_app()
