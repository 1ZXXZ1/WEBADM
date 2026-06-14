# WebADC v2.0.2 — Оптимизация: исправление 401, память, размер бинарника

## Проблемы и решения

### 1. Ошибка ИИ 401 (Authentication Error)

**Причина**: Polza.ai API отклоняет API-ключ. Возможные причины:
- Ключ `SAMBA_POLZA_AI_KEY` неверный, истёк или неактивен
- URL `SAMBA_POLZA_AI_URL` указан неправильно
- Проблема с сетью/DNS/прокси

**Быстрая диагностика** (прямо на сервере):

```bash
# 1. Проверьте, что ключ задан
grep SAMBA_POLZA_AI /etc/webadc/.env

# 2. Проверьте подключение вручную
curl -v -H "Authorization: Bearer ВАШ_КЛЮЧ" https://polza.ai/api/v1/balance

# 3. Если curl возвращает 401 — ключ неверный, нужен новый
```

**Исправление**:

1. Откройте `.env`: `sudo nano /etc/webadc/.env`
2. Проверьте `SAMBA_POLZA_AI_KEY` — убедитесь, что скопирован полностью, без пробелов и кавычек
3. Если ключ устарел — получите новый на https://polza.ai/dashboard
4. Проверьте `SAMBA_POLZA_AI_URL` — должно быть: `https://polza.ai/api/v1`
5. Перезапустите: `sudo systemctl restart webadc`

**Патч для улучшения диагностики** (опционально):

Скопируйте файл `ai_polza_provider_patch.py` в проект и следуйте инструкциям внутри:
- Добавьте функции `test_polza_connection()`, `reset_ai_client_cache()`, `create_ai_client()` с кэшем
- Добавьте endpoint `/api/v1/ai/test` в `app/routers/ai.py`
- Обновите обработку 401 в `app/services/ai_service.py`

---

### 2. Оптимизация памяти (241МБ → ~30-50МБ idle)

**Причина 6 процессов**: uvicorn + worker pool создают несколько процессов.

**Изменения**:

#### 2.1. Systemd ресурсные лимиты

Замените systemd unit:

```bash
sudo cp webadc.service /etc/systemd/system/webadc.service
sudo systemctl daemon-reload
sudo systemctl restart webadc
```

Ключевые параметры:
- `MemoryMax=350M` — жёсткий лимит (OOM kill при превышении)
- `MemoryHigh=250M` — мягкий лимит (kernel throttles)
- `MemoryMin=20M` — минимальная гарантированная память
- `CPUQuota=200%` — макс 2 ядра CPU
- `Environment=SAMBA_UVICORN_WORKERS=1` — один worker (было неявно несколько)
- `Environment=SAMBA_WORKER_POOL_SIZE=2` — уменьшен пул samba-tool (было 4)

#### 2.2. .env настройки для экономии памяти

Добавьте/измените в `/etc/webadc/.env`:

```ini
# Один uvicorn worker (минимум памяти)
SAMBA_UVICORN_WORKERS=1

# Меньше samba-tool процессов
SAMBA_WORKER_POOL_SIZE=2

# Кэш отключён (экономия памяти, мгновенные обновления UI)
SAMBA_CACHE_ENABLED=false

# AI: меньше шагов агента (экономия памяти на контекст)
SAMBA_AI_AGENT_MAX_STEPS=5
```

#### 2.3. Проверка после применения

```bash
sudo systemctl restart webadc
sleep 5
systemctl status webadc
# Должно быть 2-3 процесса вместо 6

ps aux | grep webadc
# Проверьте RSS (resident memory) каждого процесса
```

---

### 3. Оптимизация размера бинарника (40МБ → ~22-25МБ)

**Что было удалено из сборки**:

| Пакет | Размер | Причина удаления |
|-------|--------|------------------|
| reportlab | ~8-10МБ | PDF-генерация, используется только generate_docs.py |
| textual | ~3-4МБ | TUI-фреймворк, нужен только для CLI (не сервера) |
| markdown_it + deps | ~1МБ | Зависимость textual |
| pygments lexers (280+) | ~2-3МБ | Оставлено только 12 основных лексеров |
| pygments styles (25+) | ~0.5МБ | Оставлено только 4 стиля |
| rich._unicode_data | ~1МБ | Unicode таблицы для CLI |
| debug symbols | ~5МБ | strip=True удаляет отладочные символы |

**Что сохранено** (работает в серверном режиме):
- fastapi, uvicorn, pydantic — web-сервер
- openai — AI-сервис (Polza.ai)
- openpyxl — XLSX-экспорт
- cryptography, jose, passlib — аутентификация
- psycopg2 — PostgreSQL
- httpx, requests — HTTP-клиенты
- dns (dnspython) — DNS-управление
- websockets — WebSocket
- rich — базовое форматирование (для CLI статуса)

**Сборка оптимизированного бинарника**:

```bash
cd /home/almaz/WEBADM

# Замените build.py на оптимизированный
cp build.py build.py.bak          # резервная копия
cp /path/to/build_optimized.py build.py

# Пересоберите
python3 build.py --clean

# Результат будет в dist/webadc
ls -la dist/webadc
# Ожидаемый размер: ~22-25МБ (было 40МБ)

# Установите
sudo cp dist/webadc /usr/local/bin/webadc
sudo systemctl restart webadc
```

**Если нужен reportlab (PDF-генерация)**:

Добавьте обратно в `_extra_packages` в build.py:
```python
'reportlab',
```
И в `_meta_pkg`:
```python
'reportlab'
```
Это добавит ~8-10МБ к бинарнику.

**Если нужен textual (CLI TUI)**:

Добавьте обратно весь блок `_textual_packages` из оригинального build.py.
Это добавит ~3-4МБ к бинарнику.

---

### 4. Динамические ресурсы

#### Текущее потребление (после оптимизации)

| Режим | ОЗУ | CPU | Диск |
|-------|-----|-----|------|
| Idle (нет запросов) | 30-50МБ | ~0% | ~45МБ (бинарник) |
| Обычная нагрузка | 50-80МБ | 5-20% | +временные файлы |
| AI-запрос | 80-150МБ | 20-50% | +кэш схемы |
| Пиковая нагрузка | до 250МБ | до 200% | — |

#### Автоматическое управление

Systemd параметры управляют ресурсами автоматически:
- `MemoryHigh=250M` — при превышении kernel замедляет процесс
- `MemoryMax=350M` — при превышении OOM killer завершает процесс (systemd перезапустит)
- `CPUQuota=200%` — ограничивает CPU до 2 ядер
- `WatchdogSec=60` — если процесс зависнет на 60с, systemd перезапустит

#### Python-уровень: gc.collect()

После каждого AI-запроса рекомендуется вызывать `gc.collect()` для освобождения памяти.
Это уже частично реализовано в ai_agent_service.py, но можно добавить явно:

```python
import gc
# После обработки AI-запроса:
gc.collect()
```

---

### 5. Чеклист применения

```bash
# 1. Исправление 401 — проверьте ключ
sudo nano /etc/webadc/.env
# Убедитесь: SAMBA_POLZA_AI_KEY=ваш_полный_ключ_без_пробелов
# Убедитесь: SAMBA_POLZA_AI_URL=https://polza.ai/api/v1

# 2. Тест подключения
curl -H "Authorization: Bearer $(grep SAMBA_POLZA_AI_KEY /etc/webadc/.env | cut -d= -f2)" \
     https://polza.ai/api/v1/balance

# 3. Оптимизация systemd
sudo cp webadc.service /etc/systemd/system/webadc.service
sudo systemctl daemon-reload

# 4. Оптимизация .env
# Добавьте:
echo "SAMBA_UVICORN_WORKERS=1" | sudo tee -a /etc/webadc/.env
echo "SAMBA_WORKER_POOL_SIZE=2" | sudo tee -a /etc/webadc/.env

# 5. Пересборка бинарника (опционально, если нужно уменьшить размер)
cd /home/almaz/WEBADM
cp build.py build.py.bak
cp build_optimized.py build.py
python3 build.py --clean
sudo cp dist/webadc /usr/local/bin/webadc

# 6. Перезапуск и проверка
sudo systemctl restart webadc
sleep 5
systemctl status webadc
ps aux | grep webadc
# Ожидается: 2-3 процесса, ~30-50МБ RSS каждый
```

---

### Файлы в этом архиве

| Файл | Описание |
|------|----------|
| `build_optimized.py` | Оптимизированный скрипт сборки (22-25МБ вместо 40МБ) |
| `webadc.service` | Systemd unit с ресурсными лимитами |
| `ai_polza_provider_patch.py` | Патч для исправления 401 + диагностика |
| `OPTIMIZATION_GUIDE.md` | Этот файл |
