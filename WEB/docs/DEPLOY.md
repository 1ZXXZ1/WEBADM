# Развертывание в продакшн

## Вариант 1: Standalone + Caddy (рекомендуемый)

### Шаг 1: Сборка

```bash
# Установить зависимости
npm install

# Собрать standalone билд
npm run build
```

Скрипт `npm run build` выполняет:
1. `next build` — сборка приложения
2. Копирование `.next/static` в `.next/standalone/.next/`
3. Копирование `public` в `.next/standalone/`

### Шаг 2: Настройка окружения

Создайте `.env` в директории `.next/standalone/`:

```env
DATABASE_URL=file:/custom.db
SAMBA_API_URL=http://localhost:8080/api/v1
PORT=3000
NODE_ENV=production
```

### Шаг 3: Запуск

```bash
# С Node.js
NODE_ENV=production node .next/standalone/server.js

# С Bun (быстрее)
NODE_ENV=production bun .next/standalone/server.js
```

### Шаг 4: Настройка Caddy

Установите Caddy и используйте предоставленный `Caddyfile`:

```bash
# Скопировать Caddyfile
sudo cp Caddyfile /etc/caddy/Caddyfile

# Запустить Caddy
sudo systemctl start caddy
```

Приложение будет доступно на порту **81**.

## Вариант 2: Docker

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/custom.db
ENV SAMBA_API_URL=http://samba-api:8080/api/v1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/custom.db
      - SAMBA_API_URL=http://api:8080/api/v1
    restart: unless-stopped

  api:
    image: samba-ad-api:latest
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/samba_api
    restart: unless-stopped

  caddy:
    image: caddy:alpine
    ports:
      - "81:81"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=samba_api
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  pgdata:
```

Запуск:
```bash
docker-compose up -d
```

## Вариант 3: Systemd сервис

Создайте файл `/etc/systemd/system/samba-ad-panel.service`:

```ini
[Unit]
Description=Samba AD Panel - Next.js Frontend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/samba-ad-panel
ExecStart=/usr/bin/node /opt/samba-ad-panel/.next/standalone/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=DATABASE_URL=file:/custom.db
Environment=SAMBA_API_URL=http://localhost:8080/api/v1
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable samba-ad-panel
sudo systemctl start samba-ad-panel
```

## Настройка SSL/HTTPS

### С Caddy (автоматический HTTPS)

Caddy автоматически получает SSL-сертификаты от Let's Encrypt. Замените `:81` на домен:

```caddy
panel.example.com {
    reverse_proxy localhost:3000
}
```

### С Nginx (ручной SSL)

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate /etc/ssl/certs/panel.crt;
    ssl_certificate_key /etc/ssl/private/panel.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Мониторинг

### Проверка здоровья

```bash
# Здоровье Next.js
curl http://localhost:3000/api

# Здоровье бэкенда (через прокси)
curl http://localhost:3000/api/v1/health

# Здоровье Caddy
curl http://localhost:81
```

### Логи

```bash
# Логи Next.js (при запуске через tee)
tail -f server.log

# Логи Caddy
sudo journalctl -u caddy -f

# Логи systemd сервиса
sudo journalctl -u samba-ad-panel -f
```

## Масштабирование

Для высокой доступности:

1. Запустите несколько инстансов Next.js на разных портах
2. Используйте Caddy/Nginx для балансировки нагрузки
3. Разделите static файлы на CDN
4. Убедитесь, что Python бэкенд также масштабирован

```caddy
:81 {
    reverse_proxy {
        to localhost:3000
        to localhost:3001
        to localhost:3002
        lb_policy round_robin
    }
}
```
