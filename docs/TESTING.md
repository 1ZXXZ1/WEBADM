# Тестирование и отладка

## Ручное тестирование

### 1. Проверка API-прокси

Убедитесь, что API-прокси корректно перенаправляет запросы к бэкенду:

```bash
# Проверка health эндпоинта через прокси
curl http://localhost:3000/api/v1/health

# Ожидаемый ответ:
# {"status":"ok","version":"2.8","server_role":"active directory domain controller"}
```

Если получаете ошибку 502:
```
{"status":"error","detail":"Cannot connect to Samba AD API backend at http://localhost:8080/api/v1..."}
```
Это означает, что Python/FastAPI бэкенд недоступен. Проверьте:
1. Запущен ли бэкенд: `curl http://localhost:8080/api/v1/health`
2. Правильный ли `SAMBA_API_URL` в `.env`
3. Нет ли блокировки фаерволом

### 2. Тестирование авторизации

#### Вход по паролю
```bash
# Через API-прокси
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# Ожидаемый ответ:
# {"access_token":"eyJ...","refresh_token":"eyJ...","token_type":"bearer","user":{...}}
```

#### Вход по API-ключу
```bash
curl -X POST http://localhost:3000/api/v1/auth/check \
  -H "X-API-Key: sk-xxxxxxxxxxxx"

# Ожидаемый ответ:
# {"valid":true,"role":"admin","user_id":1,"permissions":[...]}
```

#### Проверка текущего пользователя
```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

#### Обновление токена
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'
```

### 3. Тестирование AD операций

```bash
# Список пользователей
curl http://localhost:3000/api/v1/users/list \
  -H "Authorization: Bearer <token>"

# Список групп
curl http://localhost:3000/api/v1/groups/list \
  -H "Authorization: Bearer <token>"

# Список DNS зон
curl http://localhost:3000/api/v1/dns/zones \
  -H "Authorization: Bearer <token>"

# Информация о домене
curl http://localhost:3000/api/v1/domain/info \
  -H "Authorization: Bearer <token>"
```

## Отладка в браузере

### DevTools (F12)

1. **Console** — проверяйте ошибки JavaScript и API-запросов
2. **Network** — анализируйте HTTP-запросы и ответы
   - Фильтр: `XHR` для API-запросов
   - Проверяйте статус-коды и тела ответов
3. **Application → Local Storage** — проверяйте ключи `samba-*`
4. **React DevTools** — инспектируйте компоненты и props

### Типичные проблемы

#### 401 Unauthorized

**Симптомы:** После входа API-запросы возвращают 401.

**Причины и решения:**
1. **Истёк access token** — автоматически обновляется через refresh token. Если refresh тоже истёк — перезайдите.
2. **Несовпадение baseURL** — проверьте `localStorage.getItem('samba-api-url')`
3. **Проблема с прокси** — если используете прямой URL вместо `/api/v1`, убедитесь, что CORS настроен на бэкенде

#### Пустой список объектов

**Симптомы:** Страница пользователей/групп загружается, но список пустой.

**Причины:**
1. **Недостаточно прав** — проверьте permissions пользователя
2. **Ошибка парсинга** — бэкенд вернул данные в неожиданном формате. Откройте DevTools → Network → найдите запрос → проверьте тело ответа
3. **Пустой домен** — в AD действительно нет объектов данного типа

#### Ошибка "Objects are not valid as a React child"

**Причина:** API вернул объект ошибки вместо строки. Функция `getErrorMessage()` в `api.ts` обрабатывает такие случаи.

**Решение:** Убедитесь, что все вызовы `toast.error()` используют `safeToastMessage()` или `getErrorMessage()`.

## Линтер

```bash
# Запуск ESLint
npm run lint
```

## Сборка

```bash
# Проверка сборки без ошибок
npm run build

# Типичная проблема:
# TypeError: Cannot read properties of undefined
# → Проверьте, что все импорты корректны
# → Проверьте, что типы в api-types.ts соответствуют реальным ответам API
```

## Тестирование i18n

1. Переключите язык на EN (кнопка в хедере)
2. Проверьте, что все тексты переведены
3. Проверьте, что нет «key» вместо переведённого текста
4. При отсутствии перевода для ключа отображается ключ — добавьте перевод в `src/locales/en.json`

## Тестирование прав доступа

1. Зайдите как `viewer` — навигация должна показывать замки рядом с большинством разделов
2. Зайдите как `admin` — все разделы доступны
3. Проверьте, что `RequirePermission` корректно блокирует/разблокирует контент
4. Проверьте, что API-запросы с недостаточными правами возвращают 403

## Тестирование AI

1. Откройте ETL Builder (Tasks)
2. Нажмите кнопку AI Assist (плавающая кнопка в правом нижнем углу)
3. Введите текстовый запрос, например: «Создай 5 пользователей и добавь их в группу Developers»
4. Проверьте, что AI добавляет ноды в конвейер
5. Проверьте Safe Mode — чувствительные данные должны быть затёрты

## Тестирование Shell

1. Откройте Shell Terminal
2. Введите команду: `echo "Hello from Samba AD Panel"`
3. Проверьте, что вывод отображается корректно
4. Протестируйте Python3: `import os; print(os.uname())`
5. Проверьте Shell Projects — создайте проект, загрузите файл, выполните команду

## Логирование

### Клиентские логи

Все API-ошибки логируются в консоль браузера. Для расширенного логирования:

```javascript
// Временно включите debug-режим в api.ts
api.interceptors.request.use((config) => {
  console.log(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`, config.data);
  return config;
});
```

### Серверные логи

```bash
# Логи Next.js в продакшн
npm run start  # → server.log

# Логи в режиме разработки
npm run dev    # → dev.log
```
