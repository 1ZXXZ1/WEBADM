/**
 * Chat API client — typed wrappers for /api/v1/chat/* endpoints.
 *
 * Real-time updates are handled via WebSocket at /ws/chat/{room_id}?token=...
 * The WS client is in chat-ws.ts.
 */
import api, { getErrorMessage } from './api';

// ── Types ────────────────────────────────────────────────────────────────
export type RoomType = 'direct' | 'group';

export interface ChatRoom {
  id: number;
  type: RoomType;
  name?: string;
  description?: string;
  owner_id: number;
  avatar_url?: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // Backend may include these denormalized fields for list views:
  last_message?: ChatMessage | null;
  unread_count?: number;
  members?: ChatMember[];
}

export interface ChatMember {
  user_id: number;
  username: string;
  full_name?: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  last_read_msg_id?: number | null;
  is_online?: boolean;
}

export interface ChatAttachment {
  id: number;
  message_id: number;
  filename: string;
  size: number;
  mime_type: string;
  storage_path?: string;
  is_voice: boolean;
  duration_sec?: number;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  room_id: number;
  user_id: number;
  username: string;
  text: string;
  reply_to?: number | null;
  reply_to_text?: string | null;
  reply_to_username?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  is_pinned: boolean;
  created_at: string;
  attachments?: ChatAttachment[];
}

/**
 * Normalize a raw message object from the backend into the ChatMessage
 * interface. The backend may use different field names:
 *   user_id | sender_id | sender_user_id
 *   username | sender_name | sender_username | sender
 *   text | content | message
 *   created_at | timestamp | sent_at
 *   attachments | files | attachment
 *
 * Also normalizes attachments (each may have different field names).
 */
function normalizeAttachment(raw: Record<string, unknown>): ChatAttachment {
  return {
    id: Number(raw.id ?? raw.attachment_id ?? raw.att_id ?? 0),
    message_id: Number(raw.message_id ?? raw.msg_id ?? 0),
    filename: String(raw.filename ?? raw.name ?? raw.file_name ?? 'file'),
    size: Number(raw.size ?? raw.file_size ?? raw.bytes ?? 0),
    mime_type: String(raw.mime_type ?? raw.mimetype ?? raw.content_type ?? raw.type ?? 'application/octet-stream'),
    storage_path: (raw.storage_path ?? raw.path ?? undefined) as string | undefined,
    is_voice: Boolean(raw.is_voice ?? raw.voice ?? false),
    duration_sec: (raw.duration_sec ?? raw.duration ?? undefined) as number | undefined,
    created_at: String(raw.created_at ?? raw.timestamp ?? new Date().toISOString()),
  };
}

function normalizeMessage(raw: Record<string, unknown>): ChatMessage {
  // Normalize text — never convert an object/array to "[object Object]"
  let text = '';
  if (typeof raw.text === 'string') text = raw.text;
  else if (typeof raw.content === 'string') text = raw.content;
  else if (typeof raw.body === 'string') text = raw.body;
  // Don't fall back to raw.message if it's an object (would become [object Object])

  // Normalize username — never convert an object to "[object Object]"
  let username = '';
  if (typeof raw.username === 'string') username = raw.username;
  else if (typeof raw.sender_name === 'string') username = raw.sender_name;
  else if (typeof raw.sender_username === 'string') username = raw.sender_username;
  else if (typeof raw.sender === 'string') username = raw.sender;
  else if (raw.user && typeof raw.user === 'object') {
    const u = raw.user as Record<string, unknown>;
    if (typeof u.username === 'string') username = u.username;
  }
  // Don't fall back to raw.user if it's an object

  // Normalize attachments
  let attachments: ChatAttachment[] | undefined;
  const rawAtts = raw.attachments ?? raw.files ?? raw.attachment;
  if (Array.isArray(rawAtts)) {
    attachments = rawAtts.map((a) =>
      normalizeAttachment(a as Record<string, unknown>)
    );
  } else if (rawAtts && typeof rawAtts === 'object') {
    attachments = [normalizeAttachment(rawAtts as Record<string, unknown>)];
  }

  return {
    id: Number(raw.id ?? raw.message_id ?? 0),
    room_id: Number(raw.room_id ?? raw.chat_id ?? 0),
    user_id: Number(raw.user_id ?? raw.sender_id ?? raw.sender_user_id ?? raw.owner_id ?? 0),
    username,
    text,
    reply_to: (raw.reply_to ?? raw.reply_to_id ?? null) as number | null,
    reply_to_text: (raw.reply_to_text ?? raw.reply_message_text ?? null) as string | null,
    reply_to_username: (raw.reply_to_username ?? raw.reply_to_sender ?? raw.reply_to_sender_username ?? null) as string | null,
    edited_at: (raw.edited_at ?? null) as string | null,
    deleted_at: (raw.deleted_at ?? null) as string | null,
    is_pinned: Boolean(raw.is_pinned ?? raw.pinned ?? false),
    created_at: String(raw.created_at ?? raw.timestamp ?? raw.sent_at ?? new Date().toISOString()),
    attachments,
  };
}

export interface RoomCreateBody {
  type: RoomType;
  name?: string;
  description?: string;
  member_ids: number[];
}

export interface RoomUpdateBody {
  name?: string;
  description?: string;
  is_archived?: boolean;
}

export interface MessageSendBody {
  text: string;
  reply_to_id?: number;
}

export interface MessageEditBody {
  text: string;
}

export interface SearchHit {
  message: ChatMessage;
  room: ChatRoom;
  snippet: string;
}

// ── Rooms ────────────────────────────────────────────────────────────────
export const chatRoomsApi = {
  list: async (include_archived = false): Promise<ChatRoom[]> => {
    const res = await api.get('/chat/rooms', { params: { include_archived } });
    const data = res.data;
    if (Array.isArray(data?.data)) return data.data as ChatRoom[];
    if (Array.isArray(data?.rooms)) return data.rooms as ChatRoom[];
    if (Array.isArray(data?.data?.rooms)) return data.data.rooms as ChatRoom[];
    if (Array.isArray(data?.items)) return data.items as ChatRoom[];
    if (Array.isArray(data)) return data as ChatRoom[];
    return [];
  },
  get: async (id: number): Promise<ChatRoom> => {
    const res = await api.get(`/chat/rooms/${id}`);
    return (res.data?.data ?? res.data) as ChatRoom;
  },
  create: async (body: RoomCreateBody): Promise<ChatRoom> => {
    const res = await api.post('/chat/rooms', body);
    return (res.data?.data ?? res.data) as ChatRoom;
  },
  update: async (id: number, body: RoomUpdateBody): Promise<ChatRoom> => {
    const res = await api.put(`/chat/rooms/${id}`, body);
    return (res.data?.data ?? res.data) as ChatRoom;
  },
  delete: async (id: number): Promise<void> => {
    await api.delete(`/chat/rooms/${id}`);
  },
};

// ── Members ──────────────────────────────────────────────────────────────
function normalizeMember(raw: Record<string, unknown>): ChatMember {
  return {
    // NEVER fall back to raw.id — that's the member record ID, not user_id
    user_id: Number(raw.user_id ?? raw.sender_id ?? 0),
    username: String(raw.username ?? raw.sender_username ?? raw.name ?? ''),
    full_name: (raw.full_name ?? raw.display_name ?? raw.sender_name ?? undefined) as string | undefined,
    role: (raw.role ?? raw.member_role ?? 'member') as 'owner' | 'admin' | 'member',
    joined_at: String(raw.joined_at ?? raw.created_at ?? new Date().toISOString()),
    last_read_msg_id: (raw.last_read_msg_id ?? raw.last_read ?? null) as number | null,
    is_online: Boolean(raw.is_online ?? raw.online ?? false),
  };
}

export const chatMembersApi = {
  list: async (roomId: number): Promise<ChatMember[]> => {
    const res = await api.get(`/chat/rooms/${roomId}/members`);
    const data = res.data;
    let raw: unknown[] = [];
    if (Array.isArray(data?.data)) raw = data.data;
    else if (Array.isArray(data?.members)) raw = data.members;
    else if (Array.isArray(data?.data?.members)) raw = data.data.members;
    else if (Array.isArray(data?.items)) raw = data.items;
    else if (Array.isArray(data)) raw = data;
    return raw.map((m) => normalizeMember(m as Record<string, unknown>));
  },
  add: async (roomId: number, userId: number): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/members`, { user_id: userId });
  },
  remove: async (roomId: number, userId: number): Promise<void> => {
    await api.delete(`/chat/rooms/${roomId}/members/${userId}`);
  },
  markRead: async (roomId: number, messageId: number): Promise<void> => {
    await api.post(`/chat/rooms/${roomId}/read`, null, {
      params: { message_id: messageId },
    });
  },
};

// ── Messages ─────────────────────────────────────────────────────────────
export interface MessageListParams {
  before_id?: number;
  limit?: number;
}

export const chatMessagesApi = {
  list: async (roomId: number, params: MessageListParams = {}): Promise<ChatMessage[]> => {
    const res = await api.get(`/chat/rooms/${roomId}/messages`, {
      params: { limit: 50, ...params },
    });
    const data = res.data;
    // Try every possible response shape the backend might return:
    let rawMessages: unknown[] = [];
    if (Array.isArray(data?.data)) rawMessages = data.data;
    else if (Array.isArray(data?.messages)) rawMessages = data.messages;
    else if (Array.isArray(data?.data?.messages)) rawMessages = data.data.messages;
    else if (Array.isArray(data?.items)) rawMessages = data.items;
    else if (Array.isArray(data)) rawMessages = data;
    // Normalize each message — backend may use different field names
    return rawMessages.map((m) => normalizeMessage(m as Record<string, unknown>));
  },
  send: async (roomId: number, body: MessageSendBody): Promise<ChatMessage> => {
    const res = await api.post(`/chat/rooms/${roomId}/messages`, body);
    return normalizeMessage((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  edit: async (msgId: number, body: MessageEditBody): Promise<ChatMessage> => {
    const res = await api.put(`/chat/messages/${msgId}`, body);
    return normalizeMessage((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  delete: async (msgId: number): Promise<void> => {
    await api.delete(`/chat/messages/${msgId}`);
  },
};

// ── Helper: extract message + attachment from upload response ────────────
// Upload responses have the shape:
//   { status: "ok", data: { message: {...}, attachment: {...} } }
// We need to merge the attachment into the message's attachments array.
function extractMessageWithAttachment(data: unknown): ChatMessage {
  const d = data as Record<string, unknown>;
  // Try data.data.message + data.data.attachment
  const inner = d?.data as Record<string, unknown> | undefined;
  if (inner?.message && typeof inner.message === 'object') {
    const msg = normalizeMessage(inner.message as Record<string, unknown>);
    const att = inner.attachment;
    if (att && typeof att === 'object') {
      msg.attachments = [normalizeAttachment(att as Record<string, unknown>)];
    }
    return msg;
  }
  // Try data.message + data.attachment
  if (d?.message && typeof d.message === 'object') {
    const msg = normalizeMessage(d.message as Record<string, unknown>);
    const att = d.attachment;
    if (att && typeof att === 'object') {
      msg.attachments = [normalizeAttachment(att as Record<string, unknown>)];
    }
    return msg;
  }
  // Fallback: treat the whole thing as a message
  return normalizeMessage((d?.data ?? d) as Record<string, unknown>);
}

// ── Files & Voice ────────────────────────────────────────────────────────
export const chatFilesApi = {
  upload: async (
    roomId: number,
    file: File,
    text = '',
  ): Promise<ChatMessage> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post(`/chat/rooms/${roomId}/files`, form, {
      params: { text },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return extractMessageWithAttachment(res.data);
  },
  uploadVoice: async (
    roomId: number,
    file: File,
    durationSec = 0,
    text = '',
  ): Promise<ChatMessage> => {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post(`/chat/rooms/${roomId}/voice`, form, {
      params: { duration_sec: durationSec, text },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return extractMessageWithAttachment(res.data);
  },
  downloadUrl: (attId: number): string => {
    // Returns a URL that the browser can fetch with auth headers attached
    // by the axios interceptor (use api.get with responseType: 'blob' for
    // actual download).
    return `/api/v1/chat/attachments/${attId}`;
  },
  download: async (attId: number): Promise<{ blob: Blob; filename: string; mime: string }> => {
    const res = await api.get(`/chat/attachments/${attId}`, {
      responseType: 'blob',
    });
    // Try to extract filename from Content-Disposition
    const cd = res.headers?.['content-disposition'] || '';
    const m = /filename="?([^";]+)"?/i.exec(cd);
    const filename = m ? m[1] : `attachment-${attId}`;
    const mime = res.headers?.['content-type'] || 'application/octet-stream';
    return { blob: res.data as Blob, filename, mime };
  },
};

// ── Search ───────────────────────────────────────────────────────────────
export const chatSearchApi = {
  search: async (q: string, limit = 50): Promise<SearchHit[]> => {
    const res = await api.get('/chat/search', { params: { q, limit } });
    const data = res.data;
    if (Array.isArray(data?.data)) return data.data as SearchHit[];
    if (Array.isArray(data?.results)) return data.results as SearchHit[];
    if (Array.isArray(data)) return data as SearchHit[];
    return [];
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────
export { getErrorMessage };
