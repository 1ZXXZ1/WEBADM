# Management API v2.2 — Полный справочник

> Расширение `/api/v1/mgmt/` для управления пользователями, API-ключами и
> ролями. Добавлены поля `weight`, явные операции `enable`/`disable`/
> `purge`, генерация ключа под роль, списки привязок, сброс пароля,
> массовые операции, сводная статистика.

Все эндпоинты требуют аутентификации (JWT Bearer или `X-API-Key`) и
наличия соответствующего разрешения `mgmt.*` у роли.

---

## Что нового в v2.2 (кратко)

| # | Возможность | Эндпоинт(ы) |
|---|-------------|-------------|
| 1 | Поле `weight` (приоритет) у Users / API-keys / Roles | все create/update/list |
| 2 | Явные `enable` / `disable` | `POST .../enable`, `POST .../disable` |
| 3 | Безвозвратное удаление | `DELETE ...?hard=true`, `POST .../purge` |
| 4 | Генерация API-ключа под роль | `POST /api/v1/mgmt/roles/{name}/gen-key` |
| 5 | Список ключей пользователя | `GET /api/v1/mgmt/users/{id}/keys` |
| 6 | Список пользователей/ключей роли | `GET /api/v1/mgmt/roles/{name}/users`, `.../keys` |
| 7 | Сброс пароля (в т.ч. случайного) | `POST /api/v1/mgmt/users/{id}/reset-password` |
| 8 | Массовые операции | `POST /api/v1/mgmt/users/bulk`, `.../keys/bulk` |
| 9 | Сводная статистика | `GET /api/v1/mgmt/stats` |
| 10 | Поиск (`search`) на list-эндпоинтах | `?search=...` |
| 11 | Аудит-поля для пользователя | `last_login_at`, `login_count` |
| 12 | Защита от отключения последнего admin | `disable_user` / `purge_user` / `disable_role('admin')` |

---

## Миграция схемы БД

При первом запуске v2.2 с существующей PostgreSQL-базой автоматически
выполняются идемпотентные миграции (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):

| Таблица | Новые колонки |
|---------|---------------|
| `mgmt_users` | `weight INTEGER DEFAULT 0`, `last_login_at TEXT`, `login_count INTEGER DEFAULT 0` |
| `mgmt_api_keys` | `weight INTEGER DEFAULT 0` |
| `mgmt_roles` | `is_active BOOLEAN DEFAULT TRUE`, `weight INTEGER DEFAULT 0` |

Также добавлены индексы: `idx_mgmt_users_active`, `idx_mgmt_users_role`, `idx_mgmt_roles_active`.

Никаких ручных действий не требуется.

---

## 1. Users — Управление пользователями

### `GET /api/v1/mgmt/users`

Список пользователей с фильтрацией и пагинацией.

**Query-параметры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `role` | string | Фильтр по роли |
| `is_active` | bool | Фильтр по активности |
| `search` | string | **(v2.2)** Поиск по `username` / `full_name` / `email` (ILIKE) |
| `offset` | int | Смещение (по умолчанию 0) |
| `limit` | int | Размер страницы (1-500, по умолчанию 100) |

**Ответ 200:**

```json
{
  "status": "ok",
  "data": [
    {
      "id": 1, "username": "admin", "full_name": "Default Administrator",
      "email": "", "role": "admin", "is_active": 1, "weight": 0,
      "last_login_at": "2026-06-17T08:15:42+00:00", "login_count": 42,
      "created_at": "...", "updated_at": "..."
    }
  ]
}
```

### `POST /api/v1/mgmt/users`

Создать пользователя.

**Тело:**

```json
{
  "username": "string (1-64, unique)",
  "password": "string (>= 1)",
  "role": "operator",
  "full_name": "",
  "email": "",
  "weight": 0
}
```

**Ошибки:** `409 Username '...' already exists`, `400 Invalid role '...'`.

### `GET /api/v1/mgmt/users/{user_id}`

Карточка пользователя (включая `password_hash` — внутреннее поле).

### `PUT /api/v1/mgmt/users/{user_id}`

Обновление. Можно передать любые поля из `{username, password, role,
full_name, email, is_active, weight}`.

### `DELETE /api/v1/mgmt/users/{user_id}?hard=false|true`

- `hard=false` (по умолчанию): soft-delete, `is_active=FALSE`, деактивирует все API-ключи.
- `hard=true`: безвозвратное удаление (CASCADE ключей), блокирует удаление последнего активного admin.

### `POST /api/v1/mgmt/users/{user_id}/enable`  — **(v2.2)**

Включить пользователя (только самого пользователя, не его ключи).

### `POST /api/v1/mgmt/users/{user_id}/disable`  — **(v2.2)**

Отключить пользователя И все его API-ключи (эквивалент soft-delete).

### `POST /api/v1/mgmt/users/{user_id}/purge`  — **(v2.2)**

Безвозвратное удаление (то же что `DELETE ?hard=true`), с защитой последнего admin.

### `POST /api/v1/mgmt/users/{user_id}/reset-password`  — **(v2.2)**

Сброс пароля.

**Тело:**

```json
{ "new_password": null }
```

Если `new_password` не задан (null), сервер генерирует случайный пароль
и возвращает его в ответе. Иначе пароль устанавливается и `data` равен `null`.

**Ответ (когда сгенерировано):**

```json
{
  "status": "ok",
  "message": "Password for user 2 reset",
  "data": { "new_password": "xY9_aBcdEfGhIjKlMnOp" }
}
```

### `GET /api/v1/mgmt/users/{user_id}/keys?include_inactive=false`  — **(v2.2)**

Список всех API-ключей пользователя.

### `POST /api/v1/mgmt/users/bulk`  — **(v2.2)**

Массовая операция.

**Тело:**

```json
{ "ids": [1, 2, 5], "action": "disable" }
```

`action` ∈ `enable | disable | purge`.

**Ответ:**

```json
{
  "status": "ok",
  "data": {
    "action": "disable",
    "ok": [1, 2],
    "failed": [{ "id": 5, "error": "not found or already disabled" }]
  }
}
```

---

## 2. API Keys — Управление ключами

### `GET /api/v1/mgmt/keys`

**Query:** `user_id`, `is_active`, `search` (по name/description), `offset`, `limit`.

### `POST /api/v1/mgmt/keys`

**Тело:**

```json
{
  "user_id": 1,
  "name": "ci-key",
  "role": "operator",
  "expires_days": 90,
  "weight": 50,
  "description": "CI/CD pipeline token"
}
```

**Ответ:** `{ "status": "ok", "data": { "key": "sak_..." } }` — plaintext
ключ возвращается **только один раз**.

### `GET /api/v1/mgmt/keys/{key_id}` | `PUT ...` | `DELETE ...?hard=...`

Аналогично пользователям. `PUT` принимает `{name, role, is_active,
expires_days, weight, description}`. `expires_days` сбрасывает срок
действия на N дней от текущего момента.

### `POST /api/v1/mgmt/keys/{key_id}/rotate`

Ротация: деактивирует старый ключ, создаёт новый с теми же настройками
(роль, имя, описание, вес, остаточный срок). Возвращает новый plaintext.

### `POST /api/v1/mgmt/keys/{key_id}/enable`  — **(v2.2)**

Включить ключ. **Условие:** пользователь-владелец активен.

### `POST /api/v1/mgmt/keys/{key_id}/disable`  — **(v2.2)**

Отключить ключ (мягко).

### `POST /api/v1/mgmt/keys/{key_id}/purge`  — **(v2.2)**

Безвозвратно удалить запись ключа.

### `POST /api/v1/mgmt/keys/bulk`  — **(v2.2)**

Аналогично `users/bulk`.

---

## 3. Roles — Управление ролями

### `GET /api/v1/mgmt/roles?include_disabled=true`

Список всех ролей с разрешениями, флагом `is_builtin`, `is_active`, `weight`.

### `POST /api/v1/mgmt/roles`

**Тело:**

```json
{
  "name": "dns-admin",
  "description": "Manage DNS only",
  "permissions": ["dns.zonelist", "dns.zonecreate", "dns.zonedelete", "dns.recordlist"],
  "weight": 100
}
```

### `GET /api/v1/mgmt/roles/{role_name}` | `PUT ...` | `DELETE ...`

`PUT` принимает `{name, description, permissions, weight, is_active}`.
Переименование (`name`) каскадно обновляет `mgmt_users.role` и
`mgmt_api_keys.role`.

`DELETE` — **безвозвратное удаление**. Блокируется, если у роли есть
активные пользователи или API-ключи. Используйте `disable` для мягкого
отключения.

### `POST /api/v1/mgmt/roles/{role_name}/enable`  — **(v2.2)**

Включить ранее отключённую роль.

### `POST /api/v1/mgmt/roles/{role_name}/disable`  — **(v2.2)**

Отключить роль. **Эффект:** все API-ключи с этой ролью отклоняются при
валидации (см. `validate_api_key` в `mgmt_db.py`). Существующие
JWT-сессии истекают естественным путём.

Роль `admin` отключать **запрещено** (защита от полной блокировки).

### `POST /api/v1/mgmt/roles/{role_name}/gen-key`  — **(v2.2)** ⭐

Сгенерировать API-ключ **сразу под роль** (без явного указания `role`
в теле — роль берётся из URL).

**Тело:**

```json
{
  "user_id": 5,
  "name": "dns-ci-key",
  "expires_days": 365,
  "weight": 50,
  "description": "DNS management CI token"
}
```

**Ответ:**

```json
{
  "status": "ok",
  "data": { "key": "sak_...", "role": "dns-admin" }
}
```

Удобно для быстрого создания scoped-ключей без ручного копирования
имени роли.

### `GET /api/v1/mgmt/roles/{role_name}/users?include_inactive=false`  — **(v2.2)**

Список пользователей с указанной ролью.

### `GET /api/v1/mgmt/roles/{role_name}/keys?include_inactive=false`  — **(v2.2)**

Список API-ключей с указанной ролью.

---

## 4. Permissions — Управление правами

### `GET /api/v1/mgmt/permissions`

Все доступные разрешения, сгруппированные по категории (`user`, `group`,
`dns`, `mgmt` и т.д.).

### `POST /api/v1/mgmt/permissions/assign`

Добавить разрешения к роли (merge, не заменяет).

```json
{ "role_name": "operator", "permissions": ["user.create", "user.delete"] }
```

### `POST /api/v1/mgmt/permissions/revoke`

Убрать разрешения у роли.

```json
{ "role_name": "operator", "permissions": ["user.delete"] }
```

---

## 5. Stats и Audit

### `GET /api/v1/mgmt/stats`  — **(v2.2)**

Сводная статистика для dashboard-панели.

**Ответ:**

```json
{
  "status": "ok",
  "data": {
    "users":     { "total": 12, "active": 10 },
    "api_keys":  { "total": 28, "active": 22 },
    "roles":     { "total": 5,  "active": 4  },
    "audit_log": { "total": 4567 },
    "roles_breakdown": [
      { "name": "admin",    "is_active": 1, "users": 2, "keys": 5  },
      { "name": "operator", "is_active": 1, "users": 8, "keys": 15 },
      { "name": "dns-admin","is_active": 0, "users": 0, "keys": 2  }
    ]
  }
}
```

### `GET /api/v1/mgmt/audit`

Журнал аудита. Фильтры: `user_id`, `action`, `endpoint`, `offset`, `limit`.

---

## 6. Модель данных (после v2.2 миграции)

```sql
mgmt_users (
    id, username UNIQUE, password_hash,
    full_name, email,
    role, is_active,
    weight INTEGER,           -- v2.2
    last_login_at TEXT,       -- v2.2
    login_count INTEGER,      -- v2.2
    created_at, updated_at
)

mgmt_api_keys (
    id, key_hash, key_prefix,
    user_id REFERENCES mgmt_users(id) ON DELETE CASCADE,
    name, description,
    role, is_active,
    weight INTEGER,           -- v2.2
    expires_at, created_at, last_used_at
)

mgmt_roles (
    id, name UNIQUE,
    description, permissions JSONB,
    is_builtin,
    is_active BOOLEAN,        -- v2.2
    weight INTEGER,           -- v2.2
    created_at, updated_at
)
```

---

## 7. Правила безопасности и проверки

| Операция | Защита |
|----------|--------|
| `purge_user` | Блокирует удаление последнего активного admin-пользователя |
| `disable_role('admin')` | Запрещено — иначе все пользователи теряют доступ |
| `delete_role` | Блокируется, если у роли есть активные пользователи или ключи |
| `enable_api_key` | Проверяет, что пользователь-владелец активен |
| `validate_api_key` | Отклоняет ключи, чья роль отключена (`is_active=FALSE`) |
| `get_role_permissions` | Возвращает пустое множество для отключённой роли → middleware вернёт 403 |

---

## 8. CLI (ds_auth.py) — что добавилось

| Группа | Новые команды (v2.2) |
|--------|----------------------|
| `user` | `enable`, `disable`, `purge`, `reset-password`, `keys` |
| `key`  | `enable`, `disable`, `purge` |
| `role` | `enable`, `disable`, `gen-key`, `users`, `keys` |
| top    | `stats`, `bulk users`, `bulk keys` |
| флаги  | `--weight` для `user create/edit`, `key create/edit`, `role create/edit`, `key gen-key` |
| флаги  | `--search` для `user list`, `key list` |
| флаги  | `--hard` для `user delete`, `key delete` |
| флаги  | `--hide-disabled` для `role list` |

См. полный список команд: [`docs/ds_auth.md`](ds_auth.md).

---

## 9. Что можно ещё добавить или улучшить — таблица предложений

Ниже — идеи для следующих релизов (v2.3+), отсортированы по приоритету.

### 9.1 Управление доступом

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Многофакторная аутентификация (TOTP)** | Усиление входа для admin-роли | средняя |
| **Срок действия пароля + история** | Принудительная смена раз в N дней, запрет переиспользования | средняя |
| **Блокировка по числу неудачных входов** | Защита от brute-force (5 попыток → 15 мин бан) | низкая |
| **Whitelist IP для admin-роли** | Доступ к mgmt API только из указанных подсетей | низкая |
| **Сессии как first-class объекты** | Список активных JWT-сессий, revoke по session_id | высокая |
| **Скоупы у API-ключей** | Ключу можно выдать не только роль, но и narrower-перечень прав | высокая |
| **Время жизни API-ключа по роли** | Дефолтный `expires_days` на уровне роли (config role.max_key_ttl) | низкая |
| **Делегирование прав** | Разрешить оператору создавать ключи только для своей роли | средняя |

### 9.2 Аудит и наблюдаемость

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Логирование в mgmt_audit_log всех mgmt-операций** | Сейчас аудит пишет только HTTP-запросы; добавить semantic-логи (кто кого отключил) | низкая |
| **WebHook на события** | Уведомление Slack/Telegram при создании admin-ключа, отключении роли | средняя |
| **Экспорт аудита в CSV/JSON** | Удобно для комплаенса | низкая |
| **График активности по пользователям** | Heatmap «когда активен» — для SOC | средняя |
| **Diff прав между ролями через API** | Сейчас только в CLI `perms diff` — вынести в REST | низкая |
| **Health-check роли** | `GET /api/v1/mgmt/roles/{name}/check` — какие разрешения из роли реально достижимы (нет ли конфликтов) | средняя |

### 9.3 UX / Web UI

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Сортировка по `weight` в таблицах UI** | Visual priority для админа | низкая |
| **Inline-edit `weight` (как флажок)** | Быстрая смена приоритета без модалки | низкая |
| **Bulk-select с чекбоксами + bulk-action тулбар** | Соответствует новому `bulk` API | средняя |
| **Кнопка «Сгенерировать ключ под роль» прямо в карточке роли** | Использует `POST /roles/{name}/gen-key` | низкая |
| **Мастер создания роли с чекбоксами по категориям прав** | Сейчас права через запятую — неудобно | средняя |
| **Просмотр ключей пользователя в карточке пользователя** | Соответствует новому `GET /users/{id}/keys` | низкая |
| **Просмотр пользователей и ключей роли в карточке роли** | Соответствует `GET /roles/{name}/users` и `/keys` | низкая |
| **Подтверждение опасных операций (purge, hard-delete) двойным кликом** | Защита от случайного удаления | низкая |
| **Toast-уведомления при success/error** | Современный UX вместо alert | низкая |
| **Тёмная тема** | Удобство дежурств | низкая |
| **Глобальный поиск по mgmt (users+keys+roles)** | Один input, как у Linear/Notion | средняя |
| **История изменений сущности (audit timeline)** | Открываешь пользователя — видишь все его изменения | высокая |

### 9.4 Производительность

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Кэширование `get_role_permissions` в памяти с TTL 60s** | На каждый запрос идёт SELECT — лишняя нагрузка | низкая |
| **Индекс на `mgmt_audit_log.timestamp` уже есть; добавить партицирование по месяцам** | Журнал растёт быстро | средняя |
| **Ленивый подсчёт `login_count` через триггер** | Сейчас UPDATE на каждый логин — может батчиться | низкая |
| **Prepared statements в `psycopg2`** | Меньше overhead на parse SQL | низкая |

### 9.5 Совместимость и интеграции

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **OIDC/SAML вход** | Корпоративный SSO (Keycloak, AAD) | высокая |
| **LDAP-синхронизация пользователей** | Тянуть пользователей из AD в mgmt_users | высокая |
| **Экспорт конфигурации в Terraform-формат** | IaC-деплой ролей/пользователей | средняя |
| **OpenAPI-теги для mgmt v2 подгрупп** | Удобная навигация в Swagger UI | низкая |
| **gRPC-зеркало mgmt API** | Для внутренних высоконагруженных клиентов | высокая |

### 9.6 Безопасность данных

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Шифрование `description` и `email` at-rest** | Защита PII (поле-level encryption) | средняя |
| **Masking `key_hash` в API-ответах** | Уже не возвращается, но добавить явный фильтр | низкая |
| **Rate-limit на `/mgmt/keys` (create)** | Защита от утечки через массовую генерацию | низкая |
| **Защита от time-attack в `validate_api_key`** | Уже `secrets.compare_digest` — ОК | — |
| **Опциональное self-destruct для ключей** | Ключ истекает → автоматически purge | низкая |

### 9.7 Developer experience

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Postman/Bruno коллекция с готовыми запросами** | Быстрый старт интеграторов | низкая |
| **SDK auto-generated из OpenAPI** | Python/TypeScript клиенты | средняя |
| **Документация в OpenAPI с примерами тел** | Сейчас docstrings — добавить `examples=...` в Pydantic | низкая |
| **MCP-сервер для управления mgmt через AI** | LLM-ассистент может управлять доступом | средняя |
| **Dry-run режим для bulk-операций** | Посмотреть, что изменилось бы, без применения | низкая |

### 9.8 Операционные улучшения

| Идея | Зачем | Сложность |
|------|-------|-----------|
| **Кнопка «Сбросить всё кеш-токены»** | Invalidate все JWT после инцидента | низкая |
| **Авто-ротация ключей по расписанию** | Cron: ключи старше N дней → email + rotate | средняя |
| **Quota на количество ключей per user** | Защита от滥用 | низкая |
| **Quota на количество ролей** | Защита от碎片ения | низкая |
| **Email-уведомление при входе с нового IP** | Security awareness | средняя |
| **2FA-required-roles список** | Принудить 2FA для admin-роли | средняя |

---

## 10. Сводный план перехода к v2.3

Рекомендуемый порядок внедрения (по соотношению ценность/усилия):

1. **Логирование mgmt-операций в `mgmt_audit_log`** + дашборд по ним.
2. **Bulk-select в Web UI** + использование нового `bulk` API.
3. **Кэширование `get_role_permissions`** (TTL 60s) — самый дешёвый перф-буст.
4. **WebHook на критичные события** (create admin key, disable role, purge user).
5. **TOTP 2FA для admin-роли** — закрыть самый критичный риск.
6. **Whitelist IP для admin-роли** — defence in depth.
7. **Скоупы у API-ключей** — для finer-grained доступа CI/CD.
8. **OIDC/SAML SSO** — корпоративная интеграция.

---

## 11. Файлы, изменённые в v2.2

| Файл | Что изменилось |
|------|----------------|
| `app/mgmt_db.py` | +миграция, +`weight` колонки, +`is_active` для ролей, +`last_login_at`/`login_count`, +`enable_user/disable_user/purge_user/reset_user_password/list_user_keys`, +`enable_api_key/disable_api_key/purge_api_key`, +`enable_role/disable_role/list_role_users/list_role_keys/gen_key_for_role`, +`get_mgmt_stats/bulk_user_action/bulk_key_action`, изменения в `validate_api_key` (проверка `is_active` роли + возврат `permissions`), изменения в `get_role_permissions` (пустое множество для отключённой роли) |
| `app/api_ma.py` | +экспорт новых функций |
| `app/routers/mgmt.py` | +поле `weight` во всех request-моделях, +эндпоинты `/users/{id}/enable|disable|purge|reset-password|keys`, +`/users/bulk`, +`/keys/{id}/enable|disable|purge`, +`/keys/bulk`, +`/roles/{name}/enable|disable|gen-key|users|keys`, +`/stats`, +`?hard=` query для DELETE, +`?search=` для list |
| `app/permissions.py` | +18 новых permission-констант (`mgmt.users.enable/disable/purge/resetpw/keys/bulk`, `mgmt.keys.enable/disable/purge/bulk`, `mgmt.roles.show/enable/disable/genkey/users/keys`, `mgmt.stats`), +соответствующие path-rules, ALL_PERMISSIONS обновлён |
| `ds_auth.py` | +`--weight` для user/key/role create/edit, +`--search` для list, +`--hard` для delete, +`user enable/disable/purge/reset-password/keys`, +`key enable/disable/purge`, +`role enable/disable/gen-key/users/keys`, +top-level `stats`, +`bulk users`/`bulk keys` |
| `docs/ds_auth.md` | Полностью переписан под v2.2 |
| `docs/PERMISSIONS.md` | Секция Management расширена до 37 прав |
| `docs/MGMT_API_v2.md` | **(новый)** этот файл |
