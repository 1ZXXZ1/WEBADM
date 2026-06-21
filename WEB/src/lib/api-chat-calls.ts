/**
 * Chat Calls API client — typed wrappers for /api/v1/chat/calls/* endpoints.
 *
 * Voice/Video calls use WebRTC P2P for media + server-side WebSocket signaling.
 * The actual SDP offer/answer + ICE candidates are exchanged via the chat
 * WebSocket (see chat-ws.ts), NOT via these REST endpoints.
 *
 * REST endpoints only handle call LIFECYCLE: initiate, accept, reject, end, cancel.
 */
import api, { getErrorMessage } from './api';

// ── Types ────────────────────────────────────────────────────────────────
export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'ended' | 'cancelled' | 'missed';

export interface ChatCall {
  id: number;
  room_id: number;
  caller_id: number;
  callee_id: number;
  call_type: CallType;
  status: CallStatus;
  started_at?: string | null;
  ended_at?: string | null;
  duration_sec?: number | null;
  created_at: string;
  // Denormalized for display:
  caller_username?: string;
  callee_username?: string;
}

export interface CallInitiateBody {
  callee_id: number;
  call_type: CallType;
}

// ── Normalize a raw call object (exported for WS handler use) ────────────
export function normalizeCall(raw: Record<string, unknown>): ChatCall {
  // Determine call_type — check multiple possible field names
  let callType: CallType = 'audio';
  if (typeof raw.call_type === 'string') {
    callType = (raw.call_type === 'video' ? 'video' : 'audio');
  } else if (typeof raw.media_type === 'string') {
    callType = (raw.media_type === 'video' ? 'video' : 'audio');
  } else if (raw.video === true) {
    callType = 'video';
  }

  // Determine status
  let status: CallStatus = 'ringing';
  if (typeof raw.status === 'string') {
    status = raw.status as CallStatus;
  } else if (typeof raw.state === 'string') {
    status = raw.state as CallStatus;
  }

  return {
    id: Number(raw.id ?? raw.call_id ?? 0),
    room_id: Number(raw.room_id ?? raw.chat_id ?? 0),
    caller_id: Number(raw.caller_id ?? raw.from_user_id ?? raw.initiator_id ?? raw.sender_id ?? 0),
    callee_id: Number(raw.callee_id ?? raw.to_user_id ?? raw.recipient_id ?? 0),
    call_type: callType,
    status: status,
    started_at: (raw.started_at ?? raw.accepted_at ?? null) as string | null,
    ended_at: (raw.ended_at ?? raw.end_time ?? null) as string | null,
    duration_sec: (raw.duration_sec ?? raw.duration ?? null) as number | null,
    created_at: String(raw.created_at ?? raw.timestamp ?? new Date().toISOString()),
    caller_username: (raw.caller_username ?? raw.caller_name ?? raw.from_username ?? undefined) as string | undefined,
    callee_username: (raw.callee_username ?? raw.callee_name ?? raw.to_username ?? undefined) as string | undefined,
  };
}

// ── Calls API ────────────────────────────────────────────────────────────
export const chatCallsApi = {
  initiate: async (roomId: number, body: CallInitiateBody): Promise<ChatCall> => {
    const res = await api.post(`/chat/rooms/${roomId}/calls`, body);
    return normalizeCall((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  accept: async (callId: number): Promise<ChatCall> => {
    const res = await api.post(`/chat/calls/${callId}/accept`, {});
    return normalizeCall((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  reject: async (callId: number): Promise<ChatCall> => {
    const res = await api.post(`/chat/calls/${callId}/reject`, {});
    return normalizeCall((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  end: async (callId: number): Promise<ChatCall> => {
    const res = await api.post(`/chat/calls/${callId}/end`, {});
    return normalizeCall((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  cancel: async (callId: number): Promise<ChatCall> => {
    const res = await api.post(`/chat/calls/${callId}/cancel`, {});
    return normalizeCall((res.data?.data ?? res.data) as Record<string, unknown>);
  },
  listByRoom: async (roomId: number, status?: CallStatus, limit = 50): Promise<ChatCall[]> => {
    const res = await api.get(`/chat/rooms/${roomId}/calls`, {
      params: { status, limit },
    });
    const data = res.data;
    let raw: unknown[] = [];
    if (Array.isArray(data?.data)) raw = data.data;
    else if (Array.isArray(data?.calls)) raw = data.calls;
    else if (Array.isArray(data?.items)) raw = data.items;
    else if (Array.isArray(data)) raw = data;
    return raw.map((c) => normalizeCall(c as Record<string, unknown>));
  },
  listMine: async (status?: CallStatus, limit = 50): Promise<ChatCall[]> => {
    const res = await api.get('/chat/calls', { params: { status, limit } });
    const data = res.data;
    let raw: unknown[] = [];
    if (Array.isArray(data?.data)) raw = data.data;
    else if (Array.isArray(data?.calls)) raw = data.calls;
    else if (Array.isArray(data?.items)) raw = data.items;
    else if (Array.isArray(data)) raw = data;
    return raw.map((c) => normalizeCall(c as Record<string, unknown>));
  },
};

// ── WebRTC signaling helpers (sent via chat WebSocket) ────────────────────
export interface WebRTCSignal {
  type: 'webrtc.offer' | 'webrtc.answer' | 'webrtc.ice' | 'webrtc.end';
  call_id: number;
  from_user_id?: number;
  to_user_id?: number;
  sdp?: string;
  candidate?: unknown;
}

export { getErrorMessage };
