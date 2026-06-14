# Конфигурация

## Переменные окружения (.env)

### DATABASE_URL
```env
DATABASE_URL=file:/custom.db
```
URL базы данных SQLite для Prisma. Используется для хранения локальных настроек фронтенда. По умолчанию — `file:/custom.db`. Файл базы данных создаётся автоматически в корне проекта при первом запуске `prisma db push`.

> **Примечание:** Эта база данных НЕ хранит данные Active Directory. Все AD данные приходят из Python/FastAPI бэкенда.

### SAMBA_API_URL
```env
SAMBA_API_URL=http://localhost:8080/api/v1
```
URL бэкенда Samba AD DC Management API. Используется API-прокси Next.js (`/api/v1/*`) для перенаправления запросов. Если бэкенд работает на другом хосте или порту, укажите его полный URL.

**Примеры:**
```env
# Бэкенд на том же сервере
SAMBA_API_URL=http://localhost:8080/api/v1

# Бэкенд на другом сервере
SAMBA_API_URL=http://192.168.1.100:8080/api/v1

# Бэкенд с HTTPS
SAMBA_API_URL=https://api.example.com/api/v1
```

## Настройка клиента (localStorage)

Пользователь может динамически изменить URL API сервера на странице авторизации. Это сохраняется в localStorage:

| Ключ | Описание | По умолчанию |
|------|----------|-------------|
| `samba-api-url` | URL API сервера | `/api/v1` (прокси через Next.js) |
| `samba-auth-method` | Метод авторизации (`jwt` или `apikey`) | — |
| `samba-access-token` | JWT access token | — |
| `samba-refresh-token` | JWT refresh token | — |
| `samba-api-key` | API ключ | — |
| `samba-user` | JSON с данными пользователя | — |
| `samba-theme` | Тема оформления (`dark` или `light`) | `dark` |
| `samba-lang` | Язык интерфейса (`ru` или `en`) | `ru` |

### Как работает выбор API URL

1. **По умолчанию** (`/api/v1`): запросы идут через Next.js API Proxy → `SAMBA_API_URL` → Python бэкенд
2. **Прямой URL** (`http://server:8080/api/v1`): запросы идут напрямую к Python бэкенду (минуя прокси)

> **Рекомендация:** Используйте путь `/api/v1` по умолчанию. Это решает проблему CORS и позволяет менять бэкенд через `.env` без изменения настроек на клиенте.

## Caddyfile (Reverse Proxy)

```caddy
:81 {
    # Поддержка динамического прокси через query-параметр
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort}
    }

    # По умолчанию — проксируем на Next.js
    handle {
        reverse_proxy localhost:3000
    }
}
```

Caddy работает на порту 81 и проксирует запросы на Next.js (порт 3000). Параметр `?XTransformPort=PORT` позволяет динамически проксировать на другой порт.

## Next.js Конфигурация

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",        // Создать standalone билд для Docker
  typescript: {
    ignoreBuildErrors: true,    // Игнорировать ошибки TypeScript при сборке
  },
  reactStrictMode: false,       // Отключён strict mode для совместимости
};
```

### Output: standalone

Режим `standalone` создаёт оптимизированный билд, который включает только необходимые файлы. Это идеально для Docker-развертывания. После `npm run build` результат находится в `.next/standalone/`.

## i18n (Локализация)

Проект поддерживает два языка:
- **Русский (ru)** — язык по умолчанию
- **English (en)**

Файлы локализации:
- `src/locales/ru.json` — основной файл (самый полный)
- `src/locales/en.json` — английский перевод
- `public/locales/ru/translation.json` — статические файлы
- `public/locales/en/translation.json`

Переключение языка доступно в хедере (кнопка RU/EN).

## Тема оформления

Поддерживаются две темы:
- **Dark** — по умолчанию (серый/чёрный фон с изумрудными акцентами)
- **Light** — светлая тема

Переключение темы доступно в хедере (кнопка с иконкой солнца/луны).

## API Proxy

Файл: `src/app/api/v1/[...path]/route.ts`

API прокси перенаправляет все запросы `/api/v1/*` на Python/FastAPI бэкенд.

**Поддерживаемые HTTP методы:** GET, POST, PUT, PATCH, DELETE

**Перенаправляемые заголовки:**
- `Authorization` (Bearer токен)
- `X-API-Key`
- `Content-Type`
- `Accept`

**Обработка ошибок:**
- Если бэкенд недоступен (ECONNREFUSED), возвращается 502 с сообщением
- Остальные ошибки прокси возвращают 500

**Ограничение размера тела запроса:** 10 МБ
