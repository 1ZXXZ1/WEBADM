# ban-fix.zip — v1.2.7_ban

Содержит **новую** систему банов и **обновлённые** файлы permissions/main/cli.

## Что внутри

```
ban-fix/
├── app/
│   ├── ban_db.py               # НОВЫЙ — PostgreSQL ban storage
│   ├── permissions.py          # +5 ban.* разрешений, +10 path-rules
│   ├── main.py                 # регистрация ban router + проверка бана в middleware
│   └── routers/
│       └── ban.py              # НОВЫЙ — REST API router
├── cli.py                      # +команда `webadc ban {list|add|unban|show|check|delete|purge}`
└── docs/
    ├── PERMISSIONS.md          # +раздел "Bans" с таблицей
    ├── CHANGELOG.md            # +запись v1.2.7_ban
    └── README_BAN_FIX.md       # этот файл
```

## Что добавлено

### 1. Ban / Unban REST API

Новый router `app/routers/ban.py` регистрируется в `app/main.py` под prefix
`/api/v1`. Endpoints:

| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/ban` | Создать бан (user или key). Тело: `{target_type, target_name, reason?, duration_minutes?}` |
| POST | `/api/v1/unban` | Снять бан. Тело: `{ban_id?}` ИЛИ `{target_type, target_name}` + `lifted_reason?` |
| POST | `/api/v1/ban/unban` | Alias для `/api/v1/unban` |
| GET | `/api/v1/ban` | Список банов. Query: `active`, `target_type`, `target_name`, `limit`, `offset` |
| GET | `/api/v1/ban/{ban_id}` | Показать бан по id |
| GET | `/api/v1/ban/check/{target_type}/{target_name}` | Проверить, забанена ли цель |
| DELETE | `/api/v1/ban/{ban_id}` | Hard-delete записи (история) |

**Пример создания бана:**

```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:8099/api/v1/ban \
  -d '{
    "target_type": "user",
    "target_name": "alice",
    "reason": "Подозрительная активность с IP 1.2.3.4",
    "duration_minutes": 1440
  }'
```

**Пример снятия бана:**

```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:8099/api/v1/unban \
  -d '{"target_type": "user", "target_name": "alice", "lifted_reason": "investigation complete"}'
```

**Пример проверки:**

```bash
curl -H "X-API-Key: $KEY" \
  http://localhost:8099/api/v1/ban/check/user/alice
# {"banned": false, "target_type": "user", "target_name": "alice", "ban": null}
```

### 2. База данных (PostgreSQL)

Новая таблица `mgmt_bans` создаётся автоматически при старте сервера:

```sql
CREATE TABLE mgmt_bans (
    id              SERIAL PRIMARY KEY,
    target_type     TEXT NOT NULL,      -- 'user' | 'key'
    target_name     TEXT NOT NULL,      -- username или key_prefix
    target_id       INTEGER,            -- mgmt_users.id или mgmt_api_keys.id (или NULL)
    reason          TEXT DEFAULT '',
    banned_by       TEXT DEFAULT '',    -- username админа
    banned_by_ip    TEXT DEFAULT '',
    created_at      TEXT NOT NULL,      -- ISO-8601 UTC
    expires_at      TEXT,               -- ISO-8601 UTC или NULL = permanent
    lifted_at       TEXT,               -- ISO-8601 UTC или NULL
    lifted_by       TEXT,
    lifted_reason   TEXT,
    is_active       BOOLEAN DEFAULT TRUE
);

-- Активный бан может быть только один на цель
CREATE UNIQUE INDEX uq_mgmt_bans_active
    ON mgmt_bans (target_type, target_name)
    WHERE is_active = TRUE;
```

### 3. Интеграция в middleware

В `app/main.py` в auth middleware добавлены проверки бана:

- **JWT path:** после успешной проверки прав вызывается
  `ban_db.is_user_banned(jwt_username)`. Если да → `403 Forbidden` с причиной и сроком.
- **API-key path:** после проверки прав вызывается
  `ban_db.is_key_banned(key_prefix)` (для mgmt-ключей) и
  `ban_db.is_user_banned(owner_username)` (для владельца ключа). Если
  хоть одна проверка положительная → `403`.

**Static API key (bootstrap admin) НЕ может быть забанен** — это сделано
намеренно, чтобы избежать полной блокировки системы.

### 4. CLI-команда `webadc ban`

Новая подкоманда в `cli.py`:

```
webadc ban list [--active] [--type user|key] [--name NAME] [--limit 200]
webadc ban add --type user --name john --reason "..." [--duration 60]
webadc ban unban --id 42 | --type user --name john [--reason "..."]
webadc ban show 42
webadc ban check user john
webadc ban check key abc12345
webadc ban delete 42
webadc ban purge [--older-than-days 90]
```

CLI общается с REST API (кроме `purge`, который ходит напрямую в БД
через `ban_db.purge_history()`). Использует `SAMBA_API_KEY` и
`SAMBA_API_HOST`/`SAMBA_API_PORT` из `.env`.

### 5. Разрешения

5 новых разрешений в `app/permissions.py`:

| Право | Endpoint |
|-------|----------|
| `ban.create` | POST `/api/v1/ban` |
| `ban.unban` | POST `/api/v1/unban`, POST `/api/v1/ban/unban` |
| `ban.list` | GET `/api/v1/ban` |
| `ban.show` | GET `/api/v1/ban/{id}`, GET `/api/v1/ban/check/{type}/{name}` |
| `ban.delete` | DELETE `/api/v1/ban/{id}` |

Все 5 разрешений **admin-only** по умолчанию (не выдаются `operator`/`auditor`).
Даже `ban.list` скрыт от operator/auditor, т.к. список банов раскрывает,
кто и за что был заблокирован.

Всего разрешений в системе: **257** (раньше было 252).

## Установка

1. Распаковать `ban-fix.zip` в корень проекта (поверх существующих файлов):

   ```bash
   unzip ban-fix.zip -d /path/to/WEBADM/
   ```

   Файлы будут помещены как:
   - `/path/to/WEBADM/app/ban_db.py` (новый)
   - `/path/to/WEBADM/app/routers/ban.py` (новый)
   - `/path/to/WEBADM/app/permissions.py` (обновлённый)
   - `/path/to/WEBADM/app/main.py` (обновлённый)
   - `/path/to/WEBADM/cli.py` (обновлённый)
   - `/path/to/WEBADM/docs/PERMISSIONS.md` (обновлённая)
   - `/path/to/WEBADM/docs/CHANGELOG.md` (обновлённый)
   - `/path/to/WEBADM/docs/README_BAN_FIX.md` (этот файл)

2. Перезапустить сервис:

   ```bash
   sudo systemctl restart webadc
   ```

3. Проверить, что таблица `mgmt_bans` создалась:

   ```bash
   sudo -u postgres psql -d samba_api -c '\d mgmt_bans'
   ```

4. Проверить, что endpoints работают:

   ```bash
   curl -H "X-API-Key: $KEY" http://localhost:8099/api/v1/ban
   # {"status":"ok","total":0,"active":0,"bans":[]}
   ```

5. Проверить CLI:

   ```bash
   webadc ban list
   webadc ban --help
   ```

## Совместимость

- Таблица `mgmt_bans` создаётся автоматически при старте сервера (если ещё не существует).
- Старые разрешения и роли не затронуты — новые `ban.*` разрешения нужно назначить пользовательским ролям вручную через `/api/v1/mgmt/permissions/assign`, если требуется делегировать управление банами не-admin пользователям.
- Если PostgreSQL недоступен — ban-функциональность просто отключается (endpoints возвращают 503), остальной API продолжает работать.
- Existing JWT tokens и API keys продолжат работать без изменений.

## Тестирование

```bash
# 1. Создать бан на 5 минут
webadc ban add --type user --name alice --reason "test ban" --duration 5

# 2. Проверить, что бан создан
webadc ban list --active

# 3. Проверить статус (должен быть banned=true)
webadc ban check user alice

# 4. Попробовать сделать запрос с забаненной учёткой (должен быть 403)
curl -H "X-API-Key: ALICE_KEY" http://localhost:8099/api/v1/users
# {"status":"error","message":"User 'alice' is banned: test ban (expires: ...)"}

# 5. Снять бан
webadc ban unban --type user --name alice --reason "test complete"

# 6. Проверить, что бан снят
webadc ban check user alice

# 7. Посмотреть историю (все баны, включая снятые)
webadc ban list
```
