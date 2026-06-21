# Архитектура проекта

## Общая архитектура

Samba AD Panel построен по архитектуре **Thin Frontend + External Python API** — фронтенд является чистым клиентским SPA, который общается с отдельным Python/FastAPI бэкендом по REST API.

```
┌─────────────────────────────────┐       ┌──────────────────────────────────────┐
│   Next.js Frontend (этот проект)│       │   Python/FastAPI Backend             │
│                                 │  HTTP │   (Samba AD DC Management API)       │
│   Порт: 3000                    │──────▶│   Порт: 8080 (по умолчанию)          │
│   Caddy proxy: :81              │       │                                      │
│                                 │       │   ──────────────────────────────     │
│   ──────────────────────────    │       │   • FastAPI маршруты                 │
│   • React 19 SPA                │       │   • JWT + API Key аутентификация     │
│   • Zustand (состояние)         │       │   • PostgreSQL (пользователи API)    │
│   • localStorage (сессия)       │       │   • samba-tool CLI вызовы            │
│   • Axios (HTTP клиент)         │       │   • LDAP операции                    │
│   • i18next (ru/en)             │       │   • OpenAI интеграция                │
│   • shadcn/ui (компоненты)      │       │   • Shell выполнение команд          │
│   • API Proxy (/api/v1/*)       │       │                                      │
│                                 │       │   ──────────────────────────────     │
│   ──────────────────────────    │       │   Внешние зависимости:               │
│   Серверная часть:              │       │   • Samba AD DC Server               │
│   • API Proxy → бэкенд         │       │   • PostgreSQL 12+                   │
│   • Prisma (SQLite, минимально) │       │   • OpenAI API (опционально)         │
│                                 │       │                                      │
└─────────────────────────────────┘       └──────────────────────────────────────┘
```

## Структура проекта

```
web_project/
├── .env                         # Переменные окружения
├── Caddyfile                    # Конфигурация Caddy reverse proxy
├── package.json                 # Зависимости и скрипты
├── next.config.ts               # Конфигурация Next.js (standalone)
├── prisma/
│   └── schema.prisma            # Схема SQLite (User + Post — шаблонные)
├── public/
│   ├── logo.svg                 # Логотип
│   ├── logo_1.svg               # Альтернативный логотип
│   └── locales/                 # Статические файлы локализации
│       ├── en/translation.json
│       └── ru/translation.json
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Корневой layout (шрифты, Sonner, заголовок)
│   │   ├── page.tsx             # Главная страница (роутер + auth gate)
│   │   ├── globals.css          # Глобальные стили
│   │   └── api/
│   │       ├── route.ts         # Stub GET /api
│   │       └── v1/[...path]/    # ★ API Proxy (прокси к Python бэкенду)
│   │           └── route.ts
│   ├── components/
│   │   ├── auth/                # Страница авторизации
│   │   │   └── LoginPage.tsx
│   │   ├── layout/              # Основной layout (сайдбар + хедер)
│   │   │   └── MainLayout.tsx
│   │   ├── dashboard/           # Дашборд
│   │   ├── users/               # Управление пользователями AD
│   │   ├── groups/              # Управление группами
│   │   ├── computers/           # Управление компьютерами
│   │   ├── contacts/            # Управление контактами
│   │   ├── ous/                 # Подразделения (OU)
│   │   ├── dns/                 # DNS управление
│   │   ├── gpo/                 # Групповые политики
│   │   ├── domain/              # Информация о домене
│   │   ├── shell/               # Терминал и проекты
│   │   ├── etl/                 # ETL конвейер + AI ассистент
│   │   ├── audit/               # Аудит
│   │   ├── management/          # Управление API-пользователями
│   │   ├── permissions/         # Компонент проверки прав
│   │   ├── shared/              # Общие компоненты (AttributeViewer, таблицы)
│   │   └── ui/                  # shadcn/ui компоненты (30+ штук)
│   ├── stores/
│   │   ├── auth-store.ts        # Zustand store авторизации
│   │   ├── etl-store.ts         # Zustand store ETL конвейера
│   │   └── shell-store.ts       # Zustand store shell терминала
│   ├── lib/
│   │   ├── api.ts               # Axios клиент (baseURL, interceptors)
│   │   ├── api-types.ts         # TypeScript типы API (50+ интерфейсов)
│   │   ├── api-operations.ts    # Определения операций ETL
│   │   ├── api-ai.ts            # AI API сервис (ассистент + агент)
│   │   ├── db.ts                # Prisma клиент (singleton)
│   │   ├── parsers.ts           # Парсеры вывода samba-tool
│   │   ├── i18n.ts              # Конфигурация i18next
│   │   └── utils.ts             # Утилиты (cn() для Tailwind)
│   ├── types/
│   │   ├── index.ts             # Основные типы (User, ETLStep, etc.)
│   │   └── ai.ts                # Типы AI ассистента
│   ├── hooks/                   # React hooks (use-toast, use-mobile)
│   └── locales/                 # Файлы локализации (ru.json, en.json)
└── docs/                        # Документация проекта
```

## Ключевые модули

### 1. Система авторизации

Компоненты:
- `LoginPage.tsx` — UI формы авторизации (пароль / API-ключ)
- `auth-store.ts` — Zustand store хранения JWT/API-Key + данные пользователя
- `api.ts` — Axios interceptors для автоматической отправки auth-заголовков

Поток авторизации:

```
Пользователь → LoginPage → POST /auth/login → Бэкенд
                                                      ↓
                                              { access_token, refresh_token, role, permissions }
                                                      ↓
                                     auth-store.setJWTAuth() → localStorage
                                                      ↓
                                              Страница перезагружается
                                                      ↓
                                     page.tsx: isAuthenticated = true → MainLayout
```

### 2. API Proxy

Файл: `src/app/api/v1/[...path]/route.ts`

Все запросы к `/api/v1/*` проксируются на Python/FastAPI бэкенд. Это решает проблему CORS и позволяет фронтенду работать с бэкендом через относительный путь.

```
Фронтенд (Axios) → /api/v1/users/list → Next.js API Proxy → http://localhost:8080/api/v1/users/list → Бэкенд
```

### 3. Система прав доступа

Роли:
- **admin** — полный доступ ко всем функциям
- **operator** — управление объектами AD
- **auditor** — только просмотр и аудит
- **viewer** — минимальный доступ только для чтения

Компонент `RequirePermission` блокирует доступ к UI при отсутствии прав. Навигация показывает замок рядом с недоступными разделами.

### 4. ETL Конвейер

Визуальный конструктор пакетных операций AD. Позволяет:
- Создавать цепочки операций (создать пользователя → добавить в группу → настроить OU)
- Связывать шаги через field mappings (вывод предыдущего шага → вход следующего)
- Импортировать данные из CSV/Excel
- Выполнять конвейер как batch-операцию

### 5. AI Интеграция

- **AI Ассистент** (`/ai/assistant`) — добавляет ноды в ETL конвейер на основе текстового описания. В Safe Mode затирает чувствительные данные перед отправкой.
- **AI Агент** (`/ai/agent`) — автономно выполняет API-запросы на бэкенде. Динамический таймаут: 1 шаг = 1 минута.

## Хранение состояния

Все состояние хранится на клиенте:

| Данные | Хранилище | Ключ |
|--------|-----------|------|
| Метод авторизации | localStorage | `samba-auth-method` |
| JWT access token | localStorage | `samba-access-token` |
| JWT refresh token | localStorage | `samba-refresh-token` |
| API ключ | localStorage | `samba-api-key` |
| Данные пользователя | localStorage | `samba-user` |
| URL API сервера | localStorage | `samba-api-url` |
| Тема (светлая/тёмная) | localStorage | `samba-theme` |
| Язык | localStorage | `samba-lang` |
| ETL конвейер | Zustand | `etl-store` |
| Shell терминал | Zustand | `shell-store` |

> **Важно:** Zustand store не персистентный — при перезагрузке страницы ETL конвейер и Shell состояние сбрасываются. Auth state персистентен через localStorage.
