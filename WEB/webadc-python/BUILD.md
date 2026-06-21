# WebADC Python — Руководство по сборке и запуску

## Структура проекта

```
webadc-python/
├── main.py              # FastAPI сервер + прокси + HTTPS
├── requirements.txt     # Python-зависимости
├── .env                 # Конфигурация
├── run.sh               # Быстрый запуск
├── .gitignore
├── BUILD.md             # Этот файл
└── static/              # ← сюда копируем Next.js export
    ├── index.html
    ├── _next/
    └── ...
```

---

## Шаг 1: Сборка Next.js (Static Export)

В проекте Next.js:

### 1.1. Изменить `next.config.ts`

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    unoptimized: true,
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
```

### 1.2. Исправить `src/lib/api.ts`

```typescript
const DEFAULT_API_URL = '/api/v1';   // БЫЛО: 'http://127.0.0.1:8099/api/v1'
```

### 1.3. Удалить API-маршруты (export не поддерживает)

```bash
mv src/app/api src/app/_api_disabled
```

### 1.4. Собрать

```bash
npx next build
# Результат в out/
```

---

## Шаг 2: Копирование статики

```bash
rm -rf webadc-python/static/*
cp -r out/* webadc-python/static/
```

---

## Шаг 3: Запуск

### Вариант A: Быстрый запуск

```bash
cd webadc-python
bash run.sh
```

### Вариант B: Вручную

```bash
cd webadc-python

# Установить зависимости (один раз)
pip install -r requirements.txt

# Запустить
python3 main.py
```

### Вариант C: Как systemd сервис

Создайте `/etc/systemd/system/webadc.service`:

```ini
[Unit]
Description=WebADC — Samba AD Web Panel
After=network.target

[Service]
Type=simple
User=almaz
WorkingDirectory=/home/almaz/WEB/webadc-python
ExecStart=/usr/bin/python3 /home/almaz/WEB/webadc-python/main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable webadc
sudo systemctl start webadc
journalctl -u webadc -f
```

---

## Конфигурация (.env)

```env
LISTEN_ADDR=0.0.0.0
LISTEN_PORT=443
SAMBA_API_URL=http://192.168.104.12:8099
```

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `LISTEN_ADDR` | `0.0.0.0` | Адрес слушателя |
| `LISTEN_PORT` | `443` | Порт (443 требует root или setcap) |
| `SAMBA_API_URL` | `http://192.168.104.12:8099` | URL бэкенда, БЕЗ /api/v1 |
| `STATIC_DIR` | `./static` | Путь к статике |
| `CERT_FILE` | `cert.pem` | TLS сертификат |
| `KEY_FILE` | `key.pem` | TLS ключ |

### Запуск без root на порту 443

```bash
# Дать Python право на привилегированные порты
sudo setcap 'cap_net_bind_service=+ep' $(which python3)
```

### Запуск на другом порту

```env
LISTEN_PORT=8443
```

---

## Проксирование API

| Запрос браузера | Куда проксируется |
|----------------|------------------|
| `GET /api/v1/users` | `http://192.168.104.12:8099/api/v1/users/` |
| `POST /api/v1/users` | `http://192.168.104.12:8099/api/v1/users/` |
| `GET /api/v1/users/john` | `http://192.168.104.12:8099/api/v1/users/john` |
| `GET /api/v1/ai/chat` | `http://192.168.104.12:8099/api/v1/ai/chat/` |

**Проксируемые заголовки:** Authorization, X-API-Key, Content-Type, Accept

**SSE streaming:** прозрачно проксируется для AI чата
