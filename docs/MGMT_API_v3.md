# API v2.3 — Новые возможности (дополнение к v2.2)

> Краткий справочник по 13 новым подсистемам, добавленным в v2.3.
> Базовый mgmt-API (users/keys/roles) описан в `MGMT_API_v2.md`.

---

## Содержание

1. [AI: system prompt override](#1-ai-system-prompt-override)
2. [Webhooks](#2-webhooks)
3. [Per-user rate limiting](#3-per-user-rate-limiting)
4. [Audit log export](#4-audit-log-export)
5. [Bulk-операции AD-пользователей](#5-bulk-операции-ad-пользователей)
6. [WebSocket для shell](#6-websocket-для-shell)
7. [Файловый менеджер shell-projects](#7-файловый-менеджер-shell-projects)
8. [AES-256 шифрование env-переменных](#8-aes-256-шифрование-env-переменных)
9. [Backup/Restore API](#9-backuprestore-api)
10. [2FA / TOTP](#10-2fa--totp)
11. [Dashboard charts](#11-dashboard-charts)
12. [Live-обновления (WebSocket/SSE)](#12-live-обновления-websocketsse)
13. [Обновлённая документация](#13-обновлённая-документация)

---

## 1. AI: system prompt override

**Проблема:** Backend игнорировал поле `system` из `/ai/assistant` и `/ai/chat/{id}/stream`, использовал hardcoded ETL Constructor промпт.

**Решение v2.3:**

Приоритет промпта (от высокого к низкому):

1. `request.system` (per-message) → **полностью заменяет** hardcoded промпт
2. `chat.system_prompt` (session-level) → добавляется к hardcoded промпту
3. Hardcoded ETL Constructor промпт (по умолчанию)

**Изменено:**
- `app/routers/ai.py::stream_chat_message` — если `body.system` передан, он заменяет весь `chat_system`. Session-level промпт добавляется как "ADDITIONAL SESSION INSTRUCTIONS". Masking-блок всегда добавляется (security).
- `app/services/ai_service.py::resolve_system_prompt` — уже поддерживал override (без изменений).
- `/ai/sdb` — уже принимал `system` override через `AIRequest(mode='sdb')` (без изменений, проверено).

**Пример:**

```bash
# Кастомный промпт для чат-сообщения
curl -X POST 'http://localhost:8099/api/v1/ai/chat/{chat_id}/stream' \
  -H 'X-API-Key: <key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Найди всех заблокированных пользователей",
    "system": "Ты — ассистент безопасника. Отвечай кратко, без объяснений. Всегда показывай DN.",
    "use_agent": true,
    "max_steps": 5
  }'
```

---

## 2. Webhooks

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/webhooks` | Регистрация webhook |
| GET | `/api/v1/webhooks` | Список webhook'ов |
| GET | `/api/v1/webhooks/events` | Поддерживаемые типы событий |
| GET | `/api/v1/webhooks/{id}` | Детали webhook |
| PUT | `/api/v1/webhooks/{id}` | Обновление |
| DELETE | `/api/v1/webhooks/{id}` | Удаление |
| POST | `/api/v1/webhooks/{id}/test` | Отправить тестовое событие |

**События:**

| Категория | События |
|-----------|---------|
| Users | `user.created`, `user.updated`, `user.deleted`, `user.disabled`, `user.enabled`, `user.password_reset` |
| Keys | `key.created`, `key.rotated`, `key.disabled`, `key.deleted` |
| Roles | `role.created`, `role.updated`, `role.deleted`, `role.disabled`, `role.enabled` |
| Bans | `ban.created`, `ban.lifted` |
| Auth | `auth.login_success`, `auth.login_failure` |
| CFG | `cfg.updated`, `cfg.deleted` |
| Backup | `backup.created`, `backup.restored` |
| Wildcards | `user.*`, `key.*`, `role.*`, `ban.*`, `auth.*`, `cfg.*`, `backup.*`, `*` |

**Доставка:**
- HTTP POST с JSON-телом: `{event, payload, timestamp, webhook_id}`
- HMAC-SHA256 signature в заголовке `X-Webhook-Signature` (если задан `secret`)
- 3 попытки с backoff: 1s → 5s → 30s
- 4xx → retry не выполняется
- 10 последовательных неудач → webhook auto-disable

**Регистрация:**

```bash
curl -X POST http://localhost:8099/api/v1/webhooks \
  -H 'X-API-Key: <admin-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://hooks.slack.com/services/...",
    "events": ["user.created", "user.deleted", "ban.created"],
    "secret": "my-webhook-secret",
    "description": "Slack #security channel"
  }'
```

**Файлы:** `app/webhooks.py`, `app/routers/webhooks.py`, таблица `mgmt_webhooks`.

---

## 3. Per-user rate limiting

**Config (.env):**

```
SAMBA_RATE_LIMIT_ENABLED=true
SAMBA_RATE_LIMIT_AUTH_PER_MIN=10
SAMBA_RATE_LIMIT_READ_PER_MIN=100
SAMBA_RATE_LIMIT_WRITE_PER_MIN=60
SAMBA_RATE_LIMIT_SHELL_PROJET_PER_MIN=120
SAMBA_RATE_LIMIT_WINDOW_SECONDS=60
# v2.3:
SAMBA_RATE_LIMIT_PER_USER_PER_MIN=200   # 0 = отключено
```

**Поведение:**
- Существующие per-group лимиты (auth/read/write/shell_projet) работают как раньше.
- **Новое:** если `RATE_LIMIT_PER_USER_PER_MIN > 0`, каждый аутентифицированный пользователь получает дополнительный глобальный счётчик, который суммирует ВСЕ его запросы (кроме `/auth/*`).
- При превышении любого из лимитов возвращается `429 Too Many Requests` с заголовком `Retry-After`.
- Идентификатор пользователя берётся из `request.state.user_id` (устанавливается `combined_auth_middleware`).

**Файлы:** `app/middleware.py::RateLimitMiddleware`, `app/config.py`.

---

## 4. Audit log export

**Endpoint:**

```
GET /api/v1/mgmt/audit/export?format=csv&from=2026-01-01&to=2026-06-17&user_id=1&action=login_success&limit=50000
```

**Параметры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `format` | string | `csv` (по умолчанию) / `xlsx` / `json` |
| `from` | ISO date/datetime | Начало периода (включительно) |
| `to` | ISO date/datetime | Конец периода (включительно) |
| `user_id` | int | Фильтр по пользователю |
| `action` | string | Фильтр по действию |
| `endpoint` | string | Фильтр по endpoint (LIKE) |
| `limit` | int | Максимум строк (1-50000, по умолчанию 50000) |

**Вывод:**
- `csv` — UTF-8 с BOM (для Excel), заголовок: `id,timestamp,user_id,api_key_id,action,endpoint,ip_address,details`
- `xlsx` — Excel-книга с auto-fit колонками (требует `openpyxl`)
- `json` — JSON-массив с обёрткой `{status, total, data}`

**Права:** `audit.export` (выдан operator + auditor по умолчанию).

**Файлы:** `app/routers/audit_export.py`.

---

## 5. Bulk-операции AD-пользователей

**Endpoint:**

```
POST /api/v1/users/bulk
```

**Тело:**

```json
{
  "action": "create",
  "users": [
    {"username": "user1", "password": "Pass1!", "full_name": "User One", "email": "u1@example.com"},
    {"username": "user2", "password": "Pass2!", "full_name": "User Two"}
  ]
}
```

Или для других действий:

```json
{
  "action": "disable",
  "usernames": ["user1", "user2", "user3"]
}
```

**Поддерживаемые действия:**

| Action | Поля | Описание |
|--------|------|----------|
| `create` | `users[]` | Создать N пользователей |
| `delete` | `usernames[]` | Удалить N пользователей |
| `enable` | `usernames[]` | Включить N учётных записей |
| `disable` | `usernames[]` | Отключить N учётных записей |
| `unlock` | `usernames[]` | Разблокировать N учётных записей |
| `set_password` | `usernames[]`, `password` | Установить один пароль на N пользователей |
| `move` | `usernames[]`, `target_ou` | Переместить N пользователей в указанный OU |

**Ответ:**

```json
{
  "status": "ok",
  "data": {
    "action": "create",
    "total": 2,
    "ok": 1,
    "failed": 1,
    "results": [
      {"username": "user1", "ok": true, "error": ""},
      {"username": "user2", "ok": false, "error": "Already exists"}
    ]
  }
}
```

**Лимит:** 100 пользователей за вызов (через `SAMBA_BULK_MAX_ROWS`).

**Права:** `user.bulk`.

**Файлы:** `app/routers/bulk_users.py`.

---

## 6. WebSocket для shell

**Endpoint:** `WS /ws/shell`

**Протокол (JSON):**

Client → Server:

```json
{"type": "exec", "shell": "bash", "cmd": "ls -la /var/log/samba/", "timeout": 30, "sudo": false}
{"type": "stdin", "data": "yes\n"}
{"type": "kill"}
{"type": "ping"}
```

Server → Client:

```json
{"type": "start", "shell": "bash", "pid": 12345}
{"type": "stdout", "data": "total 8\n..."}
{"type": "stderr", "data": "..."}
{"type": "exit", "returncode": 0, "timed_out": false}
{"type": "error", "message": "..."}
{"type": "pong"}
```

**Особенности:**
- Поддерживаемые shells: `bash`, `python3`
- Блокировка опасных команд: `rm -rf /`, `mkfs.`, `dd if=`, fork bomb
- Только одна команда одновременно — для новой нужно `kill` или дождаться `exit`
- При таймауте: SIGTERM → ждём 2s → SIGKILL
- Реализовано на `asyncio.create_subprocess_exec` — real-time чтение stdout/stderr

**Пример (JavaScript):**

```javascript
const ws = new WebSocket('ws://localhost:8099/ws/shell');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'exec', shell: 'bash',
    cmd: 'tail -f /var/log/samba/log.samba', timeout: 60
  }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'stdout') console.log(msg.data);
  if (msg.type === 'exit') ws.close();
};
```

**Файлы:** `app/routers/shell_ws.py`.

---

## 7. Файловый менеджер shell-projects

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/shell/projet/{id}/files` | Список файлов (опционально `?sub=path/`) |
| GET | `/api/v1/shell/projet/{id}/files/{path:path}` | Скачать файл |
| PUT | `/api/v1/shell/projet/{id}/files/{path:path}` | Загрузить/перезаписать файл |
| DELETE | `/api/v1/shell/projet/{id}/files/{path:path}` | Удалить файл/директорию |
| POST | `/api/v1/shell/projet/{id}/mkdir/{path:path}` | Создать директорию |

**Безопасность:**
- Все пути sandboxed в workspace проекта
- `..` и абсолютные пути отклоняются
- Symlinks указывающие вне workspace отклоняются
- Отказ удалить корень workspace
- Лимит размера файла: 50 MB

**Пример:**

```bash
# Загрузить файл
curl -X PUT 'http://localhost:8099/api/v1/shell/projet/abc123def456/files/scripts/deploy.sh' \
  -H 'X-API-Key: <key>' \
  -F 'file=@./deploy.sh'

# Скачать файл
curl -X GET 'http://localhost:8099/api/v1/shell/projet/abc123def456/files/output/result.json' \
  -H 'X-API-Key: <key>' -o result.json

# Список файлов в подпапке
curl 'http://localhost:8099/api/v1/shell/projet/abc123def456/files?sub=scripts/' \
  -H 'X-API-Key: <key>'
```

**Права:** `shell.projet.files.list/read/write/delete` (read-права выданы operator/auditor).

**Файлы:** `app/routers/shell_projet_files.py`.

---

## 8. AES-256 шифрование env-переменных

**Config (.env):**

```
SAMBA_ENV_ENCRYPTION_ENABLED=true
# Мастер-ключ (если не задан, используется SHELL_PROJET_ENCRYPTION_KEY или JWT_SECRET_KEY)
SAMBA_SHELL_PROJET_ENCRYPTION_KEY=your-fernet-key-here
```

**Поведение:**
- При `ENV_ENCRYPTION_ENABLED=true` sensitive-ключи автоматически шифруются при записи в `.env`
- Чувствительными считаются ключи, содержащие: `PASSWORD`, `PASSWD`, `SECRET`, `API_KEY`, `APIKEY`, `TOKEN`, `PRIVATE_KEY`, `PRIVATEKEY`
- Зашифрованные значения помечаются префиксом `enc::` (например: `SAMBA_API_KEY=enc::gAAAAA...`)
- При чтении `.env` значения с `enc::` прозрачно расшифровываются
- Шифрование: Fernet (AES-128-CBC + HMAC-SHA256), ключ выводится через SHA-256 от мастер-ключа

**Использование через API:**

Через стандартный cfg-роутер. При `ENV_ENCRYPTION_ENABLED=true` запись:

```bash
curl -X PUT 'http://localhost:8099/api/v1/cfg/SAMBA_LDAP_PASSWORD' \
  -H 'X-API-Key: <admin-key>' \
  -d '{"value": "my-super-secret-password"}'
```

…сохранит в `.env` строку `SAMBA_LDAP_PASSWORD=enc::gAAAAABm...`.

**Использование в Python:**

```python
from app.env_encryption import encrypt_value, decrypt_value, is_sensitive_key

is_sensitive_key("SAMBA_API_KEY")         # True
is_sensitive_key("SAMBA_API_HOST")        # False

encrypted = encrypt_value("my-password")  # "enc::gAAAAA..."
decrypted = decrypt_value(encrypted)      # "my-password"
```

**Файлы:** `app/env_encryption.py`.

---

## 9. Backup/Restore API

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/backup` | Создать backup (sam.ldb + mgmt.sql) |
| GET | `/api/v1/backup` | Список backups |
| GET | `/api/v1/backup/{filename}` | Скачать backup |
| DELETE | `/api/v1/backup/{filename}` | Удалить backup |
| POST | `/api/v1/backup/restore` | Восстановить из backup |

**Создание backup:**

```bash
curl -X POST http://localhost:8099/api/v1/backup \
  -H 'X-API-Key: <admin-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "include_sam": true,
    "include_mgmt": true,
    "description": "Pre-upgrade snapshot"
  }'
```

**Ответ:**

```json
{
  "status": "ok",
  "data": {
    "filename": "backup-20260617-113000.tar.gz",
    "size_bytes": 5242880,
    "path": "/var/lib/webadc/backups/backup-20260617-113000.tar.gz",
    "meta": {
      "timestamp": "20260617-113000",
      "files": {
        "sam.ldb": {"size_bytes": 4194304, "source": "/var/lib/samba/private/sam.ldb"},
        "mgmt.sql": {"size_bytes": 1048576}
      }
    }
  }
}
```

**Восстановление:**

```bash
# Остановить Samba (требуется для sam.ldb restore)
systemctl stop samba

# Восстановить
curl -X POST http://localhost:8099/api/v1/backup/restore \
  -H 'X-API-Key: <admin-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "backup-20260617-113000.tar.gz",
    "restore_sam": true,
    "restore_mgmt": true
  }'

# Перезапустить Samba
systemctl start samba
```

**Безопасность:**
- Restore sam.ldb блокируется, если сервис Samba запущен (HTTP 409)
- Перед overwrite текущий sam.ldb сохраняется как `.ldb.bak`
- Backup-файлы хранятся в `SAMBA_BACKUP_DIR` (по умолчанию `/var/lib/webadc/backups/`)
- Имена файлов sanitizятся (только alphanum + `-.`)

**Права:** `backup.create/list/download/delete/restore` (admin-only, кроме list/download).

**Файлы:** `app/routers/backup.py`.

---

## 10. 2FA / TOTP

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/auth/2fa/setup` | Сгенерировать TOTP-секрет (показать QR) |
| POST | `/api/v1/auth/2fa/enable` | Подтвердить кодом и включить 2FA |
| POST | `/api/v1/auth/2fa/disable` | Отключить 2FA (требует текущий пароль) |
| GET | `/api/v1/auth/2fa/status` | Проверить, включена ли 2FA |
| POST | `/api/v1/auth/login/verify` | Шаг 2 логина: проверить TOTP-код |

**Логин с 2FA (двухшаговый):**

Шаг 1 — обычный логин. Если 2FA включена, ответ:

```json
{
  "totp_required": true,
  "temp_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 300
}
```

`temp_token` действителен 5 минут, используется **только** для `/auth/login/verify`.

Шаг 2 — верификация кода:

```bash
curl -X POST http://localhost:8099/api/v1/auth/login/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "temp_token": "eyJhbGci...",
    "totp_code": "123456"
  }'
```

При успехе возвращает стандартный `{access_token, refresh_token, role, permissions, ...}`.

**Настройка 2FA:**

```bash
# 1. Сгенерировать секрет (возвращает secret + otpauth:// URI для QR-кода)
curl -X POST http://localhost:8099/api/v1/auth/2fa/setup \
  -H 'X-API-Key: <key>'

# 2. Пользователь сканирует QR в Google Authenticator
# 3. Подтвердить кодом из приложения
curl -X POST http://localhost:8099/api/v1/auth/2fa/enable \
  -H 'X-API-Key: <key>' \
  -d '{"secret": "JBSWY3DPEHPK3PXP", "code": "123456"}'
```

**Хранение:**
- TOTP-секрет хранится зашифрованным (Fernet) в колонке `mgmt_users.totp_secret`
- Флаг `mgmt_users.totp_enabled` включает 2FA-проверку при логине
- Алгоритм: RFC 6238, HMAC-SHA1, 30s шаг, 6 цифр, окно ±1 step
- Совместим с Google Authenticator, Authy, 1Password, Microsoft Authenticator

**Файлы:** `app/totp.py`, `app/routers/twofa.py`, миграция в `mgmt_db.py`.

---

## 11. Dashboard charts

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/dashboard/charts/login-activity?days=30&freq=day` | Активность входов по дням/часам |
| GET | `/api/v1/dashboard/charts/top-groups?limit=10` | Топ-N групп по размеру |
| GET | `/api/v1/dashboard/charts/os-distribution` | Распределение ОС компьютеров |
| GET | `/api/v1/dashboard/charts/users-by-ou` | Пользователи по OU |
| GET | `/api/v1/dashboard/charts/recent-events?limit=20` | Последние события аудита |
| GET | `/api/v1/dashboard/charts/mgmt-summary` | Сводка mgmt (counts) |

**Пример — login-activity:**

```json
{
  "status": "ok",
  "freq": "day",
  "days": 30,
  "data": [
    {"bucket": "2026-05-18", "success": 45, "failure": 2},
    {"bucket": "2026-05-19", "success": 38, "failure": 5},
    {"bucket": "2026-05-20", "success": 52, "failure": 1}
  ]
}
```

Готово для recharts:

```jsx
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>
    <XAxis dataKey="bucket" />
    <YAxis />
    <Tooltip />
    <Legend />
    <Line type="monotone" dataKey="success" stroke="#10b981" name="Успешные" />
    <Line type="monotone" dataKey="failure" stroke="#ef4444" name="Неудачные" />
  </LineChart>
</ResponsiveContainer>
```

**Пример — top-groups:**

```json
{
  "status": "ok",
  "data": [
    {"name": "Domain Users", "member_count": 245},
    {"name": "Domain Admins", "member_count": 5},
    {"name": "IT", "member_count": 18}
  ]
}
```

**Пример — os-distribution:**

```json
{
  "status": "ok",
  "total": 87,
  "data": [
    {"os": "Windows 10 Pro", "count": 42},
    {"os": "Windows 11 Pro", "count": 28},
    {"os": "Ubuntu 22.04 LTS", "count": 12},
    {"os": "Unknown", "count": 5}
  ]
}
```

**Права:** `dashboard.charts` (выдан operator/auditor).

**Файлы:** `app/routers/dashboard_charts.py`.

---

## 12. Live-обновления (WebSocket/SSE)

**Endpoints:**

| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/live/events?types=mgmt.user.*` | SSE-стрим событий |
| WS | `/ws/live` | WebSocket-эквивалент |

**SSE-формат:**

```
data: {"type": "stream.open", "payload": {}}

data: {"type": "mgmt.user.created", "payload": {"user": {...}}, "timestamp": 1718600000.0}

: keepalive

data: {"type": "mgmt.key.deleted", "payload": {"key": {...}}, "timestamp": 1718600010.0}
```

**Типы событий (pub/sub bus):**

| Категория | События |
|-----------|---------|
| mgmt.user | `mgmt.user.created`, `mgmt.user.updated`, `mgmt.user.deleted`, `mgmt.user.enabled`, `mgmt.user.disabled` |
| mgmt.key | `mgmt.key.created`, `mgmt.key.rotated`, `mgmt.key.deleted` |
| mgmt.role | `mgmt.role.created`, `mgmt.role.updated`, `mgmt.role.deleted`, `mgmt.role.disabled`, `mgmt.role.enabled` |
| auth | `auth.login`, `auth.logout` |
| ban | `ban.created`, `ban.lifted` |
| dashboard | `dashboard.refresh` (сигнал перечитать данные) |

**Пример (JavaScript, EventSource):**

```javascript
const es = new EventSource('/api/v1/live/events?types=mgmt.user.*,mgmt.key.*', {
  withCredentials: true,
});
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log('Live event:', event.type, event.payload);
  if (event.type === 'mgmt.user.created') {
    // Обновить таблицу пользователей без перезагрузки
    refreshUsersTable();
  }
};
es.onerror = () => {
  // EventSource автоматически переподключится
};
```

**Пример (WebSocket):**

```javascript
const ws = new WebSocket('ws://localhost:8099/ws/live');
ws.onopen = () => {
  ws.send(JSON.stringify({types: ['mgmt.user.*', 'mgmt.key.*']}));
};
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  console.log(event.type, event.payload);
};
```

**Архитектура:**
- In-memory pub/sub через `asyncio.Queue` (одна на подписчика)
- При переполнении очереди (>200 сообщений) старое сообщение удаляется, новое помещается (drop-oldest)
- Keepalive каждые 15s (SSE: `: keepalive` комментарий, WS: `{"type":"ping"}`)
- Auth: SSE требует `X-API-Key` заголовок (Basic/Bearer), WS — через gateway

**Файлы:** `app/routers/live.py`.

---

## 13. Обновлённая документация

| Файл | Что добавлено |
|------|---------------|
| `docs/MGMT_API_v3.md` | Этот файл — справочник по 13 новым подсистемам |
| `docs/PERMISSIONS.md` | +29 новых разрешений (webhook.*, backup.*, audit.export, user.bulk, auth.2fa.*, dashboard.charts, live.events, shell.projet.files.*, cfg.encrypt) |
| `docs/ds_auth.md` | Команды для управления webhooks/backup/2FA через CLI |

**Всего разрешений:** 299 (было 274 в v2.2, 252 в v2.1).

---

## Сводка изменений v2.3

### Новые файлы (10)

| Файл | Назначение |
|------|------------|
| `app/webhooks.py` | Webhook registration + event dispatcher (background worker, HMAC signing) |
| `app/totp.py` | RFC 6238 TOTP (Google Authenticator compatible) + DB-backed per-user state |
| `app/env_encryption.py` | AES-256 (Fernet) for sensitive .env values |
| `app/routers/webhooks.py` | Webhook REST endpoints |
| `app/routers/backup.py` | Backup/Restore (sam.ldb + mgmt DB) |
| `app/routers/bulk_users.py` | Bulk operations on AD users |
| `app/routers/shell_projet_files.py` | File manager for shell-project workspaces |
| `app/routers/audit_export.py` | Audit log CSV/XLSX/JSON export |
| `app/routers/dashboard_charts.py` | Aggregated data for dashboard charts |
| `app/routers/live.py` | SSE + WebSocket live events |
| `app/routers/twofa.py` | 2FA setup/enable/disable/verify |
| `app/routers/shell_ws.py` | WebSocket real-time shell execution |

### Изменённые файлы (5)

| Файл | Что изменилось |
|------|----------------|
| `app/routers/ai.py` | `body.system` теперь полностью заменяет hardcoded ETL промпт (вместо дополнения) |
| `app/routers/mgmt.py` | `create_user` эмитит webhook + live event |
| `app/middleware.py` | `RateLimitMiddleware` принимает `per_user_limit`; при `>0` считает per-user global counter |
| `app/config.py` | +3 новых settings: `RATE_LIMIT_PER_USER_PER_MIN`, `BACKUP_DIR`, `BULK_MAX_ROWS`, `ENV_ENCRYPTION_ENABLED` |
| `app/permissions.py` | +29 новых прав, +path-rules для всех новых endpoints |
| `app/main.py` | +9 новых роутеров, +webhooks/totp schema init, +`/ws/live` WebSocket |

### Новые .env переменные

```bash
# v2.3
SAMBA_RATE_LIMIT_PER_USER_PER_MIN=0          # 0 = disabled
SAMBA_BACKUP_DIR=/var/lib/webadc/backups
SAMBA_BULK_MAX_ROWS=100
SAMBA_ENV_ENCRYPTION_ENABLED=false           # true = encrypt sensitive env at rest
```

### Новые разрешения (29)

```
webhook.list/create/show/update/delete/test
backup.create/list/download/delete/restore
user.bulk
audit.export
auth.2fa.setup/enable/disable/status/verify
dashboard.charts
live.events
shell.projet.files.list/read/write/delete
cfg.encrypt
```

### Новые endpoints (29)

```
# Webhooks (7)
POST   /api/v1/webhooks
GET    /api/v1/webhooks
GET    /api/v1/webhooks/events
GET    /api/v1/webhooks/{id}
PUT    /api/v1/webhooks/{id}
DELETE /api/v1/webhooks/{id}
POST   /api/v1/webhooks/{id}/test

# Backup (5)
POST   /api/v1/backup
GET    /api/v1/backup
GET    /api/v1/backup/{filename}
DELETE /api/v1/backup/{filename}
POST   /api/v1/backup/restore

# Bulk (1)
POST   /api/v1/users/bulk

# Audit export (1)
GET    /api/v1/mgmt/audit/export

# 2FA (5)
POST   /api/v1/auth/2fa/setup
POST   /api/v1/auth/2fa/enable
POST   /api/v1/auth/2fa/disable
GET    /api/v1/auth/2fa/status
POST   /api/v1/auth/login/verify

# Dashboard charts (6)
GET    /api/v1/dashboard/charts/login-activity
GET    /api/v1/dashboard/charts/top-groups
GET    /api/v1/dashboard/charts/os-distribution
GET    /api/v1/dashboard/charts/users-by-ou
GET    /api/v1/dashboard/charts/recent-events
GET    /api/v1/dashboard/charts/mgmt-summary

# Live (1)
GET    /api/v1/live/events

# Shell project files (5)
GET    /api/v1/shell/projet/{id}/files
GET    /api/v1/shell/projet/{id}/files/{path}
PUT    /api/v1/shell/projet/{id}/files/{path}
DELETE /api/v1/shell/projet/{id}/files/{path}
POST   /api/v1/shell/projet/{id}/mkdir/{path}

# WebSocket (2)
WS     /ws/shell
WS     /ws/live
```

---

## План развёртывания v2.3

1. **Распаковать `fix2.zip`** поверх существующего проекта.
2. **Установить новые Python-зависимости** (если ещё не установлены):
   ```bash
   pip install pyjwt cryptography openpyxl
   ```
3. **Прогнать миграции** — выполняются автоматически при старте сервера:
   - `mgmt_users.totp_secret TEXT` + `totp_enabled BOOLEAN`
   - Новая таблица `mgmt_webhooks`
4. **Настроить .env** (опционально):
   ```bash
   SAMBA_RATE_LIMIT_PER_USER_PER_MIN=200
   SAMBA_ENV_ENCRYPTION_ENABLED=true
   ```
5. **Перезапустить сервис:**
   ```bash
   systemctl restart webadc
   ```
6. **Проверить работоспособность:**
   ```bash
   # Webhooks
   curl http://localhost:8099/api/v1/webhooks -H 'X-API-Key: <admin>'
   # Backup
   curl -X POST http://localhost:8099/api/v1/backup -H 'X-API-Key: <admin>' -d '{}'
   # Dashboard charts
   curl http://localhost:8099/api/v1/dashboard/charts/login-activity -H 'X-API-Key: <admin>'
   # 2FA setup
   curl -X POST http://localhost:8099/api/v1/auth/2fa/setup -H 'X-API-Key: <admin>'
   ```
