/**
 * Chat WebSocket client — real-time message delivery + typing indicators.
 *
 * Backend endpoint: wss://<host>/ws/chat/{room_id}?token=<jwt>
 * For API-key auth, pass ?api_key=<key> instead.
 *
 * Events received from server (JSON):
 *   { type: 'message',       data: ChatMessage }
 *   { type: 'typing',        data: { user_id, username, is_typing } }
 *   { type: 'member_joined', data: { user_id, username } }
 *   { type: 'member_left',   data: { user_id, username } }
 *   { type: 'message_edited',data: ChatMessage }
 *   { type: 'message_deleted', data: { message_id } }
 *   { type: 'presence',      data: { user_id, is_online } }
 *
 * Events sent to server:
 *   { type: 'typing', room_id, is_typing: boolean }
 */
import type { ChatMessage } from './api-chat';

export type ChatEventType =
  | 'message'
  | 'typing'
  | 'member_joined'
  | 'member_left'
  | 'message_edited'
  | 'message_deleted'
  | 'presence'
  | 'connected'
  | 'disconnected'
  | 'error'
  // WebRTC call signaling events:
  | 'call.incoming'
  | 'call.accepted'
  | 'call.rejected'
  | 'call.ended'
  | 'call.cancelled'
  | 'webrtc.offer'
  | 'webrtc.answer'
  | 'webrtc.ice'
  | 'webrtc.end';

export interface ChatEvent {
  type: ChatEventType;
  data?: unknown;
}

type Listener = (event: ChatEvent) => void;

export class ChatWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private roomId: number;
  private token: string | null;
  private apiKey: string | null;
  private baseURL: string;

  constructor(opts: {
    roomId: number;
    token?: string | null;
    apiKey?: string | null;
    baseURL?: string;
  }) {
    this.roomId = opts.roomId;
    this.token = opts.token ?? null;
    this.apiKey = opts.apiKey ?? null;
    // Default: derive from current origin + /ws (Caddy/nginx maps /ws/* to backend WS)
    this.baseURL = opts.baseURL ?? '';
  }

  /** Build the WebSocket URL — always uses the API server's host:port. */
  private buildUrl(): string {
    let origin: string;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('samba-api-url') || '/api/v1';
      if (stored.startsWith('http://') || stored.startsWith('https://')) {
        // Custom API URL (e.g. "https://192.168.104.12:8099/api/v1")
        // → extract origin for WS
        try {
          const u = new URL(stored);
          origin = u.origin;
        } catch {
          origin = window.location.origin;
        }
      } else {
        // Relative URL ("/api/v1") → SPA and API are same origin
        origin = window.location.origin;
      }
    } else {
      origin = 'http://localhost';
    }
    // Convert http(s) → ws(s) — preserves host and port
    const wsOrigin = origin.replace(/^http/, 'ws');
    // Auth: prefer JWT token, fall back to API key
    const auth = this.token
      ? `token=${encodeURIComponent(this.token)}`
      : this.apiKey
        ? `api_key=${encodeURIComponent(this.apiKey)}`
        : '';
    // The WS endpoint path on the backend
    return `${wsOrigin}/ws/chat/${this.roomId}${auth ? '?' + auth : ''}`;
  }

  connect(): void {
    if (typeof window === 'undefined') return;
    // Guard: don't connect if already connected or connecting
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      const url = this.buildUrl();
      console.log('[ChatWS] Connecting to:', url);
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error('[ChatWS] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[ChatWS] Connected');
      this.reconnectAttempts = 0;
      this.emit({ type: 'connected' });
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return;

        // The server may send events in different shapes:
        //   { type: "message", data: { id, text, ... } }
        //   { type: "call.incoming", call: { id, call_type, ... } }
        //   { type: "webrtc.offer", sdp: "...", call_id: 1, from_user_id: 5 }
        //   { type: "typing", room_id: 1, is_typing: true, username: "su" }
        //
        // Normalize: if 'data' field exists, use it as event.data.
        // Otherwise, strip 'type' and use the rest as event.data.
        const { type, ...rest } = parsed;
        const eventData = parsed.data ?? (Object.keys(rest).length > 0 ? rest : undefined);
        this.emit({ type, data: eventData });
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = (e: Event) => {
      console.error('[ChatWS] Error:', e);
      this.emit({ type: 'error' });
    };

    this.ws.onclose = (e: CloseEvent) => {
      console.log('[ChatWS] Closed:', e.code, e.reason);
      this.emit({ type: 'disconnected' });
      // Only reconnect if close was not clean (code 1000 = normal close)
      if (this.shouldReconnect && e.code !== 1000) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Exponential backoff capped at 30s
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Send a typing indicator. */
  sendTyping(isTyping: boolean): void {
    this.send({ type: 'typing', room_id: this.roomId, is_typing: isTyping });
  }

  /** Send a WebRTC signaling message (for voice/video calls). */
  sendWebRTC(payload: {
    type: 'webrtc.offer' | 'webrtc.answer' | 'webrtc.ice' | 'webrtc.end';
    call_id: number;
    to_user_id?: number;
    sdp?: string;
    candidate?: unknown;
  }): void {
    this.send({ ...payload, room_id: this.roomId });
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ChatEvent): void {
    this.listeners.forEach((l) => {
      try { l(event); } catch { /* ignore listener errors */ }
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.listeners.clear();
  }
}

/**
 * React hook: subscribe to a chat room's WebSocket events.
 *
 * Returns a ref to the ChatWebSocket instance. Call `.connect()` on mount
 * and `.disconnect()` on unmount.
 */
export function createChatWebSocket(
  roomId: number,
): ChatWebSocket {
  if (typeof window === 'undefined') {
    // SSR stub — never actually used
    return {
      connect() {}, disconnect() {}, send() {}, sendTyping() {},
      on() { return () => {}; },
    } as unknown as ChatWebSocket;
  }
  const token = localStorage.getItem('samba-access-token');
  const apiKey = localStorage.getItem('samba-api-key');
  return new ChatWebSocket({ roomId, token, apiKey });
}

export type { ChatMessage };
