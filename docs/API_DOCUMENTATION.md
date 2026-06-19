# Samba AD DC Management API — Complete Documentation

> **Version:** pr-a.1.3 (api_v2.8 baseline)
> **Server file:** `app/main.py` (`FastAPI(version="pr-a.1.2")`)
> **Base URL:** `https://<host>:<port>` (HTTPS by default — see [Transport (HTTP/HTTPS)](#transport--httphttps) below)
> **Default port:** `8099`
> **Total endpoints:** 382 (174 GET, 139 POST, 23 PUT, 37 DELETE, 2 PATCH, 7 WebSocket)

## Table of Contents

1. [Overview](#overview)
2. [Transport (HTTP/HTTPS)](#transport--httphttps)
3. [Authentication](#authentication)
4. [Authorization & Permissions](#authorization--permissions)
5. [Rate Limiting](#rate-limiting)
6. [Caching](#caching)
7. [Pagination](#pagination)
8. [Error Handling](#error-handling)
9. [WebSocket Real-Time Notifications](#websocket-real-time-notifications)
10. [Configuration (Environment Variables)](#configuration)
11. [System Endpoints](#system-endpoints)
12. [Authentication Endpoints](#authentication-endpoints)
13. [2FA / TOTP](#2fa--totp)
14. [User Management](#user-management)
15. [User Extended Management](#user-extended-management)
16. [Group Management](#group-management)
17. [Computer Management](#computer-management)
18. [Contact Management](#contact-management)
19. [Organizational Unit Management](#organizational-unit-management)
20. [OU Extended Management](#ou-extended-management)
21. [Domain Management](#domain-management)
22. [DNS Management](#dns-management)
23. [Group Policy (GPO) Management](#group-policy-gpo-management)
24. [FSMO Roles](#fsmo-roles)
25. [DRS Replication](#drs-replication)
26. [Sites & Subnets](#sites--subnets)
27. [Schema](#schema)
28. [Delegation](#delegation)
29. [Service Accounts](#service-accounts)
30. [Authentication Policies & Silos](#authentication-policies--silos)
31. [Miscellaneous Operations](#miscellaneous-operations)
32. [Shell Execution](#shell-execution)
33. [Shell Project](#shell-project)
34. [Batch Operations](#batch-operations)
35. [AI Assistant](#ai-assistant)
36. [Chat (REST + WebSocket)](#chat-rest--websocket)
37. [Management API (Admin Panel)](#management-api-admin-panel)
38. [Ban Management](#ban-management)
39. [Webhooks](#webhooks)
40. [Backup](#backup)
41. [Dashboard & Charts](#dashboard--charts)
42. [SDB (Samba Database Query)](#sdb-samba-database-query)
43. [Report Generation](#report-generation)
44. [Runtime Configuration (CFG)](#runtime-configuration-cfg)
45. [Live Events (SSE)](#live-events-sse)
46. [Audit Export](#audit-export)
47. [Task Management](#task-management)
48. [Data Models Reference](#data-models-reference)
49. [Permissions Reference](#permissions-reference)

---

## Overview

The Samba AD DC Management API (codename **WebADC / apiadc**) is a RESTful web service that provides comprehensive administration capabilities for Samba Active Directory Domain Controllers via `samba-tool`, direct `ldbsearch` / SamDB API calls, and PostgreSQL-backed management tables. It exposes **382 endpoints** across **41 routers** covering every aspect of AD management: users, groups, computers, contacts, OUs, DNS, GPO, DRS replication, FSMO roles, schema, delegation, service accounts, authentication policies, AI assistant with agent tool calls, persistent chat with file attachments and audio calls, shell project workspaces, batch operations, real-time WebSocket/SSE notifications, webhooks, audit log export, and more.

### Key Features

- **Dual Authentication**: Supports both static / DB-backed API keys (`X-API-Key` header) and JWT Bearer tokens (`Authorization: Bearer <token>`)
- **HTTPS by default**: TLS termination is built into uvicorn via `SAMBA_SSL_CERTFILE` / `SAMBA_SSL_KEYFILE` — no reverse proxy required
- **Fast Read Path**: Read endpoints use `ldbsearch` (direct LDB/TDB access) instead of `samba-tool` for 10–100× faster queries (`/full` and `/overview` endpoints)
- **Direct SamDB Writes**: Write operations attempt direct SamDB API calls first (fast path ~1–2s), falling back to `samba-tool` subprocess
- **Granular RBAC**: 150+ individual permissions organized by resource category, with 3 built-in roles (`admin`, `operator`, `auditor`) and custom role support
- **Rate Limiting**: Per-IP and per-user sliding window rate limits for auth, read, write, and shell-project endpoints
- **Response Caching**: Configurable TTL-based response cache with automatic invalidation on write operations
- **Background Tasks**: Long-running operations (backup, GPO restore, dbcheck, etc.) run as background tasks with polling and WebSocket notifications
- **Batch Operations**: Execute multi-step sequential operations with template resolution and rollback support
- **Shell Project**: Workspace-based command execution environment with archive upload, scheduling, snapshots, audit log, templates, and webhook callbacks
- **AI Assistant**: Polza.ai-powered AI for natural language task building and direct API execution via agent tool calls, with persistent chat sessions, SSE streaming, and pipeline templates
- **Chat System**: Real-time chat with rooms, members, file attachments, voice messages, audio calls, reactions, stars, pins, scheduled messages, and full-text search
- **2FA / TOTP**: Optional two-factor authentication with admin override and self-service setup
- **Ban System**: Per-user and per-API-key bans with reasons, expiry, and history
- **Webhooks**: Outbound webhook delivery for auth events, user lifecycle, and other system events
- **Audit Export**: Export full audit log to CSV or XLSX
- **Prometheus Metrics**: Built-in lightweight HTTP metrics (request counts, duration histograms) without external dependencies
- **Structured Logging**: JSON or standard log format with request ID tracking
- **Audit Trail**: Full action audit logging via PostgreSQL management database

### Recent changelog (highlights)

- **pr-a.1.2** — Current production build. WebADC SPA mounted at `/` on the same port as the API (no separate web service). HTTPS enabled by default. AI Agent with shell execution and Polza.ai integration. Chat REST + WebSocket with calls. 2FA + admin 2FA endpoints. Ban system.
- **v2.8** — Batch operations with rollback, granular per-permission RBAC inside JWT tokens
- **v2.7** — JWT auth, rate limiting, caching, pagination, WebSocket, Prometheus metrics, structured logging, CSV import/export, OU tree, system stats, user/API-key management
- **v2.4** — Chat REST + WebSocket, file attachments, voice messages
- **v2.3** — 2FA / TOTP, webhooks, SSE live events, shell WebSocket, audit enrichment
- **v2.0.4** — `WEB_ENABLED=false` enforcement middleware (defense-in-depth)
- **v2.0.1** — WebADC SPA at root `/`, combined auth middleware
- **v1.6.7** — Shell Project: scheduling, snapshots, audit log, templates, owner transfer, tags
- **v1.6.4** — Shell Project workspace
- **v1.6.8-1** — AI Assistant
- **v1.4.3** — Shell execution router
- **v1.2.7_ban** — Ban system (mgmt_bans table)
- **v1.2.1_fix** — Fast ldbsearch-based `/full` and `/dashboard` endpoints

---

## Transport (HTTP/HTTPS)

The server supports both HTTP and HTTPS. The mode is selected automatically by `run.sh` based on the `SAMBA_SSL_CERTFILE` and `SAMBA_SSL_KEYFILE` environment variables. **Production deployments use HTTPS.**

### HTTPS configuration (default in shipped `.env`)

```bash
# /etc/webadc/.env  (or local .env)
SAMBA_SSL_CERTFILE=/etc/pki/tls/certs/apiadc.crt
SAMBA_SSL_KEYFILE=/etc/pki/tls/private/apiadc.key
# SAMBA_SSL_KEYFILE_PASSWORD=           # only for encrypted keys
# SAMBA_SSL_CA_CERTS=/etc/pki/tls/certs/ca-bundle.crt
# SAMBA_SSL_VERSION=                    # blank = uvicorn default (TLSv1.2+)
```

When both files exist and are readable, `run.sh` launches uvicorn with:

```bash
uvicorn app.main:app \
  --host 0.0.0.0 --port 8099 \
  --ssl-certfile /etc/pki/tls/certs/apiadc.crt \
  --ssl-keyfile  /etc/pki/tls/private/apiadc.key
```

### Plain HTTP mode

If `SAMBA_SSL_CERTFILE` / `SAMBA_SSL_KEYFILE` are **not set** (or empty), `run.sh` starts uvicorn without `--ssl-*` flags — the server then serves plain HTTP. This is intended for local development only.

### All curl examples in this document use HTTPS

```bash
# Health (no auth)
curl -k https://127.0.0.1:8099/health

# API request
curl -k -H "X-API-Key: YOUR_KEY" https://127.0.0.1:8099/api/v1/users/
```

> Use `-k` (or `--insecure`) for self-signed certificates. For production, install the CA bundle on the client and drop `-k`.

### Swagger UI / ReDoc

Both are served by the same uvicorn process, so they are accessible over HTTPS:

- **Swagger UI:** `https://127.0.0.1:8099/docs`
- **ReDoc:** `https://127.0.0.1:8099/redoc`
- **OpenAPI JSON:** `https://127.0.0.1:8099/openapi.json`

### WebADC web panel

The web panel (Next.js SPA) is served at the **root** `/` on the same port as the API. There is also a `/web/` mount that exposes a reverse proxy sub-app (`/web/api/v1/*` → backend API). Both are available over HTTPS when SSL is enabled.

```
https://127.0.0.1:8099/                  # WebADC SPA
https://127.0.0.1:8099/web/              # WebADC sub-app (reverse proxy)
https://127.0.0.1:8099/web/api/health    # WebADC health
https://127.0.0.1:8099/web/api/v1/users/ # Proxied API call
```

Set `WEB_ENABLED=false` in `.env` to disable the web panel entirely (only the API keeps working — all non-API paths return 404).

---

## Authentication

All endpoints (except public paths) require authentication. Two methods are supported and may be combined in the same request.

### API Key Authentication

Include the `X-API-Key` header with every request:

```http
GET /api/v1/users/ HTTP/1.1
Host: 127.0.0.1:8099
X-API-Key: your-api-key-here
```

API keys are validated against (in order):

1. **Management Database** (`mgmt_users` + `mgmt_api_keys` tables, PostgreSQL) — keys created via `POST /api/v1/mgmt/keys`, with associated roles, permissions, expiry, and disable flags
2. **Static API Key** — the `SAMBA_API_KEY` environment variable (always has `admin` role, cannot be banned)

### JWT Bearer Authentication

First obtain tokens via login, then include the access token:

```http
POST /api/v1/auth/login HTTP/1.1
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

Response (no 2FA enabled):

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 1800,
  "role": "admin",
  "permissions": ["user.create", "user.list", "..."]
}
```

Then use the access token:

```http
GET /api/v1/users/ HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

If 2FA is enabled for the user, the login response is `200` with `{ "totp_required": true, "temp_token": "...", "expires_in": 300 }` and you must complete step 2 via `POST /api/v1/auth/login/verify`. See [2FA / TOTP](#2fa--totp).

### Public Endpoints (No Authentication Required)

| Path | Description |
|------|-------------|
| `GET /` | WebADC SPA entry point |
| `GET /health` | Basic health check |
| `GET /health/detailed` | Detailed health check |
| `GET /metrics` | Prometheus metrics |
| `GET /docs` | Swagger UI |
| `GET /openapi.json` | OpenAPI schema |
| `GET /redoc` | ReDoc documentation |
| `GET /web/api/health` | WebADC panel health |
| `POST /api/v1/auth/login` | JWT login (step 1) |
| `POST /api/v1/auth/refresh` | JWT token refresh |
| `POST /api/v1/auth/check` | Credential verification (any of 3 methods) |
| `POST /api/v1/auth/login/verify` | 2FA login step 2 (temp_token + TOTP code) |
| `GET /api/v1/auth/test` | Full credential diagnostic (always 200) |
| `/_next/*`, `/locales/*`, `/favicon*`, `/robots.txt` | WebADC static assets |
| `/ws/*` | WebSocket endpoints (auth handled per-endpoint) |

### Disabled account / key handling

The auth middleware detects the following conditions and returns a clear error code in the response body:

| Condition | HTTP | `code` | Message |
|-----------|------|--------|---------|
| User account disabled | 403 | `ACCOUNT_DISABLED` | Account 'X' is disabled |
| API key deactivated | 403 | `KEY_DISABLED` | This API key is deactivated |
| Role disabled | 403 | `ROLE_DISABLED` | Role 'X' is disabled |
| API key expired | 401 | `KEY_EXPIRED` | This API key has expired |
| User banned | 403 | — | User 'X' is banned: <reason> (<expiry>) |
| API key banned | 403 | — | API key 'XXX…' is banned |
| Invalid API key | 401 | `INVALID_API_KEY` | Invalid API key |
| Invalid/expired JWT | 401 | `INVALID_JWT` | Invalid or expired JWT token |
| No authentication provided | 401 | `AUTH_REQUIRED` | Missing authentication |

---

## Authorization & Permissions

The API implements granular role-based access control (RBAC) with 150+ individual permissions.

### Built-in Roles

| Role | Description | Access Level |
|------|-------------|-------------|
| `admin` | Full system access | All permissions, including ban.* and 2FA admin endpoints |
| `operator` | Read-mostly operations | All read permissions + most write operations |
| `auditor` | Read + audit log access | Read permissions + `mgmt.audit.view` |

### Permission Format

Permissions follow the `resource.action` format, for example:

- `user.create` — Create user accounts
- `group.list` — List groups
- `dns.recordcreate` — Create DNS records
- `mgmt.users.create` — Create management users
- `shell.execute` — Execute shell commands
- `ban.create` — Create a ban (admin only)
- `chat.room.create` — Create a chat room
- `ai.agent.execute` — Run the AI agent

Custom roles can be created and assigned any combination of permissions via `POST /api/v1/mgmt/roles` and `POST /api/v1/mgmt/permissions/assign`.

### Permission Enforcement

1. The combined auth middleware validates authentication (API key or JWT).
2. The role is extracted from the JWT payload or API key metadata.
3. `has_permission(role, method, path)` checks the role's permissions against the required permission resolved from the request method + path (`app.permissions.resolve_permission`).
4. If the role lacks the required permission, HTTP 403 is returned with the missing permission name in the message: `Role 'X' does not have permission for POST /api/v1/users/ (requires: user.create)`.
5. If a JWT user or API key owner is currently banned (per `mgmt_bans` table), HTTP 403 is returned with the ban reason and expiry.

---

## Rate Limiting

Rate limits are enforced via in-memory sliding window counters. The middleware is registered in `app/main.py` (`RateLimitMiddleware`).

| Endpoint Group | Default Limit | Scope | Environment Variable |
|---------------|--------------|-------|---------------------|
| Auth (`/api/v1/auth/*`) | 10 req/min | Per IP | `SAMBA_RATE_LIMIT_AUTH_PER_MIN` |
| Shell Project (`/api/v1/shell/projet/*`) | 120 req/min | Per user | `SAMBA_RATE_LIMIT_SHELL_PROJET_PER_MIN` |
| Read (GET) | 100 req/min | Per user | `SAMBA_RATE_LIMIT_READ_PER_MIN` |
| Write (POST/PUT/DELETE/PATCH) | 30 req/min | Per user | `SAMBA_RATE_LIMIT_WRITE_PER_MIN` |
| Per-user override (0 = disabled) | 0 req/min | Per user | `SAMBA_RATE_LIMIT_PER_USER_PER_MIN` |
| Window size | 60 s | — | `SAMBA_RATE_LIMIT_WINDOW_SECONDS` |
| Enable/disable | `true` | — | `SAMBA_RATE_LIMIT_ENABLED` |

When rate limited, the API returns HTTP 429 with a `Retry-After` header. 429 responses are **not** counted toward the rate counter.

Exempt paths: `/health`, `/health/detailed`, `/metrics`, `/docs`, `/openapi.json`, `/redoc`, `/web/api/health`, `OPTIONS` requests.

---

## Caching

The API uses an in-memory TTL-based response cache (`app.cache`):

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Cache enabled | `false` (production) | `SAMBA_CACHE_ENABLED` |
| Cache TTL | 0 s (disabled) | `SAMBA_CACHE_TTL` |
| Cache max size | 512 entries | `SAMBA_CACHE_MAX_SIZE` |

On every write operation (POST/PUT/DELETE/PATCH), the `cache_middleware` calls `cache.invalidate_for_write(path)` and also invalidates the `ldb_reader` internal cache so subsequent `/full` reads return fresh data.

---

## Pagination

List endpoints support standard offset/limit pagination:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | 100 | Max items per page (capped per endpoint) |
| `offset` | 0 | Skip first N items |
| `search` | — | Substring filter (where supported) |
| `sort` | — | Sort field (where supported) |

Responses are wrapped in:

```json
{
  "status": "ok",
  "total": 1234,
  "limit": 100,
  "offset": 0,
  "items": [ ... ]
}
```

---

## Error Handling

All errors return a standardised JSON envelope:

```json
{
  "status": "error",
  "message": "описание ошибки",
  "details": "дополнительная информация (опционально)"
}
```

HTTP status codes:

| Code | Meaning |
|------|---------|
| 400 | Bad request — invalid input, validation error |
| 401 | Authentication missing or invalid |
| 403 | Authenticated but not authorised (RBAC / ban / disabled) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, dependency, locked) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 502 | Bad gateway (WebADC reverse proxy cannot reach backend) |
| 503 | Service unavailable (DB pool failure, dependency not initialised) |
| 504 | Timeout (samba-tool, RPC, or DRS device timeout) |
| 507 | Insufficient storage |

Custom exception handlers are registered for `SambaToolError`, `RuntimeError`, `TimeoutError`, `ValueError`, and a generic `Exception` catch-all. The classifier `classify_samba_error()` maps common samba-tool error patterns to the most appropriate HTTP code (e.g. `STATUS_OBJECT_NAME_NOT_FOUND` → 404, `STATUS_DEVICE_TIMEOUT` → 504, `STATUS_ACCESS_DENIED` → 403).

---

## WebSocket Real-Time Notifications

The server exposes 7 WebSocket endpoints for real-time updates. All accept text `ping` messages and respond with `{"type": "pong"}` to keep the connection alive. Auth is **not** required at the WS upgrade (auth is per-event for tasks/projets; chat requires the user to be a room member).

| Endpoint | Description |
|----------|-------------|
| `wss://host:8099/ws/tasks/{task_id}` | Status updates for a single background task |
| `wss://host:8099/ws/tasks` | All task updates (dashboard) |
| `wss://host:8099/ws/projet/{projet_id}` | Real-time stdout/stderr/status for a shell project execution |
| `wss://host:8099/ws/projet` | All project events (dashboard) |
| `wss://host:8099/ws/live` | Real-time user/key/role events for the management dashboard |
| `wss://host:8099/ws/shell` | Real-time shell command execution (stdin/stdout/stderr streaming) |
| `wss://host:8099/ws/chat/{room_id}` | Real-time chat in a specific room (messages, reactions, edits, typing, calls) |

> When SSL is enabled, use `wss://`. When plain HTTP, use `ws://`.

---

## Configuration

All configuration is read from environment variables (loaded from `.env` via pydantic-settings). The settings model is in `app/config.py`. Hot-reload is supported at runtime via the `/api/v1/cfg/*` endpoints (see [Runtime Configuration (CFG)](#runtime-configuration-cfg)).

### Core server

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_API_KEY` | (required) | Static bootstrap admin API key (always `admin` role, cannot be banned) |
| `SAMBA_API_HOST` | `127.0.0.1` | Bind address (production: `0.0.0.0`) |
| `SAMBA_API_PORT` | `8099` | Listen port |
| `TMPDIR` | `/var/tmp` | Temp dir for samba-tool |
| `WEB_ENABLED` | `true` | Serve the WebADC SPA at `/` |
| `WEB_STATIC_DIR` | `out` | Static asset directory for the SPA |

### SSL / HTTPS

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_SSL_CERTFILE` | (empty) | Path to TLS certificate (PEM). When set + key set → HTTPS |
| `SAMBA_SSL_KEYFILE` | (empty) | Path to TLS private key (PEM) |
| `SAMBA_SSL_KEYFILE_PASSWORD` | (empty) | Password for encrypted private key |
| `SAMBA_SSL_CA_CERTS` | (empty) | CA bundle path (for client cert verification) |
| `SAMBA_SSL_VERSION` | (empty) | SSL/TLS version override |

### Samba

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_SERVER` | `localhost` | AD DC hostname (e.g. `dc1.almaz.local`) |
| `SAMBA_TOOL_PATH` | `samba-tool` | Path to `samba-tool` binary |
| `SAMBA_LDBSEARCH_PATH` | `ldbsearch` | Path to `ldbsearch` binary (fast reads) |
| `SAMBA_SMB_CONF` | `/etc/samba/smb.conf` | Path to `smb.conf` |
| `SAMBA_WORKER_POOL_SIZE` | `4` | `ProcessPoolExecutor` size for samba-tool |
| `SAMBA_JSON_MODE` | `auto` | `auto` / `force_json` / `force_output_format` / `text` |
| `SAMBA_CREDENTIALS_USER` | (empty) | Remote admin username |
| `SAMBA_CREDENTIALS_PASSWORD` | (empty) | Remote admin password |
| `SAMBA_USE_KERBEROS` | `false` | Use Kerberos instead of password |
| `SAMBA_USE_SUDO` | `auto` | `auto` / `true` / `false` — wrap samba-tool in sudo |
| `SAMBA_LDAP_URL` | (empty) | LDAP URL for remote access |
| `SAMBA_LDAPI_URL` | (empty) | LDAPI unix-socket URL |
| `SAMBA_TDB_URL` | (empty) | TDB URL |
| `SAMBA_TDB_SAM_LDB_PATH` | (empty) | Direct path to `sam.ldb` |
| `SAMBA_DOMAIN_DN` | (empty) | Domain DN (auto-detected if empty) |
| `SAMBA_DC_HOSTNAME` | (empty) | DC hostname override |
| `SAMBA_REALM` | (empty) | Kerberos realm |

### JWT / Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_JWT_SECRET_KEY` | (auto) | JWT signing secret (auto-generated if empty) |
| `SAMBA_JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `SAMBA_JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access token TTL |
| `SAMBA_JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token TTL |

### CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_CORS_ORIGINS` | (empty = `*`) | Comma-separated allowed origins |

### Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_RATE_LIMIT_ENABLED` | `true` | Master toggle |
| `SAMBA_RATE_LIMIT_AUTH_PER_MIN` | `10` | Auth requests per minute per IP |
| `SAMBA_RATE_LIMIT_READ_PER_MIN` | `100` | GET requests per minute per user |
| `SAMBA_RATE_LIMIT_WRITE_PER_MIN` | `30` | Write requests per minute per user |
| `SAMBA_RATE_LIMIT_SHELL_PROJET_PER_MIN` | `120` | Shell-project requests per minute |
| `SAMBA_RATE_LIMIT_WINDOW_SECONDS` | `60` | Sliding window size |
| `SAMBA_RATE_LIMIT_PER_USER_PER_MIN` | `0` | Per-user global cap (0 = disabled) |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_CACHE_ENABLED` | `false` | Enable response cache |
| `SAMBA_CACHE_TTL` | `0` | Default TTL in seconds |
| `SAMBA_CACHE_MAX_SIZE` | `512` | Max cached entries |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `SAMBA_LOG_FORMAT` | `standard` | `standard` or `json` |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_MGMT_DB_PATH` | `/var/lib/samba/api_mgmt.db` | Legacy SQLite path (currently unused — PostgreSQL is used) |
| `SAMBA_SHELL_PROJET_PG_HOST` | `localhost` | PostgreSQL host |
| `SAMBA_SHELL_PROJET_PG_PORT` | `5432` | PostgreSQL port |
| `SAMBA_SHELL_PROJET_PG_DBNAME` | `samba_api` | Database name |
| `SAMBA_SHELL_PROJET_PG_USER` | `samba_api` | Database user |
| `SAMBA_SHELL_PROJET_PG_PASSWORD` | (empty) | Database password |
| `SAMBA_SHELL_PROJET_PG_DSN` | (empty) | Override DSN (takes precedence over the above) |
| `SAMBA_SHELL_PROJET_PG_POOL_MIN` | `2` | Min pool size |
| `SAMBA_SHELL_PROJET_PG_POOL_MAX` | `10` | Max pool size |

### Shell

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_SHELL_ENABLED` | `true` | Enable shell execution endpoints |
| `SAMBA_SHELL_SUDO_PASSWORD` | (empty) | Sudo password for elevated shell commands |
| `SAMBA_SHELL_MAX_TIMEOUT` | `600` | Max command timeout (seconds) |
| `SAMBA_SHELL_BLOCKED_COMMANDS` | `rm -rf /,mkfs.,dd if=,...` | Blocked command patterns |

### Shell Project

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_SHELL_PROJET_BASE_DIR` | `/home/AD-API-USER` | Base directory for project workspaces |
| `SAMBA_SHELL_PROJET_MAX_PROJECTS` | `100` | Max projects per system |
| `SAMBA_SHELL_PROJET_MAX_ARCHIVE_SIZE` | `500` | Max upload size (MB) |
| `SAMBA_SHELL_PROJET_ALLOWED_ARCHIVE_TYPES` | `.zip,.tar.gz,...` | Allowed archive extensions |
| `SAMBA_SHELL_PROJET_POOL_SIZE` | `8` | Concurrent project execution pool |
| `SAMBA_SHELL_PROJET_DEFAULT_TIMEOUT` | `300` | Default per-command timeout (s) |
| `SAMBA_SHELL_PROJET_OWNER_DEFAULT` | `api-user` | Default project owner |
| `SAMBA_SHELL_PROJET_MAX_OUTPUT_SIZE` | `5242880` | Max stdout+stderr size (bytes) |
| `SAMBA_SHELL_PROJET_MAX_WORKSPACE_SIZE` | `500` | Max workspace size (MB) |
| `SAMBA_SHELL_PROJET_TTL_CLEANUP_INTERVAL` | `30` | TTL cleanup interval (minutes) |
| `SAMBA_SHELL_PROJET_CALLBACK_MAX_RETRIES` | `3` | Webhook callback retry count |
| `SAMBA_SHELL_PROJET_ENCRYPTION_KEY` | (empty) | At-rest encryption key |
| `SAMBA_SHELL_PROJET_SHARED_VOLUMES_DIR` | `/home/AD-API-USER/_shared` | Shared volumes directory |

### AI Assistant

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_AI_API_BASE` | (empty) | MUST be empty (in-memory openapi is used; self-reference causes loops) |
| `SAMBA_AI_DEFAULT_MODEL` | `deepseek/deepseek-v4-flash` | Default model |
| `SAMBA_AI_TEMPERATURE` | `0.7` | Sampling temperature |
| `SAMBA_AI_MAX_TOKENS` | `64000` | Max output tokens (auto-clamped to 16384 by config.py) |
| `SAMBA_AI_RATE_LIMIT_RETRIES` | `3` | Provider 429 retries |
| `SAMBA_AI_RATE_LIMIT_MAX_WAIT` | `30` | Max wait between retries (s) |
| `SAMBA_AI_FALLBACK_MODELS` | `z-ai/glm-4.7-flash,...` | Comma-separated fallback model list |
| `SAMBA_AI_MAX_SCHEMA_CHARS` | `120000` | Max OpenAPI schema size sent to AI |
| `SAMBA_AI_AGENT_MAX_STEPS` | `60` | Max agent steps |
| `SAMBA_AI_AGENT_EXPORT_DIR` | `/home/AD-API-USER/ai-exports` | AI export dir |
| `SAMBA_AI_AGENT_SHELL_ENABLED` | `true` | Allow agent to execute shell |
| `SAMBA_AI_AGENT_SHELL_TIMEOUT` | `30` | Agent shell timeout (s) |
| `SAMBA_AI_AGENT_SHELL_BLOCKED_CMDS` | `rm -rf /,...` | Blocked commands for agent |
| `SAMBA_AI_AGENT_API_TIMEOUT` | `60` | Agent API call timeout (s) |
| `SAMBA_AI_AGENT_MAX_MENU_CHARS` | `80000` | Max menu chars |
| `SAMBA_AI_DEBUG` | `false` | Verbose AI debug logging |
| `SAMBA_AI_DEBUG_MAX_CONTENT` | `3000` | Truncate debug content at N chars |
| `SAMBA_AI_CHAT_ENABLED` | `true` | Enable AI chat sessions |
| `SAMBA_AI_CHAT_MAX_HISTORY` | `100` | Max messages per session |
| `SAMBA_AI_CHAT_MAX_PER_USER` | `100` | Max sessions per user |
| `SAMBA_AI_MASK_ENABLED` | `true` | Mask PII before sending to AI |
| `SAMBA_AI_MASK_FIELDS` | (empty) | Additional fields to mask |
| `SAMBA_AI_MASK_RANGE_NOTATION` | `true` | Mask IP ranges like `192.168.1.0/24` |
| `SAMBA_AI_PERMISSION_MODE` | `true` | Enforce RBAC on AI agent actions |
| `SAMBA_AI_SKILLS_DIR` | `SKILL` | AI skills directory |
| `SAMBA_AI_SKILLS_ENABLED` | `true` | Enable AI skills |

### AI — Polza.ai provider

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_POLZA_AI_URL` | `https://polza.ai/api/v1` | Polza.ai API base URL |
| `SAMBA_POLZA_AI_KEY` | (empty) | Polza.ai API key |
| `SAMBA_POLZA_AI_MODEL` | `deepseek/deepseek-v4-flash` | Polza.ai model |
| `SAMBA_POLZA_AI_PROVIDER_ONLY` | (empty) | Restrict to specific providers |
| `SAMBA_POLZA_AI_PROVIDER_ORDER` | (empty) | Provider ordering |
| `SAMBA_POLZA_AI_PROVIDER_IGNORE` | (empty) | Providers to ignore |
| `SAMBA_POLZA_AI_PROVIDER_ALLOW_FALLBACKS` | `true` | Allow provider fallbacks |
| `SAMBA_POLZA_AI_PROVIDER_SORT` | (empty) | Provider sort strategy |
| `SAMBA_POLZA_AI_PROVIDER_MAX_PRICE_PROMPT` | `50` | Max price per prompt token |
| `SAMBA_POLZA_AI_PROVIDER_MAX_PRICE_COMPLETION` | `0` | Max price per completion token (0 = unlimited) |
| `SAMBA_POLZA_AI_REASONING_EFFORT` | `medium` | Reasoning effort |
| `SAMBA_POLZA_AI_REASONING_SUMMARY` | (empty) | Reasoning summary level |
| `SAMBA_POLZA_AI_REASONING_ENABLED` | `true` | Enable reasoning |
| `SAMBA_POLZA_AI_REASONING_MAX_TOKENS` | `0` | Max reasoning tokens (0 = unlimited) |
| `SAMBA_POLZA_AI_REASONING_EXCLUDE` | `false` | Exclude reasoning from response |
| `SAMBA_POLZA_AI_TOP_K` | `50` | Top-K sampling |
| `SAMBA_POLZA_AI_REPETITION_PENALTY` | `1` | Repetition penalty |
| `SAMBA_POLZA_AI_TOP_P` | `0.7` | Top-P sampling |
| `SAMBA_POLZA_AI_FREQUENCY_PENALTY` | `0` | Frequency penalty |
| `SAMBA_POLZA_AI_PRESENCE_PENALTY` | `0` | Presence penalty |
| `SAMBA_POLZA_AI_SEED` | `0` | Random seed (0 = random) |
| `SAMBA_POLZA_AI_WEB_SEARCH_ENABLED` | `false` | Enable web search |
| `SAMBA_POLZA_AI_WEB_SEARCH_CONTEXT_SIZE` | `medium` | Web search context size |

### Misc

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBA_BACKUP_DIR` | `/var/lib/samba/api-backups` | Backup storage directory |
| `SAMBA_BULK_MAX_ROWS` | `10000` | Max rows for bulk CSV import |
| `SAMBA_ENV_ENCRYPTION_ENABLED` | `true` | Encrypt sensitive .env values at rest |
| `SAMBA_SAMBA_SHARES_CONF` | `/etc/samba/smb.conf` | Samba shares config file |
| `SAMBA_SAMBA_SHARES_DIR` | `/srv/samba/shares` | Samba shares directory |
| `SAMBA_UVICORN_WORKERS` | `1` | Uvicorn worker count |

---

## System Endpoints

All system endpoints are public (no auth required) except `/api/v1/system/stats`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Basic health check. Returns `{"status":"ok","service":"samba-api-server","server_role":"...","version":"pr-a.1.2"}` |
| `GET` | `/health/detailed` | Detailed health check (DB pool, worker pool, cache, samba-tool availability) |
| `GET` | `/metrics` | Prometheus-style metrics (request counts, durations, in-flight) |
| `GET` | `/api/v1/system/stats` | **Auth required.** System + Samba stats combined |

### Examples

```bash
# Health (HTTPS, self-signed cert)
curl -k https://127.0.0.1:8099/health
# {"status":"ok","service":"samba-api-server","server_role":"active directory domain controller","version":"pr-a.1.2"}

# Detailed health
curl -k https://127.0.0.1:8099/health/detailed

# Metrics
curl -k https://127.0.0.1:8099/metrics

# System stats
curl -k -H "X-API-Key: YOUR_KEY" https://127.0.0.1:8099/api/v1/system/stats
```

---

## Authentication Endpoints

All endpoints in this section are public (no auth required to call them — they *verify* auth).

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `POST` | `/api/v1/auth/login` | `LoginRequest{username, password}` | Authenticate with username/password. Returns `TokenResponse` or `{totp_required:true, temp_token, expires_in:300}` when 2FA is enabled. |
| `POST` | `/api/v1/auth/refresh` | `RefreshRequest{refresh_token}` | Refresh an access token. Returns new `TokenResponse`. |
| `GET` | `/api/v1/auth/me` | — | Returns the current user's role, permissions, and expiry. Works with both API key and JWT. |
| `POST` | `/api/v1/auth/check` | `CheckCredentialsRequest?` (optional) | Verify credentials (3 methods supported: X-API-Key / Bearer / body). Returns `MeResponse`. |
| `GET` | `/api/v1/auth/test` | — | Full credential diagnostic. Always returns 200 with `{valid, auth_method, message, code, ...}`. |

### `POST /api/v1/auth/login` — example

```bash
curl -k -X POST https://127.0.0.1:8099/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"P@$$w0rd"}'
```

Response (no 2FA):

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 1800,
  "role": "admin",
  "permissions": ["user.create", "user.list", "..."]
}
```

Response (2FA enabled):

```json
{
  "status": "ok",
  "totp_required": true,
  "temp_token": "tmp_abc123...",
  "expires_in": 300,
  "username": "admin",
  "next_step": "POST /api/v1/auth/login/verify with {temp_token, totp_code}"
}
```

### `GET /api/v1/auth/me` — example

```bash
# With API key
curl -k -H "X-API-Key: YOUR_KEY" https://127.0.0.1:8099/api/v1/auth/me

# With JWT
curl -k -H "Authorization: Bearer eyJ..." https://127.0.0.1:8099/api/v1/auth/me
```

```json
{
  "status": "ok",
  "auth_method": "jwt",
  "username": "admin",
  "role": "admin",
  "permissions": ["user.create", "user.list", "..."],
  "expires_at": "2026-06-19T18:30:00+00:00"
}
```

---

## 2FA / TOTP

Two-factor authentication using TOTP (RFC 6238). Two routers: `twofa.router` (requires auth, for self-service) and `twofa.public_router` (no auth, for login step 2). Admin endpoints are in `twofa_admin.router` (see [Management API](#management-api-admin-panel)).

### Self-service (requires auth)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/2fa/setup` | — | Generate a new TOTP secret + QR code URL |
| `POST` | `/api/v1/auth/2fa/enable` | `TwoFAEnableRequest{totp_code}` | Enable 2FA after verifying a 6-digit code |
| `POST` | `/api/v1/auth/2fa/disable` | `TwoFADisableRequest{password}` | Disable 2FA (requires current password) |
| `GET` | `/api/v1/auth/2fa/status` | — | Check 2FA status for the current user |

### Login step 2 (public)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/login/verify` | `TwoFAVerifyRequest{temp_token, totp_code}` | Verify TOTP code, returns full `TokenResponse` |

### Admin (see also [Management API](#management-api-admin-panel))

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/mgmt/users/{user_id}/2fa/status` | Check 2FA status for any user |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/setup` | Generate a new TOTP secret for any user |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/enable` | Enable 2FA for any user (with code or force) |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/disable` | Disable 2FA for any user (admin override) |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/reset` | Reset 2FA for any user (wipe stored secret) |
| `GET` | `/api/v1/mgmt/2fa/enabled` | List all users with 2FA enabled |
| `GET` | `/api/v1/mgmt/2fa/disabled` | List all users with a stored secret but 2FA disabled |

### Examples

```bash
# Setup 2FA (self-service)
curl -k -X POST -H "Authorization: Bearer eyJ..." \
  https://127.0.0.1:8099/api/v1/auth/2fa/setup
# {"status":"ok","secret":"JBSWY3DPEHPK3PXP","qr_url":"otpauth://totp/..."}

# Enable 2FA after entering the code from authenticator app
curl -k -X POST -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"totp_code":"123456"}' \
  https://127.0.0.1:8099/api/v1/auth/2fa/enable

# Login step 2
curl -k -X POST \
  -H "Content-Type: application/json" \
  -d '{"temp_token":"tmp_abc123...","totp_code":"123456"}' \
  https://127.0.0.1:8099/api/v1/auth/login/verify
```

---

## User Management

Router: `app/routers/user.py` — prefix `/api/v1/users`. Tag: `Users`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/users/` | `?limit&offset&search` | List users |
| `GET` | `/api/v1/users/full` | — | Get all users (fast, via ldbsearch) |
| `POST` | `/api/v1/users/` | `UserCreateRequest` | Create user |
| `GET` | `/api/v1/users/{username}` | — | Show user details |
| `DELETE` | `/api/v1/users/{username}` | — | Delete user |
| `POST` | `/api/v1/users/{username}/enable` | — | Enable user |
| `POST` | `/api/v1/users/{username}/disable` | — | Disable user |
| `POST` | `/api/v1/users/{username}/unlock` | — | Unlock user |
| `PUT` | `/api/v1/users/{username}/password` | `UserPasswordRequest` | Set user password |
| `GET` | `/api/v1/users/{username}/groups` | — | Get user groups |
| `PUT` | `/api/v1/users/{username}/setexpiry` | `UserSetExpiryRequest` | Set account expiry |
| `PUT` | `/api/v1/users/{username}/setprimarygroup` | — | Set primary group |
| `POST` | `/api/v1/users/{username}/addunixattrs` | `UserAddUnixAttrsRequest` | Add Unix attributes |
| `PUT` | `/api/v1/users/{username}/sensitive` | `UserSensitiveRequest` | Set sensitive flag |
| `POST` | `/api/v1/users/{username}/move` | — | Move user to a new OU |
| `POST` | `/api/v1/users/{username}/rename` | — | Rename user |
| `GET` | `/api/v1/users/{username}/getpassword` | — | Get user password (PFX blob) |
| `GET` | `/api/v1/users/{username}/get-kerberos-ticket` | — | Get Kerberos ticket for user |

### Examples

```bash
# List users (fast path)
curl -k -H "X-API-Key: YOUR_KEY" https://127.0.0.1:8099/api/v1/users/full

# Create user
curl -k -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"username":"jdoe","given_name":"John","surname":"Doe","password":"S3cret!","ou":"OU=Staff,DC=almaz,DC=local"}' \
  https://127.0.0.1:8099/api/v1/users/

# Set password
curl -k -X PUT -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"password":"N3wP@ss!","must_change_at_next_logon":true}' \
  https://127.0.0.1:8099/api/v1/users/jdoe/password
```

---

## User Extended Management

Router: `app/routers/user_mgmt.py` — prefix `/api/v1/users` (v2.7 extended endpoints). Tag: `Users — Extended`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/users/search` | `?filter&value&limit` | Search users by filter |
| `POST` | `/api/v1/users/import` | `multipart/form-data` (CSV file) | Import users from CSV |
| `GET` | `/api/v1/users/export` | `?format=csv\|json` | Export users to CSV/JSON |
| `PUT` | `/api/v1/users/{username}/edit` | `UserEditRequest` | Edit user attributes via LDAP |
| `GET` | `/api/v1/users/batch` | `?usernames=jdoe,asmith` | Batch get multiple users |

### Bulk operations

Router: `app/routers/bulk_users.py` — prefix `/api/v1/users`. Tag: `Users — Bulk`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/users/bulk` | `BulkUserActionRequest` | Bulk operation on AD users (create/delete/enable/disable/move in one call) |

---

## Group Management

Router: `app/routers/group.py` — prefix `/api/v1/groups`. Tag: `Groups`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/groups/full` | — | All groups (fast ldbsearch) |
| `GET` | `/api/v1/groups/` | `?limit&offset&search` | List groups |
| `POST` | `/api/v1/groups/` | `GroupCreateRequest` | Create group |
| `GET` | `/api/v1/groups/stats` | — | Group statistics |
| `GET` | `/api/v1/groups/{groupname}` | — | Show group details |
| `DELETE` | `/api/v1/groups/{groupname}` | — | Delete group |
| `POST` | `/api/v1/groups/{groupname}/members` | `GroupMembersRequest` | Add members |
| `DELETE` | `/api/v1/groups/{groupname}/members` | `GroupMembersRequest` | Remove members |
| `GET` | `/api/v1/groups/{groupname}/members` | — | List members |
| `POST` | `/api/v1/groups/{groupname}/move` | `GroupMoveRequest` | Move group to a new OU |

---

## Computer Management

Router: `app/routers/computer.py` — prefix `/api/v1/computers`. Tag: `Computers`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/computers/full` | — | All computers (fast ldbsearch) |
| `GET` | `/api/v1/computers/` | `?limit&offset&search` | List computers |
| `POST` | `/api/v1/computers/` | `ComputerCreateRequest` | Create a computer |
| `GET` | `/api/v1/computers/{computername}` | — | Show computer details |
| `DELETE` | `/api/v1/computers/{computername}` | — | Delete a computer |
| `POST` | `/api/v1/computers/{computername}/move` | `ComputerMoveRequest` | Move a computer |

---

## Contact Management

Router: `app/routers/contact.py` — prefix `/api/v1/contacts`. Tag: `Contacts`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/contacts/full` | — | All contacts (fast ldbsearch) |
| `GET` | `/api/v1/contacts/` | `?limit&offset&search` | List contacts |
| `POST` | `/api/v1/contacts/` | `ContactCreateRequest` | Create a contact |
| `GET` | `/api/v1/contacts/{contactname}` | — | Show contact details |
| `DELETE` | `/api/v1/contacts/{contactname}` | — | Delete a contact |
| `POST` | `/api/v1/contacts/{contactname}/move` | `ContactMoveRequest` | Move a contact |
| `POST` | `/api/v1/contacts/{contactname}/rename` | `ContactRenameRequest` | Rename a contact |

---

## Organizational Unit Management

Router: `app/routers/ou.py` — prefix `/api/v1/ous`. Tag: `Organizational Units`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/ous/full` | — | All OUs (fast ldbsearch) |
| `GET` | `/api/v1/ous/` | `?limit&offset&search` | List OUs |
| `POST` | `/api/v1/ous/` | `OUCreateRequest` | Create an OU |
| `DELETE` | `/api/v1/ous/{ouname}` | — | Delete an OU |
| `POST` | `/api/v1/ous/{ouname}/move` | `OUMoveRequest` | Move an OU |
| `POST` | `/api/v1/ous/{ouname}/rename` | `OURenameRequest` | Rename an OU |
| `GET` | `/api/v1/ous/{ouname}/objects` | — | List objects in an OU |

---

## OU Extended Management

Router: `app/routers/ou_mgmt.py` — prefix `/api/v1/ous` (v2.7 extended endpoints). Tag: `OUs — Extended`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/ous/tree` | — | Get OU tree structure |
| `GET` | `/api/v1/ous/search` | `?filter&value` | Search OUs by filter |
| `GET` | `/api/v1/ous/{ou_dn}/stats` | — | Statistics for an OU |
| `GET` | `/api/v1/ous/{ou_dn}/tree` | — | Sub-tree under a specific OU |

---

## Domain Management

Router: `app/routers/domain.py` — prefix `/api/v1/domain`. Tag: `Domain`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/domain/full` | — | Domain info (fast ldbsearch) |
| `GET` | `/api/v1/domain/info` | `?ip_address` | Domain info |
| `GET` | `/api/v1/domain/level` | — | Get domain functional level |
| `PUT` | `/api/v1/domain/level` | `DomainLevelSetRequest` | Set domain functional level (2000/2003/2008/2008_R2/2012/2012_R2/2016) |
| `GET` | `/api/v1/domain/passwordsettings` | — | Get password settings |
| `PUT` | `/api/v1/domain/passwordsettings` | `PasswordSettingsSetRequest` | Set password settings |
| `POST` | `/api/v1/domain/trust/create` | `TrustCreateRequest` | Create trust |
| `DELETE` | `/api/v1/domain/trust/delete` | — | Delete trust |
| `GET` | `/api/v1/domain/trust/list` | — | List trusts |
| `GET` | `/api/v1/domain/trust/namespaces` | — | Trust namespaces |
| `POST` | `/api/v1/domain/trust/validate` | — | Validate trust |
| `POST` | `/api/v1/domain/backup/online` | `BackupRequest` | Online backup (returns `task_id`) |
| `POST` | `/api/v1/domain/backup/offline` | `BackupRequest` | Offline backup (returns `task_id`) |
| `POST` | `/api/v1/domain/kds/root-key/create` | — | Create KDS root key |
| `GET` | `/api/v1/domain/kds/root-key/list` | — | List KDS root keys |
| `POST` | `/api/v1/domain/exportkeytab` | — | Export keytab |
| `POST` | `/api/v1/domain/join` | `ForceActionRequest` | Join domain (requires `force:true`) |
| `POST` | `/api/v1/domain/leave` | `ForceActionRequest` | Leave domain (requires `force:true`) |
| `POST` | `/api/v1/domain/demote` | `DemoteRequest` | Demote domain controller |
| `POST` | `/api/v1/domain/provision` | — | **Deprecated.** Provision (disabled) |
| `GET` | `/api/v1/domain/claim/types` | — | List claim types |

---

## DNS Management

Router: `app/routers/dns.py` — prefix `/api/v1/dns`. Tag: `DNS`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/dns/serverinfo` | — | DNS server info |
| `GET` | `/api/v1/dns/zones` | — | List DNS zones |
| `GET` | `/api/v1/dns/zones/{zone}` | — | Zone info |
| `POST` | `/api/v1/dns/zones` | `DNSZoneCreateRequest` | Create DNS zone |
| `DELETE` | `/api/v1/dns/zones/{zone}` | — | Delete DNS zone |
| `GET` | `/api/v1/dns/zones/{zone}/records` | `?name&type` | List DNS records |
| `POST` | `/api/v1/dns/zones/{zone}/records` | `DNSRecordCreateRequest` | Create DNS record |
| `DELETE` | `/api/v1/dns/zones/{zone}/records` | `DNSRecordDeleteRequest` | Delete DNS record |
| `PUT` | `/api/v1/dns/zones/{zone}/records` | `DNSRecordUpdateRequest` | Update DNS record |
| `GET` | `/api/v1/dns/zones/{zone}/rorecords` | `?name&type` | Query DNS records (read-only) |
| `PUT` | `/api/v1/dns/zones/{zone}/options` | — | Set zone options |
| `POST` | `/api/v1/dns/cache/invalidate` | — | Invalidate DNS cache |

---

## Group Policy (GPO) Management

Router: `app/routers/gpo.py` — prefix `/api/v1/gpo`. Tag: `Group Policy`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/gpo/full` | — | All GPOs (fast ldbsearch) |
| `GET` | `/api/v1/gpo/` | — | List GPOs |
| `POST` | `/api/v1/gpo/` | `GpoCreateRequest` | Create GPO |
| `GET` | `/api/v1/gpo/{gpo_id}` | — | Show GPO detail |
| `DELETE` | `/api/v1/gpo/{gpo_id}` | — | Delete GPO |
| `DELETE` | `/api/v1/gpo/by-name/{displayname}` | — | Delete GPO by displayname |
| `POST` | `/api/v1/gpo/{gpo_id}/link` | `GpoLinkRequest` | Link GPO |
| `DELETE` | `/api/v1/gpo/{gpo_id}/link` | `GpoUnlinkRequest` | Unlink GPO |
| `GET` | `/api/v1/gpo/{gpo_id}/inherit` | — | Get inheritance |
| `PUT` | `/api/v1/gpo/{gpo_id}/inherit` | `GpoSetInheritRequest` | Set inheritance |
| `POST` | `/api/v1/gpo/{gpo_id}/backup` | `GpoBackupRequest` | Backup GPO (returns `task_id`) |
| `POST` | `/api/v1/gpo/{gpo_id}/restore` | `GpoRestoreRequest` | Restore GPO (returns `task_id`) |
| `GET` | `/api/v1/gpo/{gpo_id}/fetch` | — | Fetch GPO data |

---

## FSMO Roles

Router: `app/routers/fsmo.py` — prefix `/api/v1/fsmo`. Tag: `FSMO Roles`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/fsmo/full` | — | FSMO roles (fast ldbsearch) |
| `GET` | `/api/v1/fsmo/` | — | Show FSMO roles (`FsmoShowResponse`) |
| `PUT` | `/api/v1/fsmo/transfer` | `FsmoTransferRequest` | Transfer FSMO role (`FsmoTransferResponse`) |
| `PUT` | `/api/v1/fsmo/seize` | `FsmoSeizeRequest` | Seize FSMO role (`FsmoSeizeResponse`) |

---

## DRS Replication

Router: `app/routers/drs.py` — prefix `/api/v1/drs`. Tag: `DRS Replication`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/drs/showrepl` | — | Show replication status (`DrsShowreplResponse`) |
| `POST` | `/api/v1/drs/replicate` | `DrsReplicateRequest` | Replicate naming context (`DrsReplicateResponse`) |
| `GET` | `/api/v1/drs/uptodateness` | — | Check uptodateness (`DrsUptodatenessResponse`) |
| `GET` | `/api/v1/drs/bind` | — | DRS bind info (`DrsBindResponse`) |
| `GET` | `/api/v1/drs/options` | — | Get DRS options (`DrsOptionsResponse`) |

---

## Sites & Subnets

Router: `app/routers/sites.py` — prefix `/api/v1/sites`. Tag: `Sites & Subnets`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/sites/` | — | List sites |
| `GET` | `/api/v1/sites/{sitename}` | — | View site detail |
| `POST` | `/api/v1/sites/` | `SiteCreateRequest` | Create site |
| `DELETE` | `/api/v1/sites/{sitename}` | — | Delete site |
| `GET` | `/api/v1/sites/{sitename}/subnets` | — | List subnets in site |
| `GET` | `/api/v1/sites/subnets/` | — | View subnet detail |
| `POST` | `/api/v1/sites/{sitename}/subnets` | `SubnetCreateRequest` | Create subnet |
| `DELETE` | `/api/v1/sites/subnets/` | — | Delete subnet |
| `PUT` | `/api/v1/sites/subnets/site` | `SubnetSetSiteRequest` | Set subnet site |

---

## Schema

Router: `app/routers/schema.py` — prefix `/api/v1/schema`. Tag: `Schema`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/schema/attributes/{attribute}` | — | Show schema attribute detail |
| `GET` | `/api/v1/schema/classes/{classname}` | — | Show schema class detail |

---

## Delegation

Router: `app/routers/delegation.py` — prefix `/api/v1/delegation`. Tag: `Delegation`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `POST` | `/api/v1/delegation/add` | `DelegationAccountService` | Add delegation |
| `DELETE` | `/api/v1/delegation/remove` | `DelegationAccountService` | Remove delegation |
| `GET` | `/api/v1/delegation/for-account` | `?account` | Show delegations for account |

---

## Service Accounts

Router: `app/routers/service_account.py` — prefix `/api/v1/service-accounts`. Tag: `Service Accounts`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/service-accounts/` | — | List service accounts |
| `POST` | `/api/v1/service-accounts/` | `CreateServiceAccountRequest` | Create service account |
| `GET` | `/api/v1/service-accounts/{accountname}` | — | Show service account |
| `DELETE` | `/api/v1/service-accounts/{accountname}` | — | Delete service account |
| `POST` | `/api/v1/service-accounts/{accountname}/gmsa-members/add` | `GmsaMembersRequest` | Add gMSA member |
| `DELETE` | `/api/v1/service-accounts/{accountname}/gmsa-members/remove` | `GmsaMembersRequest` | Remove gMSA member |
| `GET` | `/api/v1/service-accounts/{accountname}/gmsa-members` | — | List gMSA members |

---

## Authentication Policies & Silos

Router: `app/routers/auth_policy.py` — prefix `/api/v1/auth`. Tag: `Authentication Policies`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/auth/silos` | — | List authentication silos |
| `POST` | `/api/v1/auth/silos` | `CreateSiloRequest` | Create authentication silo |
| `GET` | `/api/v1/auth/silos/{siloname}` | — | Show authentication silo |
| `DELETE` | `/api/v1/auth/silos/{siloname}` | — | Delete authentication silo |
| `POST` | `/api/v1/auth/silos/{siloname}/members` | `SiloMemberRequest` | Add member to silo |
| `DELETE` | `/api/v1/auth/silos/{siloname}/members` | `SiloMemberRequest` | Remove member from silo |
| `GET` | `/api/v1/auth/policies` | — | List authentication policies |
| `POST` | `/api/v1/auth/policies` | `CreatePolicyRequest` | Create authentication policy |
| `GET` | `/api/v1/auth/policies/{policyname}` | — | Show authentication policy |
| `DELETE` | `/api/v1/auth/policies/{policyname}` | — | Delete authentication policy |

---

## Miscellaneous Operations

Router: `app/routers/misc.py` — prefix `/api/v1/misc`. Tag: `Miscellaneous`.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/misc/dbcheck` | `?fix` | Run database check |
| `POST` | `/api/v1/misc/dbcheck/fix` | `DbcheckFixRequest` | Fix database errors (returns `task_id`) |
| `GET` | `/api/v1/misc/ntacl` | `?file` | Get NT ACL |
| `POST` | `/api/v1/misc/ntacl/set` | `SetNtaclRequest` | Set NT ACL |
| `POST` | `/api/v1/misc/ntacl/sysvolreset` | — | Reset sysvol ACLs (returns `task_id`) |
| `GET` | `/api/v1/misc/testparm` | — | Test configuration |
| `GET` | `/api/v1/misc/processes` | — | List Samba processes |
| `GET` | `/api/v1/misc/time` | — | Get server time |
| `GET` | `/api/v1/misc/spn/list` | `?account` | List SPNs |
| `POST` | `/api/v1/misc/spn/add` | `SpnRequest` | Add SPN |
| `DELETE` | `/api/v1/misc/spn/delete` | `SpnRequest` | Delete SPN |

---

## Shell Execution

Router: `app/routers/shell.py` — prefix `/api/v1/shell`. Tag: `Shell`. Also see the WebSocket endpoint `/ws/shell` for streaming execution.

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/v1/shell/` | — | List available shells |
| `POST` | `/api/v1/shell/exec` | `ShellExecRequest` | Execute a shell command |
| `POST` | `/api/v1/shell/script` | `ShellScriptRequest` | Execute a multi-line script |
| `POST` | `/api/v1/shell/script/file` | `multipart/form-data` (file) | Upload a script file and execute it |

| WS | `/ws/shell` | — | Real-time shell execution over WebSocket |

### Example

```bash
# Execute a shell command
curl -k -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"command":"uptime","timeout":30}' \
  https://127.0.0.1:8099/api/v1/shell/exec
```

---

## Shell Project

Routers: `app/routers/shell_projet.py` + `app/routers/shell_projet_files.py` — prefix `/api/v1/shell/projet`. Tag: `Shell Projects`. WebSocket: `/ws/projet/{projet_id}`.

### Project lifecycle

| Method | Path | Body / Params | Description |
|--------|------|---------------|-------------|
| `POST` | `/api/v1/shell/projet/` | `ShellProjetCreateRequest` | Create a shell project workspace |
| `POST` | `/api/v1/shell/projet/{projet_id}/upload` | `multipart/form-data` | Upload file(s)/archive to project workspace |
| `POST` | `/api/v1/shell/projet/{projet_id}/upload-multi` | `multipart/form-data` | Upload multiple files/archives (v1.6.7-3) |
| `POST` | `/api/v1/shell/projet/{projet_id}/run` | `ShellProjetRunRequest` | Execute command in project workspace |
| `POST` | `/api/v1/shell/projet/{projet_id}/abort` | — | Abort running command |
| `GET` | `/api/v1/shell/projet/list` | — | List all projects |
| `GET` | `/api/v1/shell/projet/health` | — | Shell projet system health check (v1.6.7-3) |
| `GET` | `/api/v1/shell/projet/show/{projet_id}` | — | Show project details |
| `GET` | `/api/v1/shell/projet/{projet_id}` | — | Show project details (alias) |
| `GET` | `/api/v1/shell/projet/{projet_id}/download` | — | Download workspace as `.zip` |
| `DELETE` | `/api/v1/shell/projet/{projet_id}` | — | Delete project workspace |

### Owner & tags (v1.6.7-3)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `PATCH` | `/api/v1/shell/projet/{projet_id}/owner` | `ShellProjetOwnerChangeRequest` | Transfer project ownership |
| `PATCH` | `/api/v1/shell/projet/{projet_id}/tags` | `ShellProjetTagsUpdateRequest` | Update project tags/labels |

### Scheduling (v1.6.7-4)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/shell/projet/{projet_id}/schedule` | schedule payload | Create a cron schedule |
| `GET` | `/api/v1/shell/projet/{projet_id}/schedule` | — | List schedules |
| `DELETE` | `/api/v1/shell/projet/{projet_id}/schedule/{schedule_id}` | — | Delete a schedule |

### Templates (v1.6.7-4)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/shell/projet/template` | template payload | Create a project template |
| `POST` | `/api/v1/shell/projet/from-template/{template_id}` | — | Create project from template |
| `GET` | `/api/v1/shell/projet/templates` | — | List all templates |
| `DELETE` | `/api/v1/shell/projet/template/{template_id}` | — | Delete a template |

### Snapshots & audit (v1.6.7-4)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/shell/projet/{projet_id}/snapshot` | — | Create workspace snapshot |
| `POST` | `/api/v1/shell/projet/{projet_id}/rollback/{snapshot_id}` | — | Rollback workspace to snapshot |
| `GET` | `/api/v1/shell/projet/audit` | — | Global audit log |
| `GET` | `/api/v1/shell/projet/{projet_id}/audit` | — | Project audit log |
| `POST` | `/api/v1/shell/projet/batch` | batch payload | Batch project operations |

### File operations (router `shell_projet_files.py`)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/shell/projet/{projet_id}/files` | — | List files in workspace |
| `GET` | `/api/v1/shell/projet/{projet_id}/files/{file_path:path}` | — | Download a file |
| `PUT` | `/api/v1/shell/projet/{projet_id}/files/{file_path:path}` | file body | Upload/overwrite a file |
| `DELETE` | `/api/v1/shell/projet/{projet_id}/files/{file_path:path}` | — | Delete a file or directory |
| `POST` | `/api/v1/shell/projet/{projet_id}/mkdir/{dir_path:path}` | — | Create a directory |

| WS | `/ws/projet/{projet_id}` | — | Real-time stdout/stderr/status for a project execution |
| WS | `/ws/projet` | — | All project events (dashboard) |

---

## Batch Operations

Router: `app/routers/batch.py` — prefix `/api/v1/batch`. Tag: `Batch`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/batch/` | `BatchRequest` | Execute batch operations (multi-step, with template resolution and rollback). Returns `BatchResponse`. |

### Example

```bash
curl -k -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"method":"POST","path":"/api/v1/users/","body":{"username":"jdoe","password":"S3cret!"}},
      {"method":"POST","path":"/api/v1/groups/dev/members","body":{"members":["jdoe"]}}
    ],
    "stop_on_error": true,
    "rollback_on_error": true
  }' \
  https://127.0.0.1:8099/api/v1/batch/
```

---

## AI Assistant

Router: `app/routers/ai.py` — prefix `/api/v1/ai`. Tag: `AI`. Polza.ai-powered.

### Core

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/ai/assistant` | `AIRequest` | AI Assistant for Task Builder (returns OpenAPI-based action plan) |
| `POST` | `/api/v1/ai/sdb` | `AISdbRequest` | AI Assistant for SDB mode (generates SDB scripts) |
| `POST` | `/api/v1/ai/agent` | `AIAgentRequest` | AI Agent with direct execution (can call any API + run shell commands) |
| `GET` | `/api/v1/ai/schema` | — | Compressed OpenAPI schema for AI |
| `GET` | `/api/v1/ai/config` | — | Current AI configuration |
| `GET` | `/api/v1/ai/balance` | — | AI provider account balance |
| `GET` | `/api/v1/ai/test` | — | AI connection diagnostics (v2.0.3) |
| `GET` | `/api/v1/ai/info` | — | AI usage dashboard |
| `GET` | `/api/v1/ai/system` | — | Get AI system configuration |
| `PUT` | `/api/v1/ai/system` | `AISystemPromptUpdateRequest` | Update AI system configuration |
| `GET` | `/api/v1/ai/data-schema` | — | Get AI data schema for web UI |
| `POST` | `/api/v1/ai/pipeline/execute` | `AIPipelineConfig` | Execute AI pipeline |
| `GET` | `/api/v1/ai/pipeline/templates` | — | Get pipeline templates |

### Chat sessions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/ai/chat/` | `ChatCreateRequest` | Create a new AI chat session |
| `GET` | `/api/v1/ai/chat/list` | — | List AI chat sessions |
| `GET` | `/api/v1/ai/chat/{chat_id}` | — | Get chat session details |
| `PUT` | `/api/v1/ai/chat/{chat_id}` | `ChatUpdateRequest` | Update chat session |
| `DELETE` | `/api/v1/ai/chat/{chat_id}` | — | Delete a chat session |
| `POST` | `/api/v1/ai/chat/{chat_id}/send` | `ChatMessageSend` | Send a message (returns full response) |
| `POST` | `/api/v1/ai/chat/{chat_id}/stream` | `ChatMessageSend` | Send a message with **SSE streaming** (real-time agent steps) |
| `GET` | `/api/v1/ai/chat/{chat_id}/history` | — | Get chat message history |
| `GET` | `/api/v1/ai/chat/{chat_id}/info` | — | Chat session cost/usage summary |

### Exports

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/ai/exports` | List all exported files with download links |
| `GET` | `/api/v1/ai/exports/{filename}` | Download an exported file |

### Examples

```bash
# One-shot AI Assistant
curl -k -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"List all disabled users and re-enable them"}' \
  https://127.0.0.1:8099/api/v1/ai/assistant

# Streaming chat (SSE)
curl -k -N -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"message":"Show me the latest 5 audit events"}' \
  https://127.0.0.1:8099/api/v1/ai/chat/{chat_id}/stream
```

---

## Chat (REST + WebSocket)

Router: `app/routers/chat.py` — prefix `/api/v1/chat`. Tag: `Chat`. WebSocket: `/ws/chat/{room_id}`. PostgreSQL-backed.

### Rooms

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/chat/rooms` | — | List my chat rooms |
| `POST` | `/api/v1/chat/rooms` | `RoomCreateRequest` | Create a chat room |
| `GET` | `/api/v1/chat/rooms/{room_id}` | — | Get chat room details |
| `PUT` | `/api/v1/chat/rooms/{room_id}` | `RoomUpdateRequest` | Update chat room |
| `DELETE` | `/api/v1/chat/rooms/{room_id}` | — | Delete chat room (owner only) |
| `POST` | `/api/v1/chat/rooms/{room_id}/read` | — | Mark messages as read |
| `POST` | `/api/v1/chat/rooms/{room_id}/mute` | — | Mute/unmute room notifications |
| `GET` | `/api/v1/chat/unread` | — | Unread counts for all my rooms |

### Members

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/chat/rooms/{room_id}/members` | — | List room members |
| `POST` | `/api/v1/chat/rooms/{room_id}/members` | `MemberAddRequest` | Add member to room |
| `DELETE` | `/api/v1/chat/rooms/{room_id}/members/{user_id}` | — | Remove member from room |

### Messages

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/chat/rooms/{room_id}/messages` | `?limit&before_id` | List messages in room |
| `POST` | `/api/v1/chat/rooms/{room_id}/messages` | `MessageSendRequest` | Send a text message |
| `PUT` | `/api/v1/chat/messages/{msg_id}` | `MessageEditRequest` | Edit a message |
| `DELETE` | `/api/v1/chat/messages/{msg_id}` | — | Delete a message (soft) |
| `POST` | `/api/v1/chat/messages/{msg_id}/forward` | `ForwardRequest` | Forward a message to another room |
| `GET` | `/api/v1/chat/messages/{msg_id}/read-by` | — | Who read this message |

### Reactions, stars, pins

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/chat/messages/{msg_id}/reactions` | `ReactionRequest` | Toggle emoji reaction |
| `GET` | `/api/v1/chat/messages/{msg_id}/reactions` | — | List reactions on a message |
| `POST` | `/api/v1/chat/messages/{msg_id}/star` | — | Star/unstar a message |
| `GET` | `/api/v1/chat/stars` | — | List my starred messages |
| `POST` | `/api/v1/chat/messages/{msg_id}/pin` | — | Pin a message |
| `GET` | `/api/v1/chat/rooms/{room_id}/pinned` | — | List pinned messages |

### Files & voice

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/chat/rooms/{room_id}/files` | `multipart/form-data` | Upload a file and send as message |
| `POST` | `/api/v1/chat/rooms/{room_id}/voice` | `multipart/form-data` (audio) | Upload a voice message |
| `GET` | `/api/v1/chat/attachments/{att_id}` | — | Download a file attachment |

### Search & scheduled

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/chat/search` | `?q&room_id` | Search messages across all my chats |
| `POST` | `/api/v1/chat/rooms/{room_id}/schedule` | `ScheduleRequest` | Schedule a message |
| `GET` | `/api/v1/chat/scheduled` | — | List my pending scheduled messages |
| `DELETE` | `/api/v1/chat/scheduled/{msg_id}` | — | Delete a scheduled message |

### Audio calls

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/chat/rooms/{room_id}/calls` | `CallInitiateRequest` | Initiate a call |
| `POST` | `/api/v1/chat/calls/{call_id}/accept` | — | Accept a call |
| `POST` | `/api/v1/chat/calls/{call_id}/reject` | — | Reject a call |
| `POST` | `/api/v1/chat/calls/{call_id}/end` | — | End a call |
| `POST` | `/api/v1/chat/calls/{call_id}/cancel` | — | Cancel a ringing call |
| `GET` | `/api/v1/chat/rooms/{room_id}/calls` | — | List calls in a room |
| `GET` | `/api/v1/chat/calls` | — | List my calls (all rooms) |

### Admin

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/chat/stats` | — | Chat statistics (admin) |
| `POST` | `/api/v1/chat/cleanup` | — | Clean up files from deleted messages (admin) |
| `POST` | `/api/v1/chat/retention` | — | Delete messages older than N days (admin) |

### WebSocket

| WS | `/ws/chat/{room_id}` | — | Real-time chat in a specific room |

---

## Management API (Admin Panel)

Router: `app/routers/mgmt.py` — prefix `/api/v1/mgmt`. Tag: `Management`. PostgreSQL-backed (`mgmt_users`, `mgmt_api_keys`, `mgmt_roles`, `mgmt_permissions`, `mgmt_audit_log`).

### Users

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/mgmt/users` | `?limit&offset&search` | List management users |
| `POST` | `/api/v1/mgmt/users` | `UserCreateRequest` | Create management user |
| `GET` | `/api/v1/mgmt/users/{user_id}` | — | Get management user |
| `PUT` | `/api/v1/mgmt/users/{user_id}` | `UserUpdateRequest` | Update management user |
| `DELETE` | `/api/v1/mgmt/users/{user_id}` | `?hard=false` | Delete management user (soft or hard) |
| `POST` | `/api/v1/mgmt/users/{user_id}/enable` | — | Enable user |
| `POST` | `/api/v1/mgmt/users/{user_id}/disable` | — | Disable user (soft) |
| `POST` | `/api/v1/mgmt/users/{user_id}/purge` | — | Permanently delete user |
| `POST` | `/api/v1/mgmt/users/{user_id}/reset-password` | `PasswordResetRequest` | Reset user password |
| `GET` | `/api/v1/mgmt/users/{user_id}/keys` | — | List API keys of a user |
| `POST` | `/api/v1/mgmt/users/bulk` | `BulkActionRequest` | Bulk action on users (enable/disable/purge) |

### API Keys

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/mgmt/keys` | `?limit&offset` | List API keys |
| `POST` | `/api/v1/mgmt/keys` | `ApiKeyCreateRequest` | Create API key |
| `GET` | `/api/v1/mgmt/keys/{key_id}` | — | Get API key details |
| `PUT` | `/api/v1/mgmt/keys/{key_id}` | `ApiKeyUpdateRequest` | Update API key |
| `DELETE` | `/api/v1/mgmt/keys/{key_id}` | `?hard=false` | Delete API key (soft or hard) |
| `POST` | `/api/v1/mgmt/keys/{key_id}/rotate` | — | Rotate API key |
| `POST` | `/api/v1/mgmt/keys/{key_id}/enable` | — | Enable API key |
| `POST` | `/api/v1/mgmt/keys/{key_id}/disable` | — | Disable API key (soft) |
| `POST` | `/api/v1/mgmt/keys/{key_id}/purge` | — | Permanently delete API key |
| `POST` | `/api/v1/mgmt/keys/bulk` | `BulkActionRequest` | Bulk action on API keys |

### Roles

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/mgmt/roles` | — | List all roles |
| `GET` | `/api/v1/mgmt/roles/{role_name}` | — | Get role details |
| `POST` | `/api/v1/mgmt/roles` | `RoleCreateRequest` | Create custom role |
| `PUT` | `/api/v1/mgmt/roles/{role_name}` | `RoleUpdateRequest` | Update role |
| `DELETE` | `/api/v1/mgmt/roles/{role_name}` | — | Delete custom role (hard) |
| `POST` | `/api/v1/mgmt/roles/{role_name}/enable` | — | Enable role |
| `POST` | `/api/v1/mgmt/roles/{role_name}/disable` | — | Disable role (soft) |
| `POST` | `/api/v1/mgmt/roles/{role_name}/gen-key` | `GenKeyForRoleRequest` | Generate API key for role |
| `GET` | `/api/v1/mgmt/roles/{role_name}/users` | — | List users assigned to a role |
| `GET` | `/api/v1/mgmt/roles/{role_name}/keys` | — | List API keys assigned to a role |

### Permissions

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/mgmt/permissions` | — | List all available permissions |
| `POST` | `/api/v1/mgmt/permissions/assign` | `PermissionAssignRequest` | Assign permissions to a role |
| `POST` | `/api/v1/mgmt/permissions/revoke` | `PermissionRevokeRequest` | Revoke permissions from a role |

### Stats & audit

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/mgmt/stats` | Management dashboard stats |
| `GET` | `/api/v1/mgmt/audit` | View audit log (with filters) |

### 2FA admin (router `twofa_admin.py`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/mgmt/users/{user_id}/2fa/status` | Check 2FA status for any user |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/setup` | Generate a new TOTP secret for any user |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/enable` | Enable 2FA for any user (`Admin2FAEnableRequest`) |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/disable` | Disable 2FA for any user (admin override) |
| `POST` | `/api/v1/mgmt/users/{user_id}/2fa/reset` | Reset 2FA for any user (wipe stored secret) |
| `GET` | `/api/v1/mgmt/2fa/enabled` | List all users with 2FA enabled |
| `GET` | `/api/v1/mgmt/2fa/disabled` | List all users with a stored secret but 2FA disabled |

---

## Ban Management

Router: `app/routers/ban.py` — prefix `/api/v1/ban`. Tag: `Ban`. PostgreSQL-backed (`mgmt_bans` table). All endpoints are admin-only.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/ban` | `BanCreateRequest` | Create a ban (user or key) |
| `POST` | `/api/v1/ban/unban` | `UnbanRequest` | Lift a ban (by id or by `target_type`+`target_name`) |
| `POST` | `/api/v1/ban/unban/` | `UnbanRequest` | Convenience alias (hidden from schema) |
| `GET` | `/api/v1/ban` | `?active&target_type&target_name&limit&offset` | List bans (with filters) |
| `GET` | `/api/v1/ban/{ban_id}` | — | Show one ban by id |
| `DELETE` | `/api/v1/ban/{ban_id}` | — | Hard-delete a ban record (history) — admin only |
| `GET` | `/api/v1/ban/check/{target_type}/{target_name}` | — | Check if a target (user or key) is currently banned |

### Required permissions (admin-only by default)

- `ban.create` — `POST /api/v1/ban`
- `ban.unban` — `POST /api/v1/ban/unban`
- `ban.list` — `GET /api/v1/ban`
- `ban.show` — `GET /api/v1/ban/{id}` and `GET /api/v1/ban/check/{type}/{name}`
- `ban.delete` — `DELETE /api/v1/ban/{id}`

### Behaviour

- The **static bootstrap admin API key** (`SAMBA_API_KEY`) **cannot be banned** — this is intentional to prevent total lockout.
- JWT-authenticated requests check `ban_db.is_user_banned(jwt_username)` after permission check.
- API-key requests check both `is_key_banned(key_prefix)` (for mgmt-issued keys) and `is_user_banned(owner_username)` (the key's owner).
- Bans have **lazy expiry** — expired bans are removed on next check.
- Lifting a ban preserves the record in history (with `unbanned_at`).

---

## Webhooks

Router: `app/routers/webhooks.py` — prefix `/api/v1/webhooks`. Tag: `Webhooks`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/webhooks` | — | List webhooks |
| `POST` | `/api/v1/webhooks` | `WebhookCreateRequest` | Register webhook |
| `GET` | `/api/v1/webhooks/events` | — | List supported event types |
| `GET` | `/api/v1/webhooks/{wh_id}` | — | Get webhook details |
| `PUT` | `/api/v1/webhooks/{wh_id}` | `WebhookUpdateRequest` | Update webhook |
| `DELETE` | `/api/v1/webhooks/{wh_id}` | — | Delete webhook |
| `POST` | `/api/v1/webhooks/{wh_id}/test` | — | Send a test event to webhook |

### Emitted event categories

- `auth.login_success`, `auth.login_failure`
- User lifecycle events (create/delete/enable/disable)
- API key lifecycle events
- Role changes
- 2FA enable/disable/reset
- Ban create/unban
- (Future) shell projet lifecycle, chat events

---

## Backup

Router: `app/routers/backup.py` — prefix `/api/v1/backup`. Tag: `Backup`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/backup` | `BackupCreateRequest` | Create a backup (returns `task_id`) |
| `GET` | `/api/v1/backup` | — | List backups |
| `GET` | `/api/v1/backup/{filename}` | — | Download a backup file |
| `DELETE` | `/api/v1/backup/{filename}` | — | Delete a backup file |
| `POST` | `/api/v1/backup/restore` | `RestoreRequest` | Restore from a backup (returns `task_id`) |

---

## Dashboard & Charts

Routers: `app/routers/dashboard.py` + `app/routers/dashboard_charts.py`. Prefixes: `/api/v1/dashboard` and `/api/v1/dashboard/charts`.

### Overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/dashboard/full` | Full AD dashboard (fast, via ldbsearch) |
| `GET` | `/api/v1/dashboard/overview` | AD + system overview (one request, fast) |

### Charts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/dashboard/charts/login-activity` | Login activity over time |
| `GET` | `/api/v1/dashboard/charts/top-groups` | Top groups by member count |
| `GET` | `/api/v1/dashboard/charts/os-distribution` | Computer OS distribution |
| `GET` | `/api/v1/dashboard/charts/users-by-ou` | Users grouped by OU |
| `GET` | `/api/v1/dashboard/charts/recent-events` | Recent audit events (timeline) |
| `GET` | `/api/v1/dashboard/charts/mgmt-summary` | Management summary (counts) |

---

## SDB (Samba Database Query)

Router: `app/routers/sdb.py` — prefix `/api/v1/sdb`. Tag: `SDB`. Direct LDB/TDB access (no samba-tool subprocess).

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/sdb/databases` | — | List available Samba LDB databases |
| `GET` | `/api/v1/sdb/full/{entity}` | — | Full list of records for an entity (web-friendly) |
| `GET` | `/api/v1/sdb/info/{entity}` | `?fields` | Lightweight info about an entity (count or selected fields) |
| `POST` | `/api/v1/sdb/query` | `SdbQueryRequest` | Execute SDB LDB query |
| `POST` | `/api/v1/sdb/select` | `SdbSelectRequest` | SQL-like SELECT query |
| `POST` | `/api/v1/sdb/show` | `SdbShowRequest` | Show AD object from database |
| `POST` | `/api/v1/sdb/script` | `SdbScriptRequest` | Execute SDB script |
| `GET` | `/api/v1/sdb/synthesis` | — | Analyze AD database schema |
| `POST` | `/api/v1/sdb/export` | `SdbExportRequest` | One-step export AD data to ZIP |
| `GET` | `/api/v1/sdb/export-download` | — | One-step export + immediate ZIP download |
| `GET` | `/api/v1/sdb/exports` | — | List all SDB export files |
| `GET` | `/api/v1/sdb/exports/{filename}` | — | Download an exported file |

---

## Report Generation

Router: `app/routers/report.py` — prefix `/api/v1/report`. Tag: `Report`. Generates multi-sheet XLSX reports (8 sheets: users, groups, computers, contacts, OUs, DNS, GPO, audit).

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/report/generate` | `ReportGenerateRequest` | Generate multi-sheet AD report (XLSX, 8 sheets) |
| `GET` | `/api/v1/report/generate` | — | Generate AD report via GET (quick download) |
| `GET` | `/api/v1/report/exports/{filename}` | — | Download exported report file |

---

## Runtime Configuration (CFG)

Router: `app/routers/cfg.py` — prefix `/api/v1/cfg`. Tag: `CFG`. Runtime `.env` management with hot-reload. Persisting to `/etc/webadc/.env` for reboot-survival is supported via `POST /api/v1/cfg/persist`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/cfg` | — | List all `.env` variables |
| `GET` | `/api/v1/cfg/schema` | — | Schema of known settings (metadata) |
| `GET` | `/api/v1/cfg/raw` | — | Download raw `.env` file |
| `GET` | `/api/v1/cfg/{key}` | — | View one variable's value |
| `PUT` | `/api/v1/cfg/{key}` | `CfgUpdateRequest` | Update or create a variable (hot-reload) |
| `POST` | `/api/v1/cfg/bulk` | `CfgBulkUpdateRequest` | Bulk update (hot-reload) |
| `DELETE` | `/api/v1/cfg/{key}` | — | Delete a variable (hot-reload) |
| `POST` | `/api/v1/cfg/{key}/disable` | — | Disable a variable (set empty) |
| `POST` | `/api/v1/cfg/{key}/enable` | — | Enable a variable (restore or set true) |
| `POST` | `/api/v1/cfg/reload` | — | Force-reload settings from `.env` |
| `POST` | `/api/v1/cfg/persist` | — | Save variables to `/etc/webadc/.env` (reboot survival) |

---

## Live Events (SSE)

Router: `app/routers/live.py` — prefix `/api/v1/live`. Tag: `Live Updates`. Server-Sent Events stream for the management dashboard.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/live/events` | SSE stream — emits user/key/role events in real time |
| WS | `/ws/live` | WebSocket equivalent (preferred for richer event types) |

### Example

```bash
curl -k -N -H "X-API-Key: YOUR_KEY" \
  https://127.0.0.1:8099/api/v1/live/events
```

---

## Audit Export

Router: `app/routers/audit_export.py` — prefix `/api/v1/mgmt/audit`. Tag: `Audit — Export`.

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| `GET` | `/api/v1/mgmt/audit/export` | `?format=csv\|xlsx&from&to&user&action` | Export audit log to CSV or XLSX |

### Example

```bash
# Export last 24h audit log as XLSX
curl -k -H "X-API-Key: YOUR_KEY" -o audit.xlsx \
  "https://127.0.0.1:8099/api/v1/mgmt/audit/export?format=xlsx"
```

---

## Task Management

Background task tracking (in-memory `TaskManager` + WebSocket hooks). Long-running operations (backup, GPO restore, dbcheck, sysvolreset, etc.) return a `task_id` immediately.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tasks` | List all tasks |
| `GET` | `/api/v1/tasks/{task_id}` | Get task status by task ID |
| WS | `/ws/tasks/{task_id}` | Real-time updates for a single task |
| WS | `/ws/tasks` | All task updates (dashboard) |

### Example

```bash
# Start an online backup (returns task_id)
TASK_ID=$(curl -k -s -X POST -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"server":"dc1.almaz.local"}' \
  https://127.0.0.1:8099/api/v1/domain/backup/online | jq -r .task_id)

# Poll status
curl -k -H "X-API-Key: YOUR_KEY" \
  https://127.0.0.1:8099/api/v1/tasks/$TASK_ID

# Or subscribe via WebSocket
wscat -k -H "Authorization: Bearer eyJ..." \
  wss://127.0.0.1:8099/ws/tasks/$TASK_ID
```

---

## Data Models Reference

Pydantic models live in `app/models/`. The most commonly used request/response models:

### Auth
- `LoginRequest{username, password}`
- `RefreshRequest{refresh_token}`
- `TokenResponse{access_token, refresh_token, token_type, expires_in, role, permissions}`
- `MeResponse{status, auth_method, username, role, permissions, expires_at}`
- `CheckCredentialsRequest{username?, password?}`

### 2FA
- `TwoFAEnableRequest{totp_code}`
- `TwoFADisableRequest{password}`
- `TwoFAVerifyRequest{temp_token, totp_code}`
- `Admin2FAEnableRequest{totp_code?, force?}`

### Users
- `UserCreateRequest{username, given_name?, surname?, password?, ou?, email?, ...}`
- `UserPasswordRequest{password, must_change_at_next_logon?}`
- `UserSetExpiryRequest{expiry_date}`
- `UserAddUnixAttrsRequest{uid, gid, shell?, home_dir?}`
- `UserSensitiveRequest{sensitive: bool}`
- `UserEditRequest{...}` (LDAP attributes)

### Groups
- `GroupCreateRequest{groupname, ou?, description?}`
- `GroupMembersRequest{members: [str]}`
- `GroupMoveRequest{new_ou}`

### Computers / Contacts / OUs
- `ComputerCreateRequest{computername, ou?}`
- `ComputerMoveRequest{new_ou}`
- `ContactCreateRequest{contactname, ou?, ...}`
- `ContactMoveRequest{new_ou}`
- `ContactRenameRequest{new_name}`
- `OUCreateRequest{name, ou?}`
- `OUMoveRequest{new_parent_dn}`
- `OURenameRequest{new_name}`

### Domain
- `DomainLevelSetRequest{level}` — one of `2000/2003/2008/2008_R2/2012/2012_R2/2016`
- `PasswordSettingsSetRequest{...}`
- `TrustCreateRequest{domain, trust_type?, ...}`
- `BackupRequest{server, ...}`
- `DemoteRequest{...}`
- `ForceActionRequest{force: bool}`

### DNS
- `DNSZoneCreateRequest{zone, zone_type?}`
- `DNSRecordCreateRequest{name, type, data, ttl?}`
- `DNSRecordDeleteRequest{name, type, data?}`
- `DNSRecordUpdateRequest{name, type, old_data, new_data}`

### GPO
- `GpoCreateRequest{displayname, domain?}`
- `GpoLinkRequest{ou, enforced?, ...}`
- `GpoUnlinkRequest{ou}`
- `GpoSetInheritRequest{inherit: bool}`
- `GpoBackupRequest{directory, ...}`
- `GpoRestoreRequest{directory, ...}`

### FSMO / DRS
- `FsmoTransferRequest{role, server}`
- `FsmoSeizeRequest{role, server}`
- `DrsReplicateRequest{source, destination, partition}`

### Sites
- `SiteCreateRequest{name}`
- `SubnetCreateRequest{network, site}`
- `SubnetSetSiteRequest{network, site}`

### Service Accounts
- `CreateServiceAccountRequest{accountname, ...}`
- `GmsaMembersRequest{members: [str]}`

### Auth Policies
- `CreateSiloRequest{name, ...}`
- `CreatePolicyRequest{name, ...}`
- `SiloMemberRequest{account}`

### Delegation
- `DelegationAccountService{account, service?}`

### Misc
- `DbcheckFixRequest{...}`
- `SetNtaclRequest{file, acl, ...}`
- `SpnRequest{account, spn}`

### Shell
- `ShellExecRequest{command, timeout?}`
- `ShellScriptRequest{script, timeout?}`

### Shell Project
- `ShellProjetCreateRequest{name, ...}`
- `ShellProjetRunRequest{command, timeout?}`
- `ShellProjetOwnerChangeRequest{owner}`
- `ShellProjetTagsUpdateRequest{tags: [str]}`

### Batch
- `BatchRequest{steps: [Step], stop_on_error?, rollback_on_error?}`
- `BatchResponse{results: [...], status, ...}`

### AI
- `AIRequest{prompt, ...}`
- `AISdbRequest{prompt, ...}`
- `AIAgentRequest{prompt, max_steps?, ...}`
- `ChatCreateRequest{title?}`
- `ChatUpdateRequest{title}`
- `ChatMessageSend{message, ...}`
- `AISystemPromptUpdateRequest{system_prompt}`
- `AIPipelineConfig{...}`

### Chat
- `RoomCreateRequest{name, members?}`
- `RoomUpdateRequest{name?}`
- `MemberAddRequest{user_id}`
- `MessageSendRequest{text, reply_to_id?}`
- `MessageEditRequest{text}`
- `ReactionRequest{emoji}`
- `ForwardRequest{to_room_id}`
- `ScheduleRequest{text, send_at}`
- `CallInitiateRequest{...}`

### Ban
- `BanCreateRequest{target_type: "user"|"key", target_name, reason?, duration_minutes?}`
- `UnbanRequest{ban_id? OR target_type+target_name}`

### Webhooks
- `WebhookCreateRequest{url, events, ...}`
- `WebhookUpdateRequest{url?, events?, ...}`

### Backup
- `BackupCreateRequest{...}`
- `RestoreRequest{filename}`

### SDB
- `SdbQueryRequest{database, filter?, ...}`
- `SdbSelectRequest{table, columns?, where?, ...}`
- `SdbShowRequest{database, dn}`
- `SdbScriptRequest{script}`
- `SdbExportRequest{entities, ...}`

### Report
- `ReportGenerateRequest{...}`

### CFG
- `CfgUpdateRequest{value}`
- `CfgBulkUpdateRequest{updates: {key: value}}`

### Management
- `UserCreateRequest{username, password, role, ...}`
- `UserUpdateRequest{...}`
- `PasswordResetRequest{password}`
- `ApiKeyCreateRequest{name, role, expires_at?, ...}`
- `ApiKeyUpdateRequest{...}`
- `RoleCreateRequest{name, permissions: [str]}`
- `RoleUpdateRequest{permissions: [str]}`
- `GenKeyForRoleRequest{...}`
- `PermissionAssignRequest{role, permissions: [str]}`
- `PermissionRevokeRequest{role, permissions: [str]}`
- `BulkActionRequest{ids: [int], action}`

### Common
- `ErrorResponse{status: "error", message, details?}`

---

## Permissions Reference

The full permission catalogue is available at runtime via `GET /api/v1/mgmt/permissions`. Permissions are resolved from `(method, path)` by `app.permissions.resolve_permission`. Below is the category breakdown:

| Category | Permissions (examples) | Default roles |
|----------|------------------------|---------------|
| **Users** | `user.list`, `user.show`, `user.create`, `user.delete`, `user.enable`, `user.disable`, `user.unlock`, `user.password`, `user.move`, `user.rename`, `user.groups`, `user.expiry`, `user.primarygroup`, `user.unixattrs`, `user.sensitive`, `user.getpassword`, `user.kerberos`, `user.edit`, `user.search`, `user.import`, `user.export`, `user.batch` | admin: all / operator: read + most write / auditor: read |
| **Groups** | `group.list`, `group.show`, `group.create`, `group.delete`, `group.members.add`, `group.members.remove`, `group.members.list`, `group.move`, `group.stats` | similar |
| **Computers** | `computer.list`, `computer.show`, `computer.create`, `computer.delete`, `computer.move` | similar |
| **Contacts** | `contact.list`, `contact.show`, `contact.create`, `contact.delete`, `contact.move`, `contact.rename` | similar |
| **OUs** | `ou.list`, `ou.create`, `ou.delete`, `ou.move`, `ou.rename`, `ou.objects`, `ou.tree`, `ou.search`, `ou.stats`, `ou.subtree` | similar |
| **Domain** | `domain.info`, `domain.level.get`, `domain.level.set`, `domain.passwordsettings.get/set`, `domain.trust.create/delete/list/namespaces/validate`, `domain.backup.online/offline`, `domain.kds.root-key.create/list`, `domain.exportkeytab`, `domain.join`, `domain.leave`, `domain.demote`, `domain.claim.types` | admin only for write ops |
| **DNS** | `dns.serverinfo`, `dns.zone.list/show/create/delete`, `dns.record.list/create/delete/update`, `dns.rorecords`, `dns.options`, `dns.cache.invalidate` | admin only for write ops |
| **GPO** | `gpo.list`, `gpo.show`, `gpo.create`, `gpo.delete`, `gpo.link/unlink`, `gpo.inherit.get/set`, `gpo.backup`, `gpo.restore`, `gpo.fetch` | similar |
| **FSMO** | `fsmo.show`, `fsmo.transfer`, `fsmo.seize` | admin only for transfer/seize |
| **DRS** | `drs.showrepl`, `drs.replicate`, `drs.uptodateness`, `drs.bind`, `drs.options` | similar |
| **Sites** | `site.list/show/create/delete`, `subnet.list/show/create/delete`, `subnet.set-site` | similar |
| **Schema** | `schema.attribute.show`, `schema.class.show` | read-only |
| **Delegation** | `delegation.add`, `delegation.remove`, `delegation.show` | admin only |
| **Service Accounts** | `service-account.list/show/create/delete`, `service-account.gmsa-members.add/remove/list` | admin only |
| **Auth Policies** | `auth.silo.list/show/create/delete`, `auth.silo.member.add/remove`, `auth.policy.list/show/create/delete` | admin only |
| **Misc** | `misc.dbcheck`, `misc.dbcheck.fix`, `misc.ntacl.get/set`, `misc.ntacl.sysvolreset`, `misc.testparm`, `misc.processes`, `misc.time`, `misc.spn.list/add/delete` | admin only for write ops |
| **Shell** | `shell.execute`, `shell.script`, `shell.script.file` | admin only |
| **Shell Project** | `shell.projet.create`, `shell.projet.run`, `shell.projet.upload`, `shell.projet.list/show/delete`, `shell.projet.download`, `shell.projet.abort`, `shell.projet.schedule.*`, `shell.projet.template.*`, `shell.projet.snapshot.*`, `shell.projet.audit`, `shell.projet.batch`, `shell.projet.file.*`, `shell.projet.owner`, `shell.projet.tags` | admin only |
| **Batch** | `batch.execute` | admin only |
| **AI** | `ai.assistant`, `ai.sdb`, `ai.agent`, `ai.chat.*`, `ai.config`, `ai.balance`, `ai.test`, `ai.info`, `ai.system.get/set`, `ai.exports.list/download`, `ai.schema`, `ai.pipeline.execute`, `ai.pipeline.templates` | admin only |
| **Chat** | `chat.room.list/show/create/update/delete`, `chat.member.add/remove/list`, `chat.message.send/edit/delete/list`, `chat.message.forward`, `chat.message.reaction.*`, `chat.message.star`, `chat.message.pin`, `chat.file.upload`, `chat.voice.upload`, `chat.attachment.download`, `chat.search`, `chat.schedule.*`, `chat.call.*`, `chat.read`, `chat.mute`, `chat.unread`, `chat.stats`, `chat.cleanup`, `chat.retention` | all authenticated users |
| **Management** | `mgmt.users.*`, `mgmt.keys.*`, `mgmt.roles.*`, `mgmt.permissions.assign/revoke`, `mgmt.stats`, `mgmt.audit.view`, `mgmt.2fa.*` | admin only |
| **Ban** | `ban.create`, `ban.unban`, `ban.list`, `ban.show`, `ban.delete` | **admin only** (not granted to operator/auditor) |
| **Webhooks** | `webhook.list/show/create/update/delete/test`, `webhook.events` | admin only |
| **Backup** | `backup.create/list/download/delete/restore` | admin only |
| **Dashboard** | `dashboard.full`, `dashboard.overview`, `dashboard.charts.*` | all read roles |
| **SDB** | `sdb.databases`, `sdb.full`, `sdb.info`, `sdb.query`, `sdb.select`, `sdb.show`, `sdb.script`, `sdb.synthesis`, `sdb.export.*` | admin only |
| **Report** | `report.generate`, `report.download` | admin only |
| **CFG** | `cfg.list`, `cfg.schema`, `cfg.raw`, `cfg.get`, `cfg.update`, `cfg.bulk`, `cfg.delete`, `cfg.disable`, `cfg.enable`, `cfg.reload`, `cfg.persist` | **admin only** |
| **Live** | `live.events` | all authenticated users |
| **Audit Export** | `mgmt.audit.export` | admin + auditor |
| **System** | `system.stats` | all authenticated users |
| **Tasks** | `task.list`, `task.show` | all authenticated users |
