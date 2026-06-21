# WebADC — Samba AD DC Management API + Web Panel

**Версия:** `pe-a-1.4`

Промышленный REST API-сервер + Web Panel для управления Samba AD DC через `samba-tool`. Работает на одном порту (8099), поддерживает HTTPS, JWT-аутентификацию, 2FA, audit log, бан-систему, AI-чат и единый DB-слой на SQLAlchemy + Alembic + DuckDB.

---

## 📦 Возможности

- **Полное покрытие samba-tool**: пользователи, группы, компьютеры, контакты, OU, DNS, GPO, FSMO, DRS, sites, schema
- **Единый DB-слой** (pe-a-1.4): SQLAlchemy ORM + Alembic миграции + DuckDB-аналитика, SQLite или PostgreSQL через `DB_URL`
- **Аутентификация**: API-ключи (`X-API-Key`) + JWT (`Authorization: Bearer`) + 2FA (TOTP)
- **HTTPS с auto-gen SSL**: `webadc ssl generate` или auto-mode в `webadc run`
- **Web Panel**: SPA на `/` (можно отключить через `WEB_ENABLED=false`)
- **CLI**: `webadc` команда (start/stop/restart/status/sqldb/ssl/sdb/ban/ds/...)
- **Бан-система**: временные/постоянные баны пользователей и API-ключей
- **AI-чат**: встроенный AI-ассистент с историей сессий
- **Audit log**: все действия логируются с IP, user-agent, duration
- **DuckDB-аналитика**: быстрые SQL-запросы поверх SQLite без нагрузки на основную БД
- **Сериализация БД**: dump/restore/transfer между любыми бэкендами (SQLite ↔ PostgreSQL ↔ MySQL)

---

## 🚀 Быстрый старт

### 1. Установка

```bash
# Копируем в /opt/webadc
sudo cp -r WEBADC-git /opt/webadc
cd /opt/webadc

# Устанавливаем wrapper как системную команду
sudo install -m 755 webadc /usr/local/bin/webadc

# Устанавливаем Python-зависимости
pip install -r requirements.txt
# или на ALT Linux: apt-get install python3-psycopg2 python3-sqlalchemy
```

### 2. Конфигурация

```bash
# Копируем пример .env
cp .env.example .env

# Редактируем (минимум — API_KEY и DB_URL)
sudo nano /etc/webadc/.env   # или ./.env для dev
```

Минимальные настройки:
```ini
SAMBA_API_KEY=your-secret-api-key
DB_URL=sqlite:///app.db
WEB_ENABLED=true
```

### 3. Инициализация БД

```bash
# Создаём схему + admin/admin
webadc sqldb init

# Применяем Alembic миграции (если есть)
webadc sqldb upgrade

# Проверяем
webadc sqldb status
```

### 4. SSL сертификат (для HTTPS)

```bash
# Вариант A: авто-генерация self-signed
sudo webadc ssl generate

# Вариант B: при запуске сервера спросит автоматически
sudo webadc run
# → "Сгенерировать self-signed сертификат в /etc/webadc/ssl/? [Y/n]" → y

# Вариант C: использовать готовые сертификаты
sudo webadc ssl enable --cert /path/cert.crt --key /path/cert.key

# Вариант D: отключить HTTPS (работать на HTTP)
webadc ssl disable
```

### 5. Запуск

```bash
# Dev-режим (с auto-reload)
webadc run

# Production через systemd
sudo cp webadc.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webadc
sudo systemctl status webadc
```

Сервер поднимется на `https://0.0.0.0:8099`.

---

## 🗄️ База данных (pe-a-1.4)

Единый DB-слой на SQLAlchemy 2.0 + Alembic + DuckDB. Все команды — через `webadc sqldb`.

### Поддерживаемые бэкенды

| Бэкенд | DB_URL | Когда использовать |
|--------|--------|-------------------|
| **SQLite** (по умолчанию) | `sqlite:///app.db` | Dev, малые инсталляции, single-node |
| **PostgreSQL** | `postgresql+psycopg2://user:pwd@host:5432/db` | Production, multi-node, репликация |
| **MySQL** | `mysql+pymysql://user:pwd@host:3306/db` | Если уже есть MySQL-инфраструктура |
| **DuckDB** | `duckdb:///app.duckdb` | Только аналитика (read-only) |

### Основные команды

```bash
webadc sqldb init                    # Создать схему + admin/admin
webadc sqldb upgrade                 # Применить миграции
webadc sqldb status                  # Обзор БД (DB_URL, размер, top-10 таблиц)
webadc sqldb stats                   # Row counts по всем таблицам
webadc sqldb info                    # Конфигурация + список таблиц
webadc sqldb current                 # Текущая Alembic миграция

webadc sqldb show mgmt_users 1       # Показать запись по PK
webadc sqldb keys                    # Список API-ключей
webadc sqldb audit --limit 50        # Последние записи аудита
webadc sqldb purge mgmt_audit_log    # Очистить таблицу (с подтверждением)

webadc sqldb query "SELECT * FROM app.mgmt_users"   # SQL через DuckDB
webadc sqldb shell                                    # Python REPL
```

### Сериализация (dump/restore/transfer)

```bash
# Backup в JSONL
webadc sqldb dump --out backup.jsonl

# Восстановить (с интерактивным выбором при конфликтах PK)
webadc sqldb restore --in backup.jsonl --on-conflict ask

# Прямой перенос PostgreSQL → SQLite
webadc sqldb transfer \
  --from "postgresql+psycopg2://samba_api:12345@localhost:5432/samba_api" \
  --to "sqlite:///app.db" \
  --on-conflict overwrite

# Проверить подключение к БД без записи
webadc sqldb test-url "postgresql+psycopg2://user:pwd@host:5432/db"
```

### Режимы `--on-conflict`

| Режим | Поведение |
|-------|----------|
| `ask` | Спросить интерактивно (по умолчанию) |
| `skip` | Пропустить source-строку |
| `overwrite` | Удалить target-строку, вставить source |
| `upsert` | UPDATE target-строки |
| `fail` | Прервать при первом конфликте |

Подробнее — в [docs/sqldb.md](docs/sqldb.md).

---

## 🔐 SSL/HTTPS

```bash
webadc ssl generate                  # Self-signed в /etc/webadc/ssl/
webadc ssl generate --host ad.local  # Для конкретного hostname
webadc ssl check                     # Проверить конфигурацию
webadc ssl disable                   # Отключить HTTPS
webadc ssl enable --cert C --key K   # Включить с готовым cert
```

**Auto-mode**: при `webadc run` если SSL прописан в `.env` но файлов нет — предложит сгенерировать автоматически.

**Клиенты** (`webadc ds`, `webadc sdb`) по умолчанию используют HTTPS и не проверяют сертификат (для self-signed). Включить проверку: `--verify` или `SAMBA_API_VERIFY_SSL=1`.

---

## 🛠️ CLI команды

```
webadc {start,stop,restart,status,show,ds,edt,auth,health,version,run,sdb,ban,ssl,sqldb}
```

| Команда | Описание |
|---------|----------|
| `webadc start` | Запуск API + Web серверов |
| `webadc stop` | Остановка |
| `webadc restart` | Перезапуск |
| `webadc status` | Статус сервера (systemd + health + логи) |
| `webadc run` | Dev-запуск uvicorn (с --reload, auto-gen SSL) |
| `webadc version` | Показать версию |
| `webadc ds` | DS Auth CLI (login, key, role, audit, ...) |
| `webadc sdb` | SDB CLI (SQL-подобный клиент для Samba LDB) |
| `webadc ban` | Управление банами |
| `webadc ssl` | Управление SSL сертификатами |
| `webadc sqldb` | Единый DB-слой (init/migrate/dump/transfer/...) |
| `webadc edt` | Редактировать .env |
| `webadc auth` | Проверить аутентификацию DS |
| `webadc health` | Health check сервера |

---

## 📁 Структура проекта

```
WEBADC/
├── cli.py                    # Главный CLI (entry point для webadc)
├── cli_sqldb.py              # sqldb подкоманды (rich UI)
├── ds_auth.py                # DS Auth CLI
├── ai_chat_cli.py            # AI Chat CLI
├── webadc                    # Wrapper-скрипт для /usr/local/bin/webadc
├── webadc.service            # systemd unit
├── .env.example              # Пример конфигурации
├── requirements.txt          # Python-зависимости
├── alembic.ini               # Alembic конфигурация
├── alembic/
│   ├── env.py                # Alembic environment
│   ├── script.py.mako        # Шаблон миграции
│   └── versions/
│       └── 0001_initial.py   # Initial миграция (все таблицы)
├── app/
│   ├── main.py               # FastAPI app entry point
│   ├── config.py             # Settings (pydantic-settings)
│   ├── db_sqlalchemy.py      # Engine, Session, Base, get_db, init_db
│   ├── db_init.py            # Seed admin/admin + роли
│   ├── db_analytics.py       # DuckDB read-only аналитика
│   ├── db_serialize.py       # dump/restore/transfer БД
│   ├── models_sqla/          # SQLAlchemy ORM модели
│   │   ├── base.py
│   │   ├── mgmt.py           # mgmt_users, mgmt_api_keys, mgmt_roles, mgmt_audit_log
│   │   ├── ai_chat.py        # ai_chat_sessions, ai_chat_messages
│   │   ├── ban.py            # mgmt_bans
│   │   ├── chat.py           # chat_rooms, chat_members, chat_messages, ...
│   │   └── chat_calls.py     # chat_calls
│   ├── routers/              # FastAPI роутеры
│   ├── services/             # Бизнес-логика
│   ├── auth_jwt.py           # JWT-аутентификация
│   ├── totp.py               # 2FA (TOTP)
│   └── ...
├── docs/
│   ├── README.md             # Документация API
│   ├── sqldb.md              # Документация DB-слоя (pe-a-1.4)
│   ├── INSTALL.md
│   ├── ARCHITECTURE.md
│   └── ...
└── tests/                    # Тесты
```

---

## ⚙️ Конфигурация (.env)

Основные переменные (полный список — в `.env.example`):

### DB
```ini
DB_URL=sqlite:///app.db                            # или postgresql+psycopg2://...
SAMBA_DB_ECHO=false                               # лог SQL
SAMBA_DB_POOL_SIZE=5                              # размер пула (для PG/MySQL)
SAMBA_DB_DUCKDB_ENABLED=true                      # DuckDB-аналитика
```

### Server
```ini
SAMBA_API_HOST=0.0.0.0
SAMBA_API_PORT=8099
SAMBA_API_KEY=changeme-api-key
WEB_ENABLED=true
```

### SSL/HTTPS
```ini
SAMBA_SSL_CERTFILE=/etc/webadc/ssl/apiadc.crt     # пусто = HTTP
SAMBA_SSL_KEYFILE=/etc/webadc/ssl/apiadc.key
SAMBA_API_VERIFY_SSL=0                            # 0=self-signed OK, 1=строгая проверка
SAMBA_API_SERVER=https://127.0.0.1:8099           # для CLI-клиентов
```

### Samba AD
```ini
SAMBA_SERVER=dc1.example.com
SAMBA_REALM=EXAMPLE.COM
SAMBA_LDAPI_URL=ldapi:///var/lib/samba/private/ldap_priv/ldapi
SAMBA_TDB_URL=tdb:///var/lib/samba/private/sam.ldb
```

---

## 🔧 Устранение неисправностей

### Сервер не запускается с HTTPS

```bash
webadc ssl check                    # Проверить SSL конфигурацию
sudo webadc ssl generate            # Сгенерировать self-signed
# Или отключить HTTPS:
webadc ssl disable
```

### Ошибка прав на app.db

```bash
sudo chown $USER:$USER app.db app.db-wal app.db-shm 2>/dev/null
# На будущее: всегда запускайте webadc sqldb init без sudo
```

### CLI не может подключиться к серверу

```bash
webadc health                       # Проверить health endpoint
webadc ssl check                    # Проверить SSL
# Если self-signed cert:
webadc ds --insecure login admin admin
```

### Миграция PostgreSQL → SQLite

```bash
# 1. Проверить подключение к PostgreSQL
webadc sqldb test-url "postgresql+psycopg2://user:pwd@host:5432/db"

# 2. Перенести данные
webadc sqldb transfer \
  --from "postgresql+psycopg2://user:pwd@host:5432/db" \
  --to "sqlite:///app.db" \
  --on-conflict overwrite

# 3. Проверить
webadc sqldb status
```

---

## 📚 Документация

- [docs/README.md](docs/README.md) — API документация
- [docs/sqldb.md](docs/sqldb.md) — DB-слой (SQLAlchemy + Alembic + DuckDB)
- [docs/INSTALL.md](docs/INSTALL.md) — Установка
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Архитектура
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — Конфигурация
- [docs/DEPLOY.md](docs/DEPLOY.md) — Деплой
- [docs/TESTING.md](docs/TESTING.md) — Тестирование

---

## 📋 Changelog

### pe-a-1.4
- **Единый DB-слой**: SQLAlchemy 2.0 + Alembic + DuckDB
- **Команда `webadc sqldb`**: init/upgrade/dump/restore/transfer/show/purge/keys/audit/...
- **Команда `webadc ssl`**: generate/check/disable/enable + auto-gen в `run`
- **Удалён старый `webadc db`** (JSON file storage)
- **HTTPS по умолчанию** в CLI-клиентах (`ds_auth.py`, `ai_chat_cli.py`)
- **`rich` UI**: красивые таблицы, прогресс-бары, ASCII-fallback
- **Интерактивные конфликты** при transfer/restore (ask/skip/overwrite/upsert/fail)
- **Cross-backend сериализация**: JSONL dump/restore, прямой DB-to-DB transfer
- **Auto-sync схемы**: при transfer автоматически добавляются недостающие колонки/таблицы
- **NULL→default coercion**: автоматическая замена NULL для NOT NULL колонок

### pe-a-1.3
- Базовая версия с psycopg2 PostgreSQL backend
- JSON file storage для кеша

---

## 📄 Лицензия

См. LICENSE файл.

---

## 🆘 Поддержка

- Логи: `journalctl -u webadc -f`
- Health: `webadc health`
- Статус: `webadc status`
- Документация API: `https://your-host:8099/docs`
