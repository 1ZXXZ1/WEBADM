# Management API — Полный справочник (v2.3.5)

> Базовый URL: `https://<host>:8099`
> Аутентификация: `X-API-Key: <admin-key>` или `Authorization: Bearer <jwt>`
> Все endpoints требуют роль `admin` (кроме 2FA self-service)

---

## Содержание

1. [Users — Управление пользователями](#1-users)
2. [API Keys — Управление ключами](#2-api-keys)
3. [Roles — Управление ролями](#3-roles)
4. [Permissions — Управление правами](#4-permissions)
5. [Stats — Статистика](#5-stats)
6. [Audit Log — Журнал аудита](#6-audit-log)
7. [Audit Export — Экспорт аудита](#7-audit-export)
8. [2FA — Двухфакторная аутентификация](#8-2fa)
9. [2FA Admin — Управление 2FA других пользователей](#9-2fa-admin)
10. [Webhooks — Вебхуки](#10-webhooks)
11. [Backup — Резервное копирование](#11-backup)
12. [Bulk Users — Массовые операции с AD-пользователями](#12-bulk-users)

---

## 1. Users

### GET /api/v1/mgmt/users
**Список пользователей с фильтрацией и пагинацией.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/users?role=admin&is_active=true&search=ivan&offset=0&limit=100" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Query-параметры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `role` | string | Фильтр по роли |
| `is_active` | bool | Фильтр по активности |
| `search` | string | Поиск по username/full_name/email (ILIKE) |
| `offset` | int | Смещение (по умолчанию 0) |
| `limit` | int | Размер страницы (1-500, по умолчанию 100) |

**Ответ:**
```json
{
  "status": "ok",
  "data": [
    {
      "id": 1, "username": "admin", "full_name": "Default Administrator",
      "email": "", "role": "admin", "is_active": 1, "weight": 0,
      "last_login_at": "2026-06-17T19:34:45+00:00", "login_count": 15,
      "created_at": "2026-06-16T10:00:00+00:00", "updated_at": "2026-06-17T19:34:45+00:00"
    }
  ]
}
```

---

### POST /api/v1/mgmt/users
**Создать пользователя.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operator1",
    "password": "SecurePass123!",
    "role": "operator",
    "full_name": "Ivan Ivanov",
    "email": "ivan@example.com",
    "weight": 50
  }'
```

**Тело:**

| Поле | Тип | Описание |
|------|-----|----------|
| `username` | string | Логин (1-64, уникальный) |
| `password` | string | Пароль (≥1 символ) |
| `role` | string | Роль (по умолчанию "operator") |
| `full_name` | string | Полное имя |
| `email` | string | Email |
| `weight` | int | Приоритет (-1000..1000, по умолчанию 0) |

**Ошибки:** `409 Username already exists`, `400 Role '...' does not exist`

---

### GET /api/v1/mgmt/users/{user_id}
**Карточка пользователя.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/users/5" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### PUT /api/v1/mgmt/users/{user_id}
**Обновить пользователя.** Передавайте только изменяемые поля.

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/mgmt/users/5" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "admin",
    "weight": 100,
    "is_active": false
  }'
```

**Поля:** `username`, `password`, `role`, `full_name`, `email`, `is_active`, `weight`

---

### DELETE /api/v1/mgmt/users/{user_id}
**Удалить пользователя (мягко или жёстко).**

```bash
# Мягкое удаление (is_active=FALSE, ключи деактивируются)
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/mgmt/users/5" \
  -H "X-API-Key: $ADMIN_KEY"

# Жёсткое удаление (CASCADE, безвозвратно)
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/mgmt/users/5?hard=true" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Защита:** Жёсткое удаление блокируется для последнего активного admin.

---

### POST /api/v1/mgmt/users/{user_id}/enable
**Включить пользователя.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/enable" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Ответ:** `200` — `"User #5 (operator1) enabled"` или `"is already active (no change)"`

---

### POST /api/v1/mgmt/users/{user_id}/disable
**Отключить пользователя + все его API-ключи.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/disable" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/users/{user_id}/purge
**Безвозвратно удалить (CASCADE ключей).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/purge" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Защита:** Блокирует удаление последнего активного admin.

---

### POST /api/v1/mgmt/users/{user_id}/reset-password
**Сброс пароля.**

```bash
# Своим паролем
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/reset-password" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"new_password": "NewPass123!"}'

# Случайный пароль (сервер генерирует и возвращает)
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/reset-password" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Ответ (случайный пароль):**
```json
{
  "status": "ok",
  "message": "Password for user 5 reset",
  "data": {"new_password": "xY9_aBcdEfGhIjKlMnOp"}
}
```

---

### GET /api/v1/mgmt/users/{user_id}/keys
**Список API-ключей пользователя.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/users/5/keys?include_inactive=true" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/users/bulk
**Массовая операция над пользователями.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/bulk" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 5], "action": "disable"}'
```

**action:** `enable` | `disable` | `purge`

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "action": "disable", "ok": [1, 2], "failed": [{"id": 5, "error": "not found"}]
  }
}
```

---

## 2. API Keys

### GET /api/v1/mgmt/keys
**Список API-ключей.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/keys?user_id=5&is_active=true&search=ci&offset=0&limit=100" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/keys
**Создать API-ключ.** Ключ возвращается **только один раз**.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 5,
    "name": "ci-key",
    "role": "operator",
    "expires_days": 90,
    "weight": 50,
    "description": "CI/CD pipeline token"
  }'
```

**Тело:**

| Поле | Тип | Описание |
|------|-----|----------|
| `user_id` | int | ID пользователя-владельца |
| `name` | string | Название ключа |
| `role` | string | Роль ключа (по умолчанию "operator") |
| `expires_days` | int? | Дней до истечения (≥1, или null = без лимита) |
| `weight` | int | Приоритет (-1000..1000, по умолчанию 0) |
| `description` | string | Описание |

**Ответ:**
```json
{
  "status": "ok",
  "data": {"key": "WEBADC-KN7MB-CDV37-L9TJC"}
}
```

**Формат ключа:** `WEBADC-XXXXX-XXXXX-XXXXX` (алфавит без I/O/0/1)

---

### GET /api/v1/mgmt/keys/{key_id}
**Детали ключа.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/keys/3" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### PUT /api/v1/mgmt/keys/{key_id}
**Обновить ключ.**

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/mgmt/keys/3" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-name", "role": "admin", "weight": 100}'
```

**Поля:** `name`, `role`, `is_active`, `expires_days` (≥1), `weight`, `description`

---

### DELETE /api/v1/mgmt/keys/{key_id}
**Удалить ключ.**

```bash
# Мягко (деактивировать)
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/mgmt/keys/3" \
  -H "X-API-Key: $ADMIN_KEY"

# Жёстко (безвозвратно)
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/mgmt/keys/3?hard=true" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/keys/{key_id}/rotate
**Ротация: старый деактивируется, новый создаётся с теми же настройками.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys/3/rotate" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Ответ:** `{"status":"ok","data":{"key":"WEBADC-XXXXX-XXXXX-XXXXX"}}`

---

### POST /api/v1/mgmt/keys/{key_id}/enable
**Включить ключ.** Требует, чтобы пользователь-владелец был активен.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys/3/enable" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/keys/{key_id}/disable
**Отключить ключ (мягко).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys/3/disable" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/keys/{key_id}/purge
**Безвозвратно удалить ключ.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys/3/purge" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/keys/bulk
**Массовая операция над ключами.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/keys/bulk" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3], "action": "disable"}'
```

---

## 3. Roles

### GET /api/v1/mgmt/roles
**Список всех ролей.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/roles?include_disabled=true" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/roles
**Создать роль.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/roles" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dns-admin",
    "description": "Manage DNS only",
    "permissions": ["dns.zonelist", "dns.zonecreate", "dns.zonedelete"],
    "weight": 100
  }'
```

---

### GET /api/v1/mgmt/roles/{role_name}
**Детали роли со списком прав.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/roles/admin" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### PUT /api/v1/mgmt/roles/{role_name}
**Обновить роль.** Поддерживает переименование (`name`).

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description", "weight": 200}'
```

**Поля:** `name`, `description`, `permissions`, `weight`, `is_active`

---

### DELETE /api/v1/mgmt/roles/{role_name}
**Удалить роль (безвозвратно).** Блокируется, если есть активные привязки.

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/roles/{role_name}/enable
**Включить роль.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin/enable" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/roles/{role_name}/disable
**Отключить роль.** Все API-ключи с этой ролью отклоняются при валидации.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin/disable" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Защита:** Роль `admin` нельзя отключить.

---

### POST /api/v1/mgmt/roles/{role_name}/gen-key
**Сгенерировать API-ключ под роль.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin/gen-key" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id": 5, "name": "dns-ci-key", "expires_days": 365}'
```

**Ответ:** `{"status":"ok","data":{"key":"WEBADC-XXXXX-XXXXX-XXXXX","role":"dns-admin"}}`

---

### GET /api/v1/mgmt/roles/{role_name}/users
**Список пользователей с этой ролью.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin/users?include_inactive=false" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/mgmt/roles/{role_name}/keys
**Список API-ключей с этой ролью.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/roles/dns-admin/keys?include_inactive=false" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

## 4. Permissions

### GET /api/v1/mgmt/permissions
**Список всех доступных прав (305 штук).**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/permissions" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/permissions/assign
**Добавить права к роли (merge, не заменяет).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/permissions/assign" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role_name": "operator", "permissions": ["user.create", "user.delete"]}'
```

---

### POST /api/v1/mgmt/permissions/revoke
**Отозвать права у роли.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/permissions/revoke" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role_name": "operator", "permissions": ["user.delete"]}'
```

---

## 5. Stats

### GET /api/v1/mgmt/stats
**Сводная статистика для dashboard.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/stats" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "users": {"total": 8, "active": 4},
    "api_keys": {"total": 3, "active": 2, "soon_to_expire_7d": 1},
    "roles": {"total": 6, "active": 4},
    "audit_log": {"total": 954},
    "auth": {
      "failed_logins_24h": 3,
      "successful_logins_24h": 12
    },
    "roles_breakdown": [
      {"name": "admin", "is_active": 1, "users": 3, "keys": 0},
      {"name": "operator", "is_active": 1, "users": 0, "keys": 1}
    ]
  }
}
```

---

## 6. Audit Log

### GET /api/v1/mgmt/audit
**Журнал аудита с rich fields.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/audit?limit=5&offset=0" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Фильтры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `user_id` | int | По пользователю |
| `action` | string | По действию (точное совпадение) |
| `endpoint` | string | По endpoint (LIKE prefix) |
| `event_type` | string | По типу события (`user.created`, `auth.login_failure`) |
| `auth_method` | string | `jwt` / `api_key` / `static_api_key` / `credentials` |
| `ip_address` | string | По IP (точное совпадение) |
| `offset` | int | Смещение |
| `limit` | int | Размер страницы (1-500) |

**Примеры фильтрации:**
```bash
# Только создания пользователей
curl -k -s ".../api/v1/mgmt/audit?event_type=user.created&limit=20" -H "X-API-Key: $K"

# Только запросы через JWT
curl -k -s ".../api/v1/mgmt/audit?auth_method=jwt&limit=20" -H "X-API-Key: $K"

# Только логины
curl -k -s ".../api/v1/mgmt/audit?auth_method=credentials&limit=20" -H "X-API-Key: $K"

# Только с конкретного IP
curl -k -s ".../api/v1/mgmt/audit?ip_address=192.168.104.209&limit=50" -H "X-API-Key: $K"

# Только неудачные логины
curl -k -s ".../api/v1/mgmt/audit?event_type=auth.login_failure&limit=20" -H "X-API-Key: $K"
```

**Ответ (каждая запись):**
```json
{
  "id": 954,
  "user_id": 7,
  "api_key_id": null,
  "action": "GET /api/v1/mgmt/audit",
  "endpoint": "/api/v1/mgmt/audit",
  "ip_address": "136.169.171.144",
  "timestamp": "2026-06-17T19:52:37.739908+00:00",
  "details": null,
  "username": "su",
  "method": "GET",
  "status_code": 200,
  "duration_ms": 9,
  "user_agent": "Mozilla/5.0 ... Edg/149.0.0.0",
  "request_body": "",
  "auth_method": "jwt",
  "event_type": ""
}
```

**Semantic event types:**
- `user.created`, `user.updated`, `user.disabled`, `user.enabled`, `user.deleted`
- `key.created`, `key.disabled`, `key.enabled`, `key.deleted`
- `role.created`, `role.updated`, `role.disabled`, `role.enabled`, `role.deleted`
- `auth.login_success`, `auth.login_failure`

---

## 7. Audit Export

### GET /api/v1/mgmt/audit/export
**Экспорт аудита в CSV / XLSX / JSON.**

```bash
# CSV
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/audit/export?format=csv&from=2026-06-01&to=2026-06-17&limit=50000" \
  -H "X-API-Key: $ADMIN_KEY" -o audit.csv

# XLSX (требует openpyxl)
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/audit/export?format=xlsx&from=2026-06-01&to=2026-06-17" \
  -H "X-API-Key: $ADMIN_KEY" -o audit.xlsx

# JSON
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/audit/export?format=json&event_type=user.created" \
  -H "X-API-Key: $ADMIN_KEY" -o audit.json
```

**Параметры:** `format` (csv/xlsx/json), `from`, `to`, `user_id`, `action`, `endpoint`, `event_type`, `auth_method`, `ip_address`, `limit`

**CSV columns:** ID, Timestamp, Username, User ID, API Key ID, Auth Method, HTTP Method, Action, Endpoint, Status, Duration ms, IP Address, User-Agent, Event Type, Request Body, Details

---

## 8. 2FA — Двухфакторная аутентификация (self-service)

> Любой аутентифицированный пользователь управляет **своей** 2FA

### POST /api/v1/auth/2fa/setup
**Сгенерировать TOTP-секрет.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/auth/2fa/setup" \
  -H "Authorization: Bearer $JWT"
```

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "otpauth_uri": "otpauth://totp/SambaAD:admin?secret=...",
    "username": "admin"
  }
}
```

---

### POST /api/v1/auth/2fa/enable
**Включить 2FA (требует код из приложения).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/auth/2fa/enable" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"secret": "JBSWY3DPEHPK3PXP", "code": "123456"}'
```

---

### POST /api/v1/auth/2fa/disable
**Отключить 2FA (требует текущий пароль).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/auth/2fa/disable" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password"}'
```

---

### GET /api/v1/auth/2fa/status
**Проверить, включена ли 2FA.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/auth/2fa/status" \
  -H "Authorization: Bearer $JWT"
```

---

### POST /api/v1/auth/login/verify
**Шаг 2 логина с 2FA (публичный endpoint).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/auth/login/verify" \
  -H "Content-Type: application/json" \
  -d '{"temp_token": "eyJ...", "totp_code": "234567"}'
```

**Ответ:** Стандартный `{access_token, refresh_token, role, permissions, ...}`

---

## 9. 2FA Admin

> Только admin. Управление 2FA **других** пользователей.

### GET /api/v1/mgmt/users/{user_id}/2fa/status
```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/status" \
  -H "X-API-Key: $ADMIN_KEY"
```

**Ответ:** `{"user_id": 5, "username": "operator1", "enabled": false, "has_secret": false}`

---

### POST /api/v1/mgmt/users/{user_id}/2fa/setup
**Сгенерировать секрет для пользователя.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/setup" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/users/{user_id}/2fa/enable
**Включить 2FA для пользователя.**

```bash
# С кодом (рекомендуется)
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/enable" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"secret": "JBSWY3DPEHPK3PXP", "code": "123456"}'

# Принудительно (RECOVERY — без проверки кода)
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/enable?force=true" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"secret": "JBSWY3DPEHPK3PXP"}'
```

---

### POST /api/v1/mgmt/users/{user_id}/2fa/disable
**Отключить 2FA (без пароля, admin override). Секрет сохраняется.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/disable" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/mgmt/users/{user_id}/2fa/reset
**Полный сброс (секрет удаляется).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/mgmt/users/5/2fa/reset" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/mgmt/2fa/enabled
**Список всех с включённой 2FA.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/2fa/enabled" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/mgmt/2fa/disabled
**Список с секретом, но 2FA выключена.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/mgmt/2fa/disabled" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

## 10. Webhooks

### POST /api/v1/webhooks
**Регистрация webhook.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/webhooks" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.slack.com/services/...",
    "events": ["user.created", "user.deleted", "ban.created"],
    "secret": "my-webhook-secret",
    "description": "Slack #security"
  }'
```

---

### GET /api/v1/webhooks
**Список webhook'ов.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/webhooks" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/webhooks/{id}
**Детали webhook.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/webhooks/1" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### PUT /api/v1/webhooks/{id}
**Обновить webhook.**

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/webhooks/1" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"events": ["user.*", "key.*"], "is_active": false}'
```

---

### DELETE /api/v1/webhooks/{id}
**Удалить webhook.**

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/webhooks/1" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/webhooks/{id}/test
**Отправить тестовое событие.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/webhooks/1/test" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/webhooks/events
**Список поддерживаемых событий.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/webhooks/events" \
  -H "X-API-Key: $ADMIN_KEY"
```

**События:** `user.created/updated/deleted/disabled/enabled/password_reset`, `key.created/rotated/disabled/deleted`, `role.created/updated/deleted/disabled/enabled`, `ban.created/lifted`, `auth.login_success/login_failure`, `cfg.updated/deleted`, `backup.created/restored`, wildcards: `user.*`, `key.*`, `role.*`, `*`

---

## 11. Backup

### POST /api/v1/backup
**Создать backup (sam.ldb + mgmt DB).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/backup" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"include_sam": true, "include_mgmt": true, "description": "Pre-upgrade"}'
```

---

### GET /api/v1/backup
**Список backups.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/backup" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### GET /api/v1/backup/{filename}
**Скачать backup.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/backup/backup-20260617-113000.tar.gz" \
  -H "X-API-Key: $ADMIN_KEY" -o backup.tar.gz
```

---

### DELETE /api/v1/backup/{filename}
**Удалить backup.**

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/backup/backup-20260617-113000.tar.gz" \
  -H "X-API-Key: $ADMIN_KEY"
```

---

### POST /api/v1/backup/restore
**Восстановить из backup.** Требует остановленную Samba.

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/backup/restore" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "backup-20260617-113000.tar.gz", "restore_sam": true, "restore_mgmt": true}'
```

---

## 12. Bulk Users (AD-side)

### POST /api/v1/users/bulk
**Массовые операции с AD-пользователями (Samba AD, не mgmt).**

```bash
# Создать N пользователей
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/users/bulk" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "users": [
      {"username": "user1", "password": "Pass1!", "full_name": "User One"},
      {"username": "user2", "password": "Pass2!", "full_name": "User Two"}
    ]
  }'

# Отключить N пользователей
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/users/bulk" \
  -H "X-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "disable", "usernames": ["user1", "user2", "user3"]}'
```

**Actions:** `create`, `delete`, `enable`, `disable`, `unlock`, `set_password` (требует `password`), `move` (требует `target_ou`)

**Лимит:** 100 пользователей за вызов (`SAMBA_BULK_MAX_ROWS`)

---

## Сводная таблица — все endpoints

### Users (11 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/users` | Список |
| POST | `/api/v1/mgmt/users` | Создать |
| GET | `/api/v1/mgmt/users/{id}` | Карточка |
| PUT | `/api/v1/mgmt/users/{id}` | Обновить |
| DELETE | `/api/v1/mgmt/users/{id}?hard=` | Удалить |
| POST | `/api/v1/mgmt/users/{id}/enable` | Включить |
| POST | `/api/v1/mgmt/users/{id}/disable` | Отключить |
| POST | `/api/v1/mgmt/users/{id}/purge` | Удалить безвозвратно |
| POST | `/api/v1/mgmt/users/{id}/reset-password` | Сброс пароля |
| GET | `/api/v1/mgmt/users/{id}/keys` | Ключи пользователя |
| POST | `/api/v1/mgmt/users/bulk` | Массовые операции |

### API Keys (10 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/keys` | Список |
| POST | `/api/v1/mgmt/keys` | Создать (формат `WEBADC-XXXXX-XXXXX-XXXXX`) |
| GET | `/api/v1/mgmt/keys/{id}` | Детали |
| PUT | `/api/v1/mgmt/keys/{id}` | Обновить |
| DELETE | `/api/v1/mgmt/keys/{id}?hard=` | Удалить |
| POST | `/api/v1/mgmt/keys/{id}/rotate` | Ротация |
| POST | `/api/v1/mgmt/keys/{id}/enable` | Включить |
| POST | `/api/v1/mgmt/keys/{id}/disable` | Отключить |
| POST | `/api/v1/mgmt/keys/{id}/purge` | Удалить безвозвратно |
| POST | `/api/v1/mgmt/keys/bulk` | Массовые операции |

### Roles (10 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/roles` | Список |
| POST | `/api/v1/mgmt/roles` | Создать |
| GET | `/api/v1/mgmt/roles/{name}` | Детали |
| PUT | `/api/v1/mgmt/roles/{name}` | Обновить |
| DELETE | `/api/v1/mgmt/roles/{name}` | Удалить |
| POST | `/api/v1/mgmt/roles/{name}/enable` | Включить |
| POST | `/api/v1/mgmt/roles/{name}/disable` | Отключить |
| POST | `/api/v1/mgmt/roles/{name}/gen-key` | Сгенерировать ключ под роль |
| GET | `/api/v1/mgmt/roles/{name}/users` | Пользователи с ролью |
| GET | `/api/v1/mgmt/roles/{name}/keys` | Ключи с ролью |

### Permissions (3 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/permissions` | Список всех прав (305) |
| POST | `/api/v1/mgmt/permissions/assign` | Назначить права роли |
| POST | `/api/v1/mgmt/permissions/revoke` | Отозвать права |

### Stats & Audit (3 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/stats` | Сводная статистика |
| GET | `/api/v1/mgmt/audit` | Журнал аудита (rich) |
| GET | `/api/v1/mgmt/audit/export` | Экспорт в CSV/XLSX/JSON |

### 2FA Self-service (5 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/auth/2fa/setup` | Сгенерировать секрет |
| POST | `/api/v1/auth/2fa/enable` | Включить 2FA |
| POST | `/api/v1/auth/2fa/disable` | Отключить 2FA |
| GET | `/api/v1/auth/2fa/status` | Статус |
| POST | `/api/v1/auth/login/verify` | Шаг 2 логина (публичный) |

### 2FA Admin (7 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/mgmt/users/{id}/2fa/status` | Статус 2FA пользователя |
| POST | `/api/v1/mgmt/users/{id}/2fa/setup` | Сгенерировать секрет |
| POST | `/api/v1/mgmt/users/{id}/2fa/enable` | Включить (с кодом или force) |
| POST | `/api/v1/mgmt/users/{id}/2fa/disable` | Отключить (без пароля) |
| POST | `/api/v1/mgmt/users/{id}/2fa/reset` | Полный сброс |
| GET | `/api/v1/mgmt/2fa/enabled` | Список с 2FA |
| GET | `/api/v1/mgmt/2fa/disabled` | Список с секретом, 2FA выкл |

### Webhooks (7 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/webhooks` | Регистрация |
| GET | `/api/v1/webhooks` | Список |
| GET | `/api/v1/webhooks/{id}` | Детали |
| PUT | `/api/v1/webhooks/{id}` | Обновить |
| DELETE | `/api/v1/webhooks/{id}` | Удалить |
| POST | `/api/v1/webhooks/{id}/test` | Тестовое событие |
| GET | `/api/v1/webhooks/events` | Поддерживаемые события |

### Backup (5 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/backup` | Создать backup |
| GET | `/api/v1/backup` | Список backups |
| GET | `/api/v1/backup/{filename}` | Скачать |
| DELETE | `/api/v1/backup/{filename}` | Удалить |
| POST | `/api/v1/backup/restore` | Восстановить |

### Bulk AD Users (1 endpoint)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/users/bulk` | Массовые операции с AD-пользователями |

---

## Итого: 62 endpoint'а
