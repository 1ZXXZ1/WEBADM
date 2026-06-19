# История изменений

## v1.2.7_ban (текущая)

### Добавлено
- **Система банов** — возможность забанить mgmt-пользователя или API-ключ с указанием причины и срока действия. Баны хранятся в PostgreSQL (новая таблица `mgmt_bans`), автоматически истекают (lazy expiry), поддерживают историю (снятие бана сохраняет запись).

#### Новые файлы
- `app/ban_db.py` — PostgreSQL-backed ban storage (CRUD + проверки `is_user_banned`, `is_key_banned`, lazy expiry, purge истории).
- `app/routers/ban.py` — REST API router с endpoints:
  - `POST /api/v1/ban` — создать бан (обязательны `target_type`, `target_name`; опционально `reason`, `duration_minutes`)
  - `POST /api/v1/unban` — снять бан по `ban_id` или `target_type`+`target_name`
  - `POST /api/v1/ban/unban` — alias для `/api/v1/unban`
  - `GET /api/v1/ban` — список банов (фильтры: `active`, `target_type`, `target_name`, `limit`, `offset`)
  - `GET /api/v1/ban/{ban_id}` — показать бан по id
  - `GET /api/v1/ban/check/{type}/{name}` — проверить, забанена ли цель
  - `DELETE /api/v1/ban/{ban_id}` — hard-delete записи (история)

#### Новые разрешения (5)
- `ban.create` — POST `/api/v1/ban`
- `ban.unban` — POST `/api/v1/unban` или `/api/v1/ban/unban`
- `ban.list` — GET `/api/v1/ban`
- `ban.show` — GET `/api/v1/ban/{id}` и `/api/v1/ban/check/{type}/{name}`
- `ban.delete` — DELETE `/api/v1/ban/{id}`

Все 5 разрешений **admin-only** по умолчанию (не выдаются `operator`/`auditor`).

#### Интеграция в middleware
- В `app/main.py` добавлена инициализация `ban_db.ensure_schema()` в lifespan startup.
- В auth middleware добавлены хуки проверки бана:
  - **JWT path:** после проверки прав вызывается `ban_db.is_user_banned(jwt_username)` → если да, 403 с причиной и сроком.
  - **API-key path:** после проверки прав вызывается `ban_db.is_key_banned(key_prefix)` (для mgmt-ключей), а также `ban_db.is_user_banned(owner_username)` — проверяет владельца ключа.
  - Static API key (bootstrap admin) **не может быть забанен** — это сделано намеренно, чтобы избежать полной блокировки системы.

#### CLI-команда `webadc ban`
- `webadc ban list [--active] [--type user|key] [--name NAME]` — список банов
- `webadc ban add --type user --name john --reason "..." [--duration 60]` — создать бан (без `--duration` = permanent)
- `webadc ban unban --id 42` или `--type user --name john` — снять бан
- `webadc ban show 42` — показать бан по id
- `webadc ban check user john` / `webadc ban check key abc12345` — проверить статус
- `webadc ban delete 42` — hard-delete записи
- `webadc ban purge [--older-than-days 90]` — удалить старые снятые баны (напрямую через `ban_db.purge_history()`, т.к. для этого нет REST endpoint)

### Совместимость
- Таблица `mgmt_bans` создаётся автоматически при старте сервера (если ещё не существует).
- Старые разрешения и роли не затронуты — новые `ban.*` разрешения нужно назначить пользовательским ролям вручную через `/api/v1/mgmt/permissions/assign`, если требуется делегировать управление банами не-admin пользователям.
- Если PostgreSQL недоступен — ban-функциональность просто отключается (endpoints возвращают 503), остальной API продолжает работать.

## v1.2.6_fix

### Исправлено
- **`app/permissions.py`** — полностью переписан `resolve_permission()`. Старая логика longest-prefix-match не умела работать с path-параметрами (`{username}`, `{gpo_id}`, `{zone}`, `{projet_id}` и т. п.), из-за чего многие endpoints требовали **неправильное** разрешение и были недоступны для ролей `operator`/`auditor`.
  Новый resolver использует **regex-паттерны**, в которых path-параметры записаны как `[^/]+`, и выбирает правило с самым длинным **литеральным** префиксом.
  Это корректно различает, например:
  - `POST /api/v1/users/john/enable` → `user.enable` (раньше → `user.create`)
  - `GET  /api/v1/users/john/groups` → `user.getgroups` (раньше → `user.list`)
  - `POST /api/v1/groups/sales/members` → `group.addmembers` (раньше → `group.create`)
  - `POST /api/v1/shell/projet/42/run` → `shell.projet.run` (раньше → `shell.projet.create`)
  - `GET  /api/v1/dns/zones/example.com/records` → `dns.recordlist` (раньше → `None`)

### Добавлено
- 92 новых разрешения для ранее незамапленных endpoints:
  - **Users**: `user.edit`, `user.batch`
  - **DNS**: `dns.cacheflush`
  - **Domain**: `domain.trustvalidate`, `domain.backup`, `domain.kdsrootkey`, `domain.exportkeytab`, `domain.leave`, `domain.claim`
  - **DRS**: `drs.replicate`, `drs.uptodateness`
  - **Sites**: `sites.subnetcreate`, `sites.subnetdelete`, `sites.subnetupdate`
  - **Service accounts**: `serviceaccount.gmsamembers`
  - **Auth policies**: `authpolicy.silolist`, `authpolicy.siloshow`, `authpolicy.silocreate`, `authpolicy.silodelete`, `authpolicy.silomembers`
  - **Shell**: `shell.list`, `shell.script`
  - **Shell Projects** (12 новых): `shell.projet.uploadmulti`, `shell.projet.health`, `shell.projet.download`, `shell.projet.owner`, `shell.projet.tags`, `shell.projet.schedule`, `shell.projet.template`, `shell.projet.snapshot`, `shell.projet.audit`, `shell.projet.batch`
  - **Misc**: `misc.dbcheck`, `misc.dbcheckfix`, `misc.ntacl`, `misc.ntaclset`, `misc.spn`
  - **AI**: `ai.sdb`, `ai.balance`, `ai.test`, `ai.system`, `ai.datavchema`, `ai.pipeline`, `ai.exports`, `ai.info`, `ai.chat.info`, `ai.chat.stream`
  - **SDB** (11 новых): `sdb.databases`, `sdb.full`, `sdb.info`, `sdb.query`, `sdb.select`, `sdb.show`, `sdb.script`, `sdb.synthesis`, `sdb.export`, `sdb.exportdownload`, `sdb.exports`
  - **Report**: `report.generate`, `report.download`
  - **Dashboard**: `dashboard.overview`
  - **CFG**: `cfg.persist`
- Всего разрешений: **252** (раньше — 160).

### Исправлено (mapping-баги)
- `auth-policies` → `auth/policies` и `auth/silos` (правильный router prefix `/auth`).
- FSMO `/transfer` и `/seize`: метод изменён с POST на **PUT** (с сохранением backward-compat для POST).
- DRS `/bind`: метод изменён с POST на **GET** (с сохранением backward-compat для POST).
- GPO `/by-name/{displayname}` теперь корректно мапится на `gpo.deletebyname` (раньше мапился на `gpo.delete`).
- Schema `/attributes/{attribute}` и `/classes/{classname}` теперь мапятся на `schema.show` (раньше мапились на `schema.list`).
- Все path-param endpoints (users, groups, computers, contacts, ous, dns/zones, gpo, sites, service-accounts, mgmt/users, mgmt/keys, mgmt/roles, shell/projet, ai/chat) теперь мапятся на **правильные** разрешения.

### Документация
- `docs/PERMISSIONS.md` — полностью переписан: таблица всех 252 разрешений с методами, paths и описаниями, раздел диагностики 403-ошибок.
- Этот CHANGELOG.

### Совместимость
- Все старые имена разрешений сохранены (константы `PERM_*` и строки в БД).
- Роли `admin`/`operator`/`auditor` расширены, но не сужены — старые токены продолжат работать.
- Пользовательские роли в БД не затронуты (новые разрешения нужно назначить вручную через `/api/v1/mgmt/permissions/assign`, если требуется).

## v1.1.6

### Добавлено
- API Proxy (`/api/v1/[...path]/route.ts`) — проксирование всех API-запросов к Python/FastAPI бэкенду
- Переменная окружения `SAMBA_API_URL` для настройки адреса бэкенда
- Динамическое обновление baseURL в Axios (чтение из localStorage при каждом запросе)
- Полная документация проекта в `/docs/`

### Исправлено
- Ошибка авторизации при использовании базового URL `/api/v1` — теперь запросы проксируются через Next.js API Proxy
- Инициализация поля «API Server URL» на странице авторизации — теперь отображает текущее значение из localStorage
- Обновление refresh token — используется динамический baseURL вместо статического

## v1.1.5

### Добавлено
- AI Ассистент — помощь в построении ETL конвейеров
- AI Агент — автономное выполнение API-операций
- Safe Mode для AI — затирание чувствительных данных
- Shell Projects — рабочие пространства с проектами
- ETL Builder — визуальный конструктор пакетных операций
- Импорт CSV/Excel данных в ETL конвейер

### Изменено
- Обновлены типы API до v1.1.13-3
- Добавлены Shell Project типы (create, run, health, show, list)
- Расширен ETL Store для поддержки field mappings и linked steps

## v1.1.0

### Добавлено
- Shell Terminal — выполнение bash/python3 команд на сервере
- DNS Management — управление зонами и записями
- GPO Management — просмотр и управление групповыми политиками
- Domain Info — информация о домене, FSMO, уровни, политика паролей
- Audit Page — просмотр журналов аудита
- Management Page — управление API-пользователями и ключами

### Изменено
- Навигация разделена на категории с иконками
- Добавлена система прав доступа (RequirePermission)
- Поддержка тёмной и светлой темы

## v1.0.0

### Добавлено
- Базовый UI на Next.js + React + TypeScript + Tailwind CSS
- Авторизация (JWT + API Key)
- Управление пользователями AD
- Управление группами AD
- Управление компьютерами AD
- Управление контактами AD
- Управление подразделениями (OU)
- Дашборд с обзором домена
- Локализация (RU/EN)
- shadcn/ui компоненты
