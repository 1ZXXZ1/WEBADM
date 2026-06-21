# DB-слой WebADC (pe-a-1.4)

Единый DB-слой на **SQLAlchemy 2.0 + Alembic + DuckDB**. Все команды доступны через `webadc sqldb`.

---

## 📋 Содержание

- [Архитектура](#архитектура)
- [Установка](#установка)
- [DB_URL — форматы](#db_url--форматы)
- [Команды](#команды)
- [Сериализация (dump/restore/transfer)](#сериализация-dumprestoretransfer)
- [Alembic миграции](#alembic-миграции)
- [DuckDB-аналитика](#duckdb-аналитика)
- [Schema sync при transfer](#schema-sync-при-transfer)
- [Интерактивные конфликты](#инактивные-конфликты)
- [Устранение неисправностей](#устранение-неисправностей)

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                     webadc sqldb ...                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  cli_sqldb.py — CLI (rich UI, interactive conflicts)            │
└──────┬──────────────────────────────┬───────────────────────────┘
       │                              │
       ▼                              ▼
┌──────────────────┐         ┌──────────────────────┐
│  db_sqlalchemy   │         │  db_serialize        │
│  (engine,        │         │  (dump/restore/      │
│   Session,       │         │   transfer)          │
│   Base, get_db)  │         └──────────────────────┘
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  models_sqla/ — 16 ORM моделей                                 │
│  mgmt_users, mgmt_api_keys, mgmt_roles, mgmt_audit_log,        │
│  ai_chat_sessions, ai_chat_messages, mgmt_bans,                │
│  chat_rooms, chat_members, chat_messages, chat_attachments,    │
│  chat_reactions, chat_stars, chat_read_receipts,               │
│  chat_call_participants, chat_calls                            │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SQLAlchemy Engine → DB_URL                                    │
│  ┌────────────┐  ┌──────────────┐  ┌───────────┐               │
│  │  SQLite    │  │ PostgreSQL   │  │  MySQL    │               │
│  │  (default) │  │ (psycopg2)   │  │ (pymysql) │               │
│  └────────────┘  └──────────────┘  └───────────┘               │
└─────────────────────────────────────────────────────────────────┘
         │ (только для SQLite)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  DuckDB (read-only) — аналитические SQL поверх SQLite           │
│  ATTACH 'app.db' AS app (TYPE sqlite, READ_ONLY)                │
└─────────────────────────────────────────────────────────────────┘
```

### Компоненты

| Файл | Назначение |
|------|-----------|
| `app/db_sqlalchemy.py` | Engine, Session, Base, get_db (FastAPI dep), session_scope, init_db |
| `app/db_init.py` | Seed admin/admin + 3 роли (admin/operator/auditor) |
| `app/db_analytics.py` | DuckDB read-only аналитика (ATTACH + query) |
| `app/db_serialize.py` | dump/restore/transfer между любыми бэкендами |
| `app/models_sqla/` | 16 ORM моделей (mgmt, ai_chat, ban, chat, chat_calls) |
| `alembic/` | Миграции (env.py + versions/) |
| `cli_sqldb.py` | CLI со всеми sqldb-командами (rich UI) |

---

## Установка

### 1. Установить Python-зависимости

```bash
pip install -r requirements.txt
# Или на ALT Linux:
sudo apt-get install python3-sqlalchemy python3-alembic python3-duckdb
```

### 2. Настроить DB_URL в .env

```bash
# SQLite (по умолчанию, для dev)
DB_URL=sqlite:///app.db

# PostgreSQL (production)
DB_URL=postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api

# MySQL
DB_URL=mysql+pymysql://samba_api:12345@localhost:3306/samba_api
```

### 3. Инициализировать БД

```bash
webadc sqldb init      # Создать схему + admin/admin
webadc sqldb upgrade   # Применить Alembic миграции
webadc sqldb status    # Проверить состояние
```

### 4. Проверить

```bash
webadc sqldb stats     # Row counts по всем таблицам
webadc sqldb info      # Список таблиц
```

---

## DB_URL — форматы

| Бэкенд | Формат URL | Примечание |
|--------|-----------|-----------|
| SQLite (отн.) | `sqlite:///app.db` | Файл в текущей директории |
| SQLite (абс.) | `sqlite:////var/lib/webadc/app.db` | **4 слеша** для абсолютного пути |
| SQLite (memory) | `sqlite:///:memory:` | Только для тестов |
| PostgreSQL | `postgresql+psycopg2://USER:PASSWORD@HOST:PORT/DBNAME` | Драйвер `+psycopg2` обязателен |
| MySQL | `mysql+pymysql://USER:PASSWORD@HOST:PORT/DBNAME` | Драйвер `+pymysql` обязателен |
| DuckDB | `duckdb:///app.duckdb` | Только аналитика (read-only) |

### Спецсимволы в пароле

Если пароль содержит `@`, `:`, `/` и т.п. — URL-encode их:
```bash
# Пароль "p@ss" → p%40ss
DB_URL=postgresql+psycopg2://user:p%40ss@host/db
```

### Проверить URL

```bash
webadc sqldb test-url "postgresql+psycopg2://user:pwd@host:5432/db"
```

Показывает: dialect, версия сервера, список таблиц.

---

## Команды

### Базовые

| Команда | Описание |
|---------|----------|
| `webadc sqldb init` | Создать схему (`create_all`) + seed admin/admin |
| `webadc sqldb upgrade` | Применить Alembic миграции (`alembic upgrade head`) |
| `webadc sqldb downgrade <rev>` | Откатить миграцию |
| `webadc sqldb stamp [rev]` | Пометить миграцию применённой (без выполнения SQL) |
| `webadc sqldb current` | Текущая применённая миграция |
| `webadc sqldb history` | История миграций |
| `webadc sqldb revision -m "msg"` | Создать новую миграцию (autogenerate) |

### Информация

| Команда | Описание |
|---------|----------|
| `webadc sqldb status` | Обзор БД: DB_URL, размер, миграции, top-10 таблиц |
| `webadc sqldb stats` | Row counts по всем таблицам + DuckDB статус |
| `webadc sqldb info` | Конфигурация + список таблиц |

### Чтение данных

| Команда | Описание |
|---------|----------|
| `webadc sqldb show <table> <id>` | Показать запись по PK (Field/Value таблица) |
| `webadc sqldb keys` | Список API-ключей |
| `webadc sqldb audit [--limit N]` | Последние записи аудита (default: 20) |
| `webadc sqldb query "SQL"` | SQL-запрос через DuckDB (read-only) |
| `webadc sqldb shell` | Python REPL с engine, Session, models |

### Запись данных

| Команда | Описание |
|---------|----------|
| `webadc sqldb purge <table>` | Очистить таблицу (с подтверждением) |
| `webadc sqldb purge <table> --yes` | Очистить без подтверждения |

### Сериализация

| Команда | Описание |
|---------|----------|
| `webadc sqldb dump [--out F] [--tables t1,t2]` | Дамп БД в JSONL |
| `webadc sqldb dump-info --in F` | Инфо о JSONL-дампе |
| `webadc sqldb list-dumps` | Список `*.jsonl` в текущей директории |
| `webadc sqldb restore --in F [--on-conflict MODE] [--dry-run]` | Восстановить из JSONL |
| `webadc sqldb transfer --from URL --to URL [--tables t1,t2] [--dry-run]` | Прямое копирование между БД |

### Утилиты

| Команда | Описание |
|---------|----------|
| `webadc sqldb test-url "URL"` | Проверить подключение к БД |

---

## Сериализация (dump/restore/transfer)

### JSONL формат

```
Line 1:  {"_meta": true, "format": "webadc-jsonl-v1", "source_url": "...", "dumped_at": "...", "tables": [...]}
Line 2+: {"_table": "mgmt_users", "data": {"id": 1, "username": "admin", ...}}
...
```

Portable между SQLite/PostgreSQL/MySQL — диалект SQL не важен.

### Backup текущей БД

```bash
webadc sqldb dump --out backup_$(date +%F).jsonl
webadc sqldb dump-info --in backup_2026-06-21.jsonl
```

### Перенос PostgreSQL → SQLite

```bash
# 1. Проверить подключение
webadc sqldb test-url "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api"

# 2. Перенести
webadc sqldb transfer \
  --from "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \
  --to "sqlite:///app.db" \
  --on-conflict overwrite

# 3. Проверить
webadc sqldb status
```

### Перенос SQLite → PostgreSQL

```bash
webadc sqldb transfer \
  --from "sqlite:///app.db" \
  --to "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \
  --on-conflict skip
```

### Только определённые таблицы

```bash
webadc sqldb dump --out partial.jsonl --tables mgmt_users,mgmt_roles,mgmt_api_keys

webadc sqldb transfer \
  --from "sqlite:///app.db" \
  --to "sqlite:///copy.db" \
  --tables mgmt_users,mgmt_roles
```

### Restore

```bash
# Skip существующие PK (target не трогать)
webadc sqldb restore --in backup.jsonl --on-conflict skip

# Перезаписать существующие PK
webadc sqldb restore --in backup.jsonl --on-conflict overwrite

# UPDATE существующих PK значениями из дампа
webadc sqldb restore --in backup.jsonl --on-conflict upsert

# Только проверить (без записи)
webadc sqldb restore --in backup.jsonl --dry-run
```

---

## Alembic миграции

### Создать новую миграцию

После изменения моделей в `app/models_sqla/`:

```bash
webadc sqldb revision -m "add user avatar column"
```

Сгенерируется файл в `alembic/versions/`. **Проверьте его** перед применением — autogenerate может пропустить некоторые изменения.

### Применить миграции

```bash
webadc sqldb upgrade              # До head
webadc sqldb upgrade <rev>        # До конкретной ревизии
webadc sqldb downgrade <rev>      # Откатить до ревизии
webadc sqldb downgrade -1         # Откатить одну миграцию
```

### Просмотр состояния

```bash
webadc sqldb current              # Текущая ревизия
webadc sqldb history              # История всех миграций
```

### Auto-stamp

Если `webadc sqldb init` уже создал таблицы через `create_all()`, а потом запускаете `webadc sqldb upgrade` — он автоматически сделает `stamp head` (помечает миграцию применённой без выполнения SQL), потому что таблицы уже существуют.

---

## DuckDB-аналитика

DuckDB подключается к SQLite-файлу в read-only режиме и позволяет выполнять аналитические SQL (GROUP BY, window functions, PIVOT, JSON extraction) быстрее чем сам SQLite.

### Использование

```bash
# Аналитический SQL через DuckDB
webadc sqldb query "
  SELECT date_trunc('hour', timestamp::TIMESTAMP) AS hour,
         COUNT(*) AS events
  FROM app.mgmt_audit_log
  WHERE timestamp >= '2026-06-01'
  GROUP BY hour
  ORDER BY hour
"
```

Таблицы доступны под схемой `app.` — например `app.mgmt_users`, `app.chat_messages`.

### Python API

```python
from app.db_analytics import query, stats

# SQL-запрос через DuckDB
rows = query("SELECT username, role FROM app.mgmt_users")

# Статус DuckDB-слоя
info = stats()
# {'enabled': True, 'duckdb_installed': True, 'db_url': 'sqlite:///app.db', ...}
```

### Когда DuckDB отключён

- DB_URL указывает на PostgreSQL/MySQL (не SQLite)
- `SAMBA_DB_DUCKDB_ENABLED=false` в .env
- Пакет `duckdb` не установлен

При отключённом DuckDB `webadc sqldb query` выполняет SQL на основном engine (SQLite/PG).

---

## Schema sync при transfer

При `webadc sqldb transfer` автоматически:

1. **Создаёт недостающие таблицы** на target (с типами, выведенными из source)
2. **Добавляет недостающие колонки** через `ALTER TABLE ADD COLUMN` (additive only — ничего не удаляет)
3. **Фильтрует колонки** при INSERT — даже если sync не смог добавить колонку, данные всё равно скопируются (просто эта колонка будет пропущена)
4. **Coerce NULL → default** для NOT NULL колонок (если source имеет NULL или не имеет колонки)

### Пример

Source PostgreSQL имеет:
- `mgmt_users` с extra-колонкой `totp_enabled`
- Таблицу `audit_log` (которой нет в SQLite-схеме)

Target SQLite (после `webadc sqldb init`):
- `mgmt_users` без `totp_enabled`
- Нет таблицы `audit_log`

После `webadc sqldb transfer`:
```
ℹ Created 1 missing table(s) on target:
    + audit_log
ℹ Added 1 missing column(s) on target:
    + mgmt_users.totp_enabled
✓ Copied N rows across M tables
```

---

## Интерактивные конфликты

При `--on-conflict ask` (по умолчанию для transfer) — при каждом PK-конфликте показывается:

```
           ⚠️  PK conflict on 'mgmt_users'
┏━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Column   ┃ Value                                ┃
┡━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ id       │ 1                                    │
│ username │ admin                                │
│ ...      │ ...                                  │
└──────────┴──────────────────────────────────────┘

What should I do with this row?
  s) skip       — keep target row, drop source row
  o) overwrite  — delete target row, insert source row
  u) upsert     — UPDATE target row with source values
  f) fail       — abort transfer
Choice [s]:

Apply this choice to ALL future conflicts? [y/N]:
```

### Non-interactive режимы

```bash
webadc sqldb transfer ... --on-conflict skip       # Без вопросов
webadc sqldb transfer ... --on-conflict overwrite  # Без вопросов
webadc sqldb transfer ... --on-conflict upsert     # Без вопросов
webadc sqldb transfer ... --on-conflict fail       # Прервать на первом конфликте
```

---

## Устранение неисправностей

### `attempt to write a readonly database`

Файл `app.db` создан через `sudo`, а сейчас запускаете без sudo:

```bash
sudo chown $USER:$USER app.db app.db-wal app.db-shm 2>/dev/null
```

На будущее: всегда запускайте `webadc sqldb init` **без sudo**.

### `NOT NULL constraint failed: <table>.<col>`

Source не имеет колонки, которая на target NOT NULL. Обновите `app/db_serialize.py` до последней версии — там есть auto-coercion NULL → default.

### `UNIQUE constraint failed: <table>.<id>`

В target уже есть строка с таким PK. Используйте `--on-conflict skip|overwrite|upsert`.

### `no module named 'psycopg2'`

```bash
pip install psycopg2-binary
# Или: apt-get install python3-psycopg2
```

### `password authentication failed for user "samba_api"`

Сбросьте пароль PostgreSQL:

```bash
sudo -u postgres psql -c "ALTER USER samba_api WITH PASSWORD '12345';"
```

### Alembic не найден

```bash
pip install alembic
```

Или используйте `webadc sqldb init` (без Alembic, через `create_all`).

### `webadc` команда не найдена

```bash
sudo install -m 755 webadc /usr/local/bin/webadc
```

### DuckDB-аналитика не работает

Проверьте:
```bash
webadc sqldb stats    # Показывает DuckDB status
```

Если `enabled: False`:
- Установите: `pip install duckdb`
- DB_URL должен быть SQLite (DuckDB работает только с SQLite-файлами)
- Проверьте `SAMBA_DB_DUCKDB_ENABLED=true` в .env

---

## Смотри также

- [README.md](../README.md) — главная документация
- [docs/INSTALL.md](INSTALL.md) — установка
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — архитектура
- [docs/CONFIGURATION.md](CONFIGURATION.md) — конфигурация
