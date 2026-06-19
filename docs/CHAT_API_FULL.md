# Chat API — Полный справочник (v2.5)

> Базовый URL: `https://<host>:8099`
> Аутентификация: `X-API-Key: WEBADC-XXXXX-XXXXX-XXXXX` или `Authorization: Bearer <jwt>`
> Все endpoints требуют аутентификации. Доступ к комнате — только для её участников.

---

## Содержание

1. [Rooms — Чат-комнаты](#1-rooms)
2. [Members — Участники](#2-members)
3. [Messages — Сообщения](#3-messages)
4. [Files — Файлы](#4-files)
5. [Voice — Голосовые сообщения](#5-voice)
6. [Attachments — Скачивание](#6-attachments)
7. [Search — Поиск](#7-search)
8. [Calls — Звонки](#8-calls)
9. [WebSocket — Real-time](#9-websocket)

---

## 1. Rooms

### GET /api/v1/chat/rooms
**Список моих чатов.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms?include_archived=false" \
  -H "X-API-Key: $KEY"
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `include_archived` | bool | Включая архивные (по умолчанию false) |

**Ответ:**
```json
{
  "status": "ok",
  "count": 2,
  "data": [
    {
      "id": 1, "type": "direct", "name": "", "description": "",
      "owner_id": 1, "avatar_path": "", "is_archived": false,
      "created_at": "2026-06-18T10:00:00+00:00",
      "updated_at": "2026-06-18T11:30:00+00:00",
      "my_role": "admin", "last_read_msg_id": 42
    },
    {
      "id": 2, "type": "group", "name": "Dev Team", "description": "Developers",
      "owner_id": 7, "is_archived": false,
      "my_role": "member", "last_read_msg_id": 15
    }
  ]
}
```

---

### POST /api/v1/chat/rooms
**Создать чат (direct или group).**

```bash
# Direct (1:1)
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"direct","member_ids":[1,7]}'

# Group
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"group","name":"Dev Team","description":"Developers","member_ids":[1,5,7]}'
```

**Тело:**

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | `"direct"` или `"group"` |
| `name` | string | Название (для group) |
| `description` | string | Описание |
| `member_ids` | int[] | ID участников (включая себя) |

---

### GET /api/v1/chat/rooms/{room_id}
**Детали чата.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms/1" \
  -H "X-API-Key: $KEY"
```

---

### PUT /api/v1/chat/rooms/{room_id}
**Обновить чат (название, описание, архив).**

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/chat/rooms/2" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Name","is_archived":false}'
```

**Поля:** `name`, `description`, `is_archived`

---

### DELETE /api/v1/chat/rooms/{room_id}
**Удалить чат (только owner).**

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/chat/rooms/2" \
  -H "X-API-Key: $KEY"
```

---

## 2. Members

### GET /api/v1/chat/rooms/{room_id}/members
**Список участников.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms/1/members" \
  -H "X-API-Key: $KEY"
```

**Ответ:**
```json
{
  "status": "ok",
  "data": [
    {"id":1,"room_id":1,"user_id":1,"username":"admin","role":"admin","last_read_msg_id":42,"joined_at":"..."},
    {"id":2,"room_id":1,"user_id":7,"username":"su","role":"member","last_read_msg_id":40,"joined_at":"..."}
  ]
}
```

---

### POST /api/v1/chat/rooms/{room_id}/members
**Добавить участника.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/2/members" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":5,"role":"member"}'
```

| Поле | Тип | Описание |
|------|-----|----------|
| `user_id` | int | ID пользователя |
| `role` | string | `"admin"` или `"member"` |

---

### DELETE /api/v1/chat/rooms/{room_id}/members/{user_id}
**Удалить участника.**

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/chat/rooms/2/members/5" \
  -H "X-API-Key: $KEY"
```

---

### POST /api/v1/chat/rooms/{room_id}/read
**Отметить сообщения прочитанными.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/read?message_id=42" \
  -H "X-API-Key: $KEY"
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `message_id` | int | ID последнего прочитанного сообщения |

---

## 3. Messages

### GET /api/v1/chat/rooms/{room_id}/messages
**Список сообщений (пагинация по before_id).**

```bash
# Последние 50 сообщений
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms/1/messages?limit=50" \
  -H "X-API-Key: $KEY"

# Следующая страница (старые сообщения)
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms/1/messages?limit=50&before_id=100" \
  -H "X-API-Key: $KEY"
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `before_id` | int? | Сообщения ДО этого ID (пагинация) |
| `limit` | int | 1-200 (по умолчанию 50) |

**Ответ:**
```json
{
  "status": "ok",
  "count": 2,
  "data": [
    {
      "id": 42, "room_id": 1, "sender_id": 7, "sender_username": "su",
      "text": "Привет!", "reply_to_id": null,
      "edited_at": null, "deleted_at": null, "is_pinned": false,
      "created_at": "2026-06-18T11:00:00+00:00",
      "attachments": []
    },
    {
      "id": 43, "room_id": 1, "sender_id": 1, "sender_username": "admin",
      "text": "Вот отчёт", "reply_to_id": 42,
      "created_at": "2026-06-18T11:01:00+00:00",
      "attachments": [
        {"id":5,"filename":"report.pdf","file_size":102400,"mime_type":"application/pdf","is_voice":false,"duration_sec":0}
      ]
    }
  ]
}
```

---

### POST /api/v1/chat/rooms/{room_id}/messages
**Отправить текстовое сообщение.**

```bash
# Обычное сообщение
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/messages" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет всем!"}'

# Ответ на сообщение
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/messages" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Согласен","reply_to_id":42}'
```

| Поле | Тип | Описание |
|------|-----|----------|
| `text` | string | Текст (1-10000 символов) |
| `reply_to_id` | int? | ID сообщения, на которое отвечаем |

**Ответ:** сообщение с `id`, `created_at`, и т.д.

---

### PUT /api/v1/chat/messages/{msg_id}
**Редактировать сообщение (только своё).**

```bash
curl -k -s -X PUT "https://192.168.104.12:8099/api/v1/chat/messages/42" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Отредактированный текст"}'
```

---

### DELETE /api/v1/chat/messages/{msg_id}
**Удалить сообщение (soft, только своё).**

```bash
curl -k -s -X DELETE "https://192.168.104.12:8099/api/v1/chat/messages/42" \
  -H "X-API-Key: $KEY"
```

При soft-delete: `deleted_at` устанавливается, `text` очищается.

---

## 4. Files

### POST /api/v1/chat/rooms/{room_id}/files
**Загрузить файл как сообщение (≤50 MB).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/files" \
  -H "X-API-Key: $KEY" \
  -F 'file=@report.pdf' \
  -F 'text=Вот отчёт'
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `file` | UploadFile | Файл (multipart/form-data) |
| `text` | string | Текст сообщения (опционально) |

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "message": {"id":44,"room_id":1,"sender_id":1,"text":"Вот отчёт","created_at":"..."},
    "attachment": {"id":6,"message_id":44,"filename":"report.pdf","file_size":102400,"mime_type":"application/pdf","is_voice":false,"duration_sec":0}
  }
}
```

---

## 5. Voice

### POST /api/v1/chat/rooms/{room_id}/voice
**Отправить голосовое сообщение.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/voice?duration_sec=15.5" \
  -H "X-API-Key: $KEY" \
  -F 'file=@voice.webm' \
  -F 'text=Сообщение'
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `file` | UploadFile | Аудиофайл (webm, mp3, ogg, wav) |
| `duration_sec` | float | Длительность в секундах |
| `text` | string | Текст (опционально) |

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "message": {"id":45,"room_id":1,"text":"🎤 Voice message","created_at":"..."},
    "attachment": {"id":7,"filename":"voice.webm","is_voice":true,"duration_sec":15.5}
  }
}
```

---

## 6. Attachments

### GET /api/v1/chat/attachments/{att_id}
**Скачать файл.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/attachments/6" \
  -H "X-API-Key: $KEY" -o report.pdf
```

Возвращает бинарный файл с правильными заголовками `Content-Type` и `Content-Disposition`.

---

## 7. Search

### GET /api/v1/chat/search
**Поиск по всем моим чатам.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/search?q=отчёт&limit=50" \
  -H "X-API-Key: $KEY"
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `q` | string | Поисковый запрос (1-200 символов) |
| `limit` | int | 1-200 (по умолчанию 50) |

**Ответ:**
```json
{
  "status": "ok",
  "count": 1,
  "data": [
    {
      "id": 43, "room_id": 1, "sender_id": 1, "sender_username": "admin",
      "text": "Вот отчёт", "created_at": "...", "room_name": ""
    }
  ]
}
```

---

## 8. Calls — Звонки

### POST /api/v1/chat/rooms/{room_id}/calls
**Начать звонок (audio/video).**

```bash
# Голосовой звонок пользователю #7
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/calls" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"callee_id":7,"call_type":"audio"}'

# Видеозвонок
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/1/calls" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"callee_id":7,"call_type":"video"}'

# Групповой звонок (без callee_id)
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/rooms/2/calls" \
  -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"call_type":"video"}'
```

| Поле | Тип | Описание |
|------|-----|----------|
| `callee_id` | int? | ID вызываемого (null = групповой) |
| `call_type` | string | `"audio"` или `"video"` |

**Ответ:**
```json
{
  "status": "ok",
  "data": {
    "id": 1, "room_id": 1, "caller_id": 1, "caller_username": "admin",
    "callee_id": 7, "callee_username": "su",
    "call_type": "audio", "status": "ringing",
    "started_at": null, "ended_at": null, "duration_sec": 0,
    "created_at": "2026-06-18T12:00:00+00:00"
  }
}
```

При создании звонка всем участникам комнаты через WebSocket отправляется:
```json
{"type":"call.incoming","data":{...call...}}
```

---

### POST /api/v1/chat/calls/{call_id}/accept
**Принять звонок.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/calls/1/accept" \
  -H "X-API-Key: $KEY"
```

Статус меняется на `accepted`, `started_at` устанавливается. WebSocket: `call.accepted`

---

### POST /api/v1/chat/calls/{call_id}/reject
**Отклонить звонок.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/calls/1/reject" \
  -H "X-API-Key: $KEY"
```

Статус: `rejected`. WebSocket: `call.rejected`

---

### POST /api/v1/chat/calls/{call_id}/end
**Завершить звонок.**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/calls/1/end" \
  -H "X-API-Key: $KEY"
```

Статус: `ended`, `ended_at` + `duration_sec` вычисляются. WebSocket: `call.ended`

---

### POST /api/v1/chat/calls/{call_id}/cancel
**Отменить звонящий звонок (только caller, только ringing).**

```bash
curl -k -s -X POST "https://192.168.104.12:8099/api/v1/chat/calls/1/cancel" \
  -H "X-API-Key: $KEY"
```

Статус: `cancelled`. WebSocket: `call.cancelled`

---

### GET /api/v1/chat/rooms/{room_id}/calls
**История звонков комнаты.**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/rooms/1/calls?status=ended&limit=50" \
  -H "X-API-Key: $KEY"
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `status` | string? | Фильтр: `ringing`/`accepted`/`rejected`/`ended`/`missed`/`cancelled` |
| `limit` | int | 1-200 (по умолчанию 50) |

---

### GET /api/v1/chat/calls
**Все мои звонки (во всех комнатах).**

```bash
curl -k -s "https://192.168.104.12:8099/api/v1/chat/calls?limit=50" \
  -H "X-API-Key: $KEY"
```

---

### Статусы звонков

| Статус | Описание |
|--------|----------|
| `ringing` | Звонок создаётся, ждёт ответа |
| `accepted` | Принят, идёт разговор |
| `rejected` | Отклонён вызываемым |
| `ended` | Завершён (duration_sec вычислен) |
| `cancelled` | Отменён звонящим до ответа |
| `missed` | Пропущен (не отвечено) |

---

## 9. WebSocket

### WS /ws/chat/{room_id}

Real-time доставка сообщений, typing indicators, звонки и WebRTC сигналинг.

**Подключение:**
```javascript
const ws = new WebSocket('wss://192.168.104.12:8099/ws/chat/1?token=' + jwt);
```

### Client → Server

| type | Описание | Поля |
|------|----------|------|
| `ping` | Keepalive | — |
| `typing` | Индикатор набора | `user_id`, `username`, `is_typing` |
| `webrtc.offer` | SDP offer (caller) | `call_id`, `from_user_id`, `from_username`, `to_user_id`, `sdp` |
| `webrtc.answer` | SDP answer (callee) | `call_id`, `from_user_id`, `to_user_id`, `sdp` |
| `webrtc.ice` | ICE candidate | `call_id`, `from_user_id`, `to_user_id`, `candidate` |
| `webrtc.end` | Peer connection closed | `call_id`, `from_user_id` |

### Server → Client (broadcast)

| type | Описание |
|------|----------|
| `joined` | Вы подключились к комнате (+ members_online) |
| `message` | Новое сообщение |
| `message_edited` | Сообщение отредактировано |
| `message_deleted` | Сообщение удалено |
| `typing` | Кто-то печатает |
| `member_online` | Изменилось кол-во онлайн |
| `call.incoming` | Входящий звонок |
| `call.accepted` | Звонок принят |
| `call.rejected` | Звонок отклонён |
| `call.ended` | Звонок завершён |
| `call.cancelled` | Звонок отменён |
| `webrtc.offer` | SDP offer от другого участника |
| `webrtc.answer` | SDP answer от другого участника |
| `webrtc.ice` | ICE candidate от другого участника |
| `webrtc.end` | WebRTC соединение закрыто |
| `pong` | Ответ на ping |

### Пример: WebRTC видеозвонок

```javascript
// 1. Initiate call via REST
const resp = await fetch('/api/v1/chat/rooms/1/calls', {
  method: 'POST',
  headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ callee_id: 7, call_type: 'video' })
});
const { data: call } = await resp.json();

// 2. Create peer connection
const pc = new RTCPeerConnection({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// 3. Get local media
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
stream.getTracks().forEach(t => pc.addTrack(t, stream));

// 4. Create + send offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
ws.send(JSON.stringify({
  type: 'webrtc.offer', call_id: call.id,
  from_user_id: myId, to_user_id: 7, sdp: offer.sdp
}));

// 5. Handle incoming messages
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'webrtc.answer' && msg.call_id === call.id) {
    pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
  }
  if (msg.type === 'webrtc.ice' && msg.call_id === call.id) {
    pc.addIceCandidate(msg.candidate);
  }
  if (msg.type === 'call.ended' && msg.call_id === call.id) {
    pc.close();
  }
};

// 6. Send ICE candidates
pc.onicecandidate = (e) => {
  if (e.candidate) {
    ws.send(JSON.stringify({
      type: 'webrtc.ice', call_id: call.id,
      from_user_id: myId, candidate: e.candidate
    }));
  }
};

// 7. End call
await fetch(`/api/v1/chat/calls/${call.id}/end`, {
  method: 'POST', headers: { 'X-API-Key': key }
});
pc.close();
```

---

## Сводная таблица — все endpoints

### Rooms (5 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/chat/rooms` | Список моих чатов |
| POST | `/api/v1/chat/rooms` | Создать чат |
| GET | `/api/v1/chat/rooms/{id}` | Детали |
| PUT | `/api/v1/chat/rooms/{id}` | Обновить |
| DELETE | `/api/v1/chat/rooms/{id}` | Удалить (owner) |

### Members (4 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/chat/rooms/{id}/members` | Список участников |
| POST | `/api/v1/chat/rooms/{id}/members` | Добавить |
| DELETE | `/api/v1/chat/rooms/{id}/members/{uid}` | Удалить |
| POST | `/api/v1/chat/rooms/{id}/read` | Отметить прочитанным |

### Messages (4 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/chat/rooms/{id}/messages` | Список (пагинация) |
| POST | `/api/v1/chat/rooms/{id}/messages` | Отправить текст + reply |
| PUT | `/api/v1/chat/messages/{mid}` | Редактировать |
| DELETE | `/api/v1/chat/messages/{mid}` | Удалить (soft) |

### Files & Voice (3 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/chat/rooms/{id}/files` | Загрузить файл (≤50 MB) |
| POST | `/api/v1/chat/rooms/{id}/voice` | Голосовое сообщение |
| GET | `/api/v1/chat/attachments/{aid}` | Скачать файл |

### Search (1 endpoint)
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/api/v1/chat/search?q=...` | Поиск по всем чатам |

### Calls (7 endpoints)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/api/v1/chat/rooms/{id}/calls` | Начать звонок |
| POST | `/api/v1/chat/calls/{cid}/accept` | Принять |
| POST | `/api/v1/chat/calls/{cid}/reject` | Отклонить |
| POST | `/api/v1/chat/calls/{cid}/end` | Завершить (+ duration) |
| POST | `/api/v1/chat/calls/{cid}/cancel` | Отменить (caller) |
| GET | `/api/v1/chat/rooms/{id}/calls` | История звонков комнаты |
| GET | `/api/v1/chat/calls` | Все мои звонки |

### WebSocket (1 endpoint)
| Path | Описание |
|------|----------|
| `WS /ws/chat/{room_id}` | Real-time: сообщения, typing, звонки, WebRTC |

---

## Итого: 24 REST endpoint + 1 WebSocket
