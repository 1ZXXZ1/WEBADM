'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send, Plus, Search, Loader2, Paperclip, Download, Trash2, Pencil,
  Reply, X, Users, MessageCircle, Archive, ArchiveRestore,
  MoreVertical, Mic, FileText, Image as ImageIcon,
  Wifi, WifiOff, UserPlus, Square, ChevronLeft, Maximize, Minimize,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import {
  chatRoomsApi, chatMembersApi, chatMessagesApi, chatFilesApi, chatSearchApi,
  getErrorMessage,
  type ChatRoom, type ChatMember, type ChatMessage, type RoomType, type SearchHit,
} from '@/lib/api-chat';
import { mgmtUsersApi, type MgmtUser } from '@/lib/api-mgmt';
import { ChatWebSocket, createChatWebSocket } from '@/lib/chat-ws';
import { useAuthStore } from '@/stores/auth-store';
import { useOrientation } from '@/hooks/use-orientation';
import CallUI from './CallUI';

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Normalize a raw WS message — backend may use different field names
function normalizeWsMessage(raw: Record<string, unknown>): ChatMessage {
  // Normalize text — never convert an object to "[object Object]"
  let text = '';
  if (typeof raw.text === 'string') text = raw.text;
  else if (typeof raw.content === 'string') text = raw.content;

  // Normalize username
  let username = '';
  if (typeof raw.username === 'string') username = raw.username;
  else if (typeof raw.sender_username === 'string') username = raw.sender_username;
  else if (typeof raw.sender_name === 'string') username = raw.sender_name;

  // Normalize attachments
  let attachments: ChatMessage['attachments'];
  const rawAtts = raw.attachments ?? raw.files ?? raw.attachment;
  if (Array.isArray(rawAtts)) {
    attachments = rawAtts.map((a) => {
      const att = a as Record<string, unknown>;
      return {
        id: Number(att.id ?? 0),
        message_id: Number(att.message_id ?? raw.id ?? 0),
        filename: String(att.filename ?? att.name ?? 'file'),
        size: Number(att.file_size ?? att.size ?? 0),
        mime_type: String(att.mime_type ?? 'application/octet-stream'),
        is_voice: Boolean(att.is_voice ?? false),
        duration_sec: att.duration_sec as number | undefined,
        created_at: String(raw.created_at ?? new Date().toISOString()),
      };
    });
  }

  return {
    id: Number(raw.id ?? raw.message_id ?? 0),
    room_id: Number(raw.room_id ?? raw.chat_id ?? 0),
    user_id: Number(raw.user_id ?? raw.sender_id ?? raw.sender_user_id ?? 0),
    username,
    text,
    reply_to: (raw.reply_to ?? raw.reply_to_id ?? null) as number | null,
    reply_to_text: (raw.reply_to_text ?? null) as string | null,
    reply_to_username: (raw.reply_to_username ?? raw.reply_to_sender_username ?? null) as string | null,
    edited_at: (raw.edited_at ?? null) as string | null,
    deleted_at: (raw.deleted_at ?? null) as string | null,
    is_pinned: Boolean(raw.is_pinned ?? false),
    created_at: String(raw.created_at ?? raw.timestamp ?? new Date().toISOString()),
    attachments,
  };
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fileIcon(mime: string): React.ReactNode {
  if (mime.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
  if (mime.startsWith('audio/')) return <Mic className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Main page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const currentUserId = user?.id ?? 0;

  // Orientation: in landscape mode (natural or force-rotated) on mobile,
  // we show both rooms and chat side-by-side like on desktop. This is the
  // "landscape version" the user asked for.
  const { isMobile, effectiveLandscape } = useOrientation();
  // When in landscape on mobile, treat as "desktop" for layout purposes
  const showSideBySide = !isMobile || effectiveLandscape;

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  // Mobile portrait: track which view to show (rooms list OR chat).
  // In landscape (or desktop), both are visible side-by-side.
  const [mobileView, setMobileView] = useState<'rooms' | 'chat'>('rooms');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const wsRef = useRef<ChatWebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingUsersCleanupRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Load rooms ──────────────────────────────────────────────────────
  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const data = await chatRoomsApi.list(true);
      setRooms(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_load_rooms')));
    } finally {
      setRoomsLoading(false);
    }
  }, [t]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // ── Load messages ───────────────────────────────────────────────────
  const loadMessages = useCallback(async (roomId: number, beforeId?: number) => {
    setMessagesLoading(true);
    try {
      const data = await chatMessagesApi.list(roomId, beforeId ? { before_id: beforeId, limit: 50 } : { limit: 50 });
      // Backend returns messages newest-first; reverse so oldest is at top
      const sorted = [...data].reverse();
      if (beforeId) {
        // Prepend older messages (they're already reversed to oldest-first)
        setMessages(prev => [...sorted, ...prev]);
        if (data.length < 50) setHasMore(false);
      } else {
        setMessages(sorted);
        setHasMore(data.length >= 50);
      }
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_load_messages')));
    } finally {
      setMessagesLoading(false);
    }
  }, [t]);

  const loadMembers = useCallback(async (roomId: number) => {
    setMembersLoading(true);
    try {
      const data = await chatMembersApi.list(roomId);
      setMembers(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_load_members')));
    } finally {
      setMembersLoading(false);
    }
  }, [t]);

  // ── Select room → load messages + members + connect WS ──────────────
  // Use a ref to track if this effect already ran for this room,
  // to avoid double-connect in React StrictMode (dev) or fast re-renders.
  const wsRoomRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedRoomId == null) {
      setMessages([]);
      setMembers([]);
      wsRoomRef.current = null;
      return;
    }

    // If already connected to this room, don't reconnect
    if (wsRoomRef.current === selectedRoomId && wsRef.current) {
      return;
    }
    // Disconnect previous WS if switching rooms
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    wsRoomRef.current = selectedRoomId;

    loadMessages(selectedRoomId);
    loadMembers(selectedRoomId);

    const ws = createChatWebSocket(selectedRoomId);
    wsRef.current = ws;

    const off = ws.on((event) => {
      switch (event.type) {
        case 'connected':
          setWsConnected(true);
          break;
        case 'disconnected':
        case 'error':
          setWsConnected(false);
          break;
        case 'message': {
          const msg = normalizeWsMessage(event.data as Record<string, unknown>);
          if (msg && msg.room_id === selectedRoomId) {
            setMessages(prev => {
              const existing = prev.find(m => m.id === msg.id);
              if (existing) {
                const attachments = msg.attachments?.length ? msg.attachments : existing.attachments;
                return prev.map(m => m.id === msg.id ? { ...existing, ...msg, attachments } : m);
              }
              return [...prev, msg];
            });
            if (msg.user_id !== currentUserId) {
              chatMembersApi.markRead(selectedRoomId, msg.id).catch(() => {});
            }
          }
          if (msg) {
            setRooms(prev => prev.map(r =>
              r.id === msg.room_id
                ? { ...r, last_message: msg, updated_at: msg.created_at }
                : r
            ));
          }
          break;
        }
        case 'message_edited': {
          const msg = normalizeWsMessage(event.data as Record<string, unknown>);
          if (msg) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m));
          }
          break;
        }
        case 'message_deleted': {
          const data = event.data as { message_id: number };
          if (data?.message_id) {
            setMessages(prev => prev.map(m =>
              m.id === data.message_id ? { ...m, deleted_at: new Date().toISOString(), text: '' } : m
            ));
          }
          break;
        }
        case 'typing': {
          const data = event.data as { username: string; is_typing: boolean };
          if (data?.username && data.username !== user?.username) {
            setTypingUsers(prev => {
              const next = new Set(prev);
              if (data.is_typing) next.add(data.username);
              else next.delete(data.username);
              return next;
            });
            const cleanupMap = typingUsersCleanupRef.current;
            const existing = cleanupMap.get(data.username);
            if (existing) clearTimeout(existing);
            if (data.is_typing) {
              cleanupMap.set(data.username, setTimeout(() => {
                setTypingUsers(prev => {
                  const next = new Set(prev);
                  next.delete(data.username);
                  return next;
                });
                cleanupMap.delete(data.username);
              }, 3000));
            }
          }
          break;
        }
      }
    });

    ws.connect();

    return () => {
      off();
      ws.disconnect();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      wsRoomRef.current = null;
      setWsConnected(false);
      setTypingUsers(new Set());
    };
  }, [selectedRoomId, currentUserId, user?.username, loadMessages, loadMembers]);

  // ── Auto-scroll to bottom on new messages ───────────────────────────
  useEffect(() => {
    if (messagesEndRef.current && !messagesLoading) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, messagesLoading]);

  // ── Search ──────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await chatSearchApi.search(q);
      setSearchResults(results);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_search')));
    } finally {
      setSearching(false);
    }
  }, [t]);

  // ── Derived ─────────────────────────────────────────────────────────
  const selectedRoom = useMemo(
    () => rooms.find(r => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  // Map user_id → ChatMember for resolving usernames/avatars in messages.
  // The backend may not always include `username` in message responses,
  // so we look it up from the members list.
  const memberMap = useMemo(() => {
    const m = new Map<number, ChatMember>();
    members.forEach(mem => m.set(mem.user_id, mem));
    return m;
  }, [members]);

  // Helper: resolve display name for a message sender
  const getMsgDisplayName = useCallback((msg: ChatMessage): string => {
    if (currentUserId > 0 && msg.user_id === currentUserId) {
      return user?.username || t('chat.you');
    }
    const mem = memberMap.get(msg.user_id);
    if (mem) return mem.full_name || mem.username;
    if (msg.username && msg.username.trim()) return msg.username;
    return msg.user_id ? `User #${msg.user_id}` : t('chat.unknown_user', { defaultValue: 'Неизвестный' });
  }, [memberMap, currentUserId, user?.username, t]);

  const getRoomTitle = useCallback((room: ChatRoom): string => {
    if (room.name && room.name.trim()) return room.name;
    if (room.type === 'direct') {
      // Filter out current user by user_id (preferred) or username (fallback)
      const allMembers = room.members ?? members;
      const otherMembers = allMembers.filter(m =>
        currentUserId > 0
          ? m.user_id !== currentUserId
          : m.username !== user?.username
      );
      if (otherMembers.length === 1) {
        return otherMembers[0].full_name || otherMembers[0].username || t('chat.direct_chat');
      }
      if (otherMembers.length === 0) return t('chat.direct_chat');
      return otherMembers.map(m => m.full_name || m.username).join(', ');
    }
    return t('chat.group_chat');
  }, [members, currentUserId, user?.username, t]);

  // ── Send / edit / delete ────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string, replyToId?: number) => {
    if (!selectedRoomId || !text.trim()) return;
    try {
      const msg = await chatMessagesApi.send(selectedRoomId, { text: text.trim(), reply_to_id: replyToId });
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      // Update room list — move room to top with new last_message
      setRooms(prev => {
        const updated = prev.map(r =>
          r.id === selectedRoomId
            ? { ...r, last_message: msg, updated_at: msg.created_at }
            : r
        );
        // Sort by updated_at descending (most recent first)
        return updated.sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_send')));
    }
  }, [selectedRoomId, t]);

  const editMessage = useCallback(async (msgId: number, text: string) => {
    try {
      const updated = await chatMessagesApi.edit(msgId, { text });
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updated } : m));
      toast.success(t('chat.message_edited_ok'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_send')));
    }
  }, [t]);

  const deleteMessage = useCallback(async (msgId: number) => {
    if (!confirm(t('chat.confirm_delete_message'))) return;
    try {
      await chatMessagesApi.delete(msgId);
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, deleted_at: new Date().toISOString(), text: '' } : m
      ));
      toast.success(t('chat.message_deleted_ok'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_send')));
    }
  }, [t]);

  // ── File upload / download ──────────────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    if (!selectedRoomId) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('chat.file_too_large'));
      return;
    }
    try {
      const msg = await chatFilesApi.upload(selectedRoomId, file);
      // Add only if not already present (WS might broadcast it first)
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      toast.success(t('chat.file_uploaded'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_upload_file')));
    }
  }, [selectedRoomId, t]);

  // ── Voice message upload ────────────────────────────────────────────
  const uploadVoice = useCallback(async (file: File, durationSec: number) => {
    if (!selectedRoomId) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error(t('chat.file_too_large'));
      return;
    }
    try {
      const msg = await chatFilesApi.uploadVoice(selectedRoomId, file, durationSec);
      // Add only if not already present (WS might broadcast it first)
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      toast.success(t('chat.voice_uploaded'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_upload_voice')));
    }
  }, [selectedRoomId, t]);

  const downloadAttachment = useCallback(async (attId: number) => {
    try {
      const { blob, filename } = await chatFilesApi.download(attId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_upload_file')));
    }
  }, [t]);

  // ── Room management ─────────────────────────────────────────────────
  const createRoom = useCallback(async (type: RoomType, name: string, memberIds: number[]) => {
    try {
      const room = await chatRoomsApi.create({
        type,
        name: type === 'group' ? name : undefined,
        member_ids: memberIds,
      });
      setRooms(prev => [room, ...prev]);
      setSelectedRoomId(room.id);
      setShowCreateDialog(false);
      toast.success(t('chat.room_created'));
      loadRooms();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_create_room')));
    }
  }, [t, loadRooms]);

  const deleteRoom = useCallback(async (roomId: number) => {
    const room = rooms.find(r => r.id === roomId);
    if (!confirm(t('chat.confirm_delete_room', { name: getRoomTitle(room!) }))) return;
    try {
      await chatRoomsApi.delete(roomId);
      setRooms(prev => prev.filter(r => r.id !== roomId));
      if (selectedRoomId === roomId) setSelectedRoomId(null);
      toast.success(t('chat.room_deleted'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_create_room')));
    }
  }, [rooms, selectedRoomId, getRoomTitle, t]);

  const toggleArchive = useCallback(async (room: ChatRoom) => {
    try {
      await chatRoomsApi.update(room.id, { is_archived: !room.is_archived });
      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, is_archived: !room.is_archived } : r));
      toast.success(t('chat.room_updated'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_create_room')));
    }
  }, [t]);

  // ── Drag & drop ─────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  }, [uploadFile]);

  // ── Render ──────────────────────────────────────────────────────────
  // Mobile: show rooms OR chat (not both). Desktop: both side by side.
  const selectRoom = useCallback((roomId: number) => {
    setSelectedRoomId(roomId);
    setMobileView('chat');
  }, []);

  const backToRooms = useCallback(() => {
    setMobileView('rooms');
    setSelectedRoomId(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  return (
    <div
      className={`flex ${showSideBySide ? 'h-[calc(100vh-5rem)] md:h-[calc(100vh-7rem)] gap-2 md:gap-4 mx-0' : 'h-[calc(100vh-4rem)] gap-2 -mx-1 md:mx-0'} min-h-0`}
    >
      {/* Rooms sidebar — hidden on mobile portrait when chat is open.
          In landscape / desktop, always visible. */}
      <Card
        className={`${showSideBySide ? 'w-56 md:w-72' : 'w-full md:w-72'} flex-shrink-0 flex flex-col p-0 overflow-hidden ${!showSideBySide && mobileView === 'chat' ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              {t('chat.rooms')}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowCreateDialog(true)}
              title={t('chat.create_room')}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Input
            placeholder={t('chat.rooms_search')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim().length >= 2) doSearch(e.target.value);
              else setSearchResults([]);
            }}
            className="h-8 text-sm"
          />
        </div>

        <ScrollArea className="flex-1">
          {searchQuery.trim() && searchResults.length > 0 ? (
            <div className="p-2 space-y-1">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1">
                {t('chat.search_results')}
              </div>
              {searchResults.map((hit, i) => (
                <button
                  key={i}
                  onClick={() => {
                    selectRoom(hit.room.id);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors"
                >
                  <div className="text-xs font-medium truncate">{hit.room.name || hit.room.type}</div>
                  <div className="text-[10px] text-muted-foreground truncate" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
                </button>
              ))}
            </div>
          ) : roomsLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : rooms.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground px-4">
              <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs">{t('chat.no_rooms')}</p>
              <p className="text-[10px] mt-1">{t('chat.no_rooms_hint')}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {rooms
                .filter(r => !searchQuery.trim() || (r.name || '').toLowerCase().includes(searchQuery.toLowerCase()))
                .map(room => (
                <button
                  key={room.id}
                  onClick={() => selectRoom(room.id)}
                  className={`w-full text-left p-2 rounded-md transition-colors ${
                    selectedRoomId === room.id ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Avatar className="w-8 h-8 flex-shrink-0">
                      <AvatarFallback className="text-[10px]">{initials(getRoomTitle(room))}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium truncate">
                          {getRoomTitle(room)}
                          {room.is_archived && <Archive className="inline-block w-3 h-3 ml-1 text-muted-foreground" />}
                        </span>
                        {room.last_message?.created_at && (
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">{fmtTime(room.last_message.created_at)}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-muted-foreground truncate flex-1">
                          {room.last_message
                            ? (room.last_message.text
                                && room.last_message.text !== '🎤 Voice message'
                                && room.last_message.text !== '[object Object]'
                              ? room.last_message.text
                              : room.last_message.attachments?.some(a => a.is_voice)
                                ? '🎤 Голосовое'
                                : room.last_message.attachments?.length
                                  ? '📎 Файл'
                                  : room.last_message.text || '...')
                            : t('chat.no_messages')}
                        </span>
                        {room.unread_count && room.unread_count > 0 ? (
                          <Badge variant="default" className="text-[9px] h-4 px-1 flex-shrink-0">{room.unread_count}</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Chat area — hidden on mobile portrait when rooms list is shown.
          In landscape / desktop, always visible. */}
      <Card className={`flex-1 flex flex-col p-0 overflow-hidden relative min-h-0 ${!showSideBySide && mobileView === 'rooms' ? 'hidden md:flex' : 'flex'}`}>
        {!selectedRoom ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageCircle className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">{t('chat.select_room')}</p>
            <p className="text-xs mt-1">{t('chat.select_room_hint')}</p>
          </div>
        ) : (
          <>
            {/* Chat header — compact for mobile */}
            <div className="px-2 py-2 md:px-3 md:py-3 border-b flex items-center justify-between gap-1 md:gap-2">
              {/* Back button — mobile portrait only (hidden in landscape / desktop) */}
              {!showSideBySide && (
                <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden flex-shrink-0" onClick={backToRooms} title="Назад">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
                <Avatar className="w-7 h-7 md:w-8 md:h-8 flex-shrink-0">
                  <AvatarFallback className="text-[9px] md:text-[10px]">{initials(getRoomTitle(selectedRoom))}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-xs md:text-sm font-medium truncate flex items-center gap-1">
                    <span className="truncate">{getRoomTitle(selectedRoom)}</span>
                    {wsConnected
                      ? <Wifi className="w-3 h-3 text-emerald-500 flex-shrink-0" title="Real-time подключено" />
                      : <WifiOff className="w-3 h-3 text-muted-foreground flex-shrink-0" title="Real-time отключено" />
                    }
                  </div>
                  <div className="text-[9px] md:text-[10px] text-muted-foreground flex items-center gap-1">
                    <span>{selectedRoom.type === 'direct' ? t('chat.direct_chat') : t('chat.group_chat')}</span>
                    {typingUsers.size > 0 && (
                      <span className="text-blue-500 italic truncate">
                        {typingUsers.size === 1 ? t('chat.typing', { user: [...typingUsers][0] }) : t('chat.typing_multiple')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* Right side: call buttons + 3-dot menu */}
              <div className="flex items-center gap-0.5 md:gap-1 relative flex-shrink-0">
                {/* Call UI (audio/video calls via WebRTC) */}
                <CallUI
                  key={`callui-${selectedRoom.id}`}
                  ws={wsRef.current}
                  currentUserId={currentUserId}
                  roomId={selectedRoom.id}
                  members={members}
                />
                {/* 3-dot menu with members + archive + delete */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Меню"><MoreVertical className="w-4 h-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setShowMembersDialog(true)}>
                      <Users className="w-3 h-3 mr-2" />{t('chat.members')} ({members.length})
                    </DropdownMenuItem>
                    {selectedRoom.owner_id === currentUserId && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-500" onClick={() => deleteRoom(selectedRoom.id)}>
                          <Trash2 className="w-3 h-3 mr-2" />{t('chat.delete_room')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto p-3 space-y-2 relative min-h-0"
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
            >
              {isDragging && (
                <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500/50 flex items-center justify-center pointer-events-none z-10">
                  <p className="text-sm text-blue-500 font-medium">{t('chat.drag_drop_hint')}</p>
                </div>
              )}

              {hasMore && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={() => messages.length > 0 && loadMessages(selectedRoom.id, messages[0].id)} disabled={messagesLoading}>
                    {messagesLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    {t('chat.load_more')}
                  </Button>
                </div>
              )}

              {messagesLoading && messages.length === 0 ? (
                <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
              ) : messages.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('chat.no_messages')}</p>
                  <p className="text-[10px] mt-1">{t('chat.no_messages_hint')}</p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  // Detect "own" messages by user_id (preferred) or username (fallback)
                  const isOwn = currentUserId > 0
                    ? msg.user_id === currentUserId
                    : msg.username === user?.username;
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const showAvatar = !prevMsg || prevMsg.user_id !== msg.user_id ||
                    (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000);
                  return (
                    <MessageBubble
                      key={msg.id}
                      msg={msg}
                      isOwn={isOwn}
                      showAvatar={showAvatar}
                      displayName={getMsgDisplayName(msg)}
                      onReply={setReplyTo}
                      onEdit={setEditingMsg}
                      onDelete={deleteMessage}
                      onDownload={downloadAttachment}
                      canModerate={isOwn || selectedRoom.owner_id === currentUserId}
                      t={t}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input — allow sending even without WS (REST fallback) */}
            <MessageInput
              onSend={sendMessage}
              onUploadFile={uploadFile}
              onUploadVoice={uploadVoice}
              onTyping={(isTyping) => wsRef.current?.sendTyping(isTyping)}
              disabled={false}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              editingMsg={editingMsg}
              onCancelEdit={() => setEditingMsg(null)}
              onSaveEdit={(text) => { if (editingMsg) { editMessage(editingMsg.id, text); setEditingMsg(null); } }}
              t={t}
            />
          </>
        )}
      </Card>

      {/* Create room dialog */}
      <CreateRoomDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onCreate={createRoom} currentUserId={currentUserId} t={t} />

      {/* Members dialog */}
      <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users className="w-4 h-4" />{t('chat.members')}</DialogTitle>
            <DialogDescription className="sr-only">{t('chat.members')}</DialogDescription>
          </DialogHeader>
          {membersLoading ? (
            <div className="py-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-1">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted">
                    <Avatar className="w-8 h-8"><AvatarFallback className="text-[10px]">{initials(m.full_name || m.username)}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.full_name || m.username}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {m.role === 'owner' ? t('chat.member_role_owner') : m.role === 'admin' ? t('chat.member_role_admin') : t('chat.member_role_member')}
                        {m.is_online && <span className="ml-2 text-emerald-500">● {t('chat.online')}</span>}
                      </div>
                    </div>
                    {selectedRoom?.owner_id === currentUserId && m.user_id !== currentUserId && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                        onClick={async () => {
                          if (!selectedRoom) return;
                          try {
                            await chatMembersApi.remove(selectedRoom.id, m.user_id);
                            setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
                          } catch (err) { toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_load_members'))); }
                        }}>
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          {selectedRoom?.owner_id === currentUserId && (
            <AddMemberForm roomId={selectedRoom.id} onAdded={() => loadMembers(selectedRoom.id)} t={t} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Voice message player ─────────────────────────────────────────────────
function VoiceMessagePlayer({
  attId, filename, duration, isOwn, onDownload, t,
}: {
  attId: number;
  filename: string;
  duration: number;
  isOwn: boolean;
  onDownload: (attId: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fmtDur = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handlePlay = useCallback(async () => {
    if (!audioRef.current) {
      // Fetch the audio as a blob
      try {
        const { chatFilesApi } = await import('@/lib/api-chat');
        const { blob } = await chatFilesApi.download(attId);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.addEventListener('timeupdate', () => {
          setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
        });
        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          setProgress(0);
        });
      } catch {
        toast.error(t('chat.failed_upload_file'));
        return;
      }
    }
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      audioRef.current?.play();
      setIsPlaying(true);
    }
  }, [attId, isPlaying, t]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg ${isOwn ? 'bg-emerald-700/50' : 'bg-background'} min-w-[180px]`}>
      <button
        onClick={handlePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isOwn ? 'bg-white/20 hover:bg-white/30' : 'bg-emerald-600 hover:bg-emerald-700'
        } text-white`}
      >
        {isPlaying ? (
          <Square className="w-3.5 h-3.5" />
        ) : (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      {/* Waveform / progress bar */}
      <div className="flex-1 flex items-center gap-0.5 h-6">
        {[...Array(24)].map((_, i) => {
          const filled = (progress / 100) * 24;
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-all ${i < filled ? 'bg-white' : 'bg-white/30'}`}
              style={{ height: `${4 + Math.sin(i * 0.7) * 6 + 6}px` }}
            />
          );
        })}
      </div>
      <span className={`text-[10px] font-mono flex-shrink-0 ${isOwn ? 'text-white/80' : 'text-muted-foreground'}`}>
        {fmtDur(duration)}
      </span>
      <button onClick={() => onDownload(attId)} className={`flex-shrink-0 ${isOwn ? 'text-white/60 hover:text-white' : 'text-muted-foreground hover:text-foreground'}`}>
        <Download className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────
function MessageBubble({
  msg, isOwn, showAvatar, displayName, onReply, onEdit, onDelete, onDownload, canModerate, t,
}: {
  msg: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  displayName: string;
  onReply: (msg: ChatMessage) => void;
  onEdit: (msg: ChatMessage) => void;
  onDelete: (msgId: number) => void;
  onDownload: (attId: number) => void;
  canModerate: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isDeleted = !!msg.deleted_at;
  const senderName = isOwn ? t('chat.you') : displayName;
  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''} group`}>
      <div className="w-8 flex-shrink-0">
        {showAvatar && !isDeleted && (
          <Avatar className="w-8 h-8">
            <AvatarFallback className={`text-[10px] ${isOwn ? 'bg-emerald-600 text-white' : 'bg-muted'}`}>
              {initials(senderName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {showAvatar && !isDeleted && (
          <div className={`text-[10px] text-muted-foreground mb-0.5 px-1 flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
            <span className="font-medium">{senderName}</span>
            <span>•</span>
            <span>{fmtTime(msg.created_at)}</span>
          </div>
        )}
        {msg.reply_to && msg.reply_to_text && (
          <div className={`text-[10px] text-muted-foreground px-2 py-0.5 rounded border-l-2 border-border mb-0.5 truncate max-w-full ${isOwn ? 'self-end' : ''}`}>
            <span className="font-medium">{msg.reply_to_username}: </span>{msg.reply_to_text}
          </div>
        )}
        <div className={`relative rounded-lg px-3 py-1.5 text-sm ${isOwn ? 'bg-emerald-600 text-white' : 'bg-muted'} ${isDeleted ? 'opacity-50 italic' : ''}`}>
          {isDeleted ? (
            <span className="text-xs">{t('chat.message_deleted')}</span>
          ) : (
            <>
              {/* Show text ONLY if it's real user text, not placeholder strings from backend */}
              {msg.text && msg.text.trim()
                && msg.text !== '[object Object]'
                && msg.text !== '🎤 Voice message'
                && !/^\d+$/.test(msg.text.trim())
                && !(msg.attachments && msg.attachments.length > 0 && msg.text.startsWith('📎'))
                && (
                <div className="whitespace-pre-wrap break-words">{msg.text}</div>
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className={msg.text && msg.text.trim() ? 'mt-1 space-y-1' : 'space-y-1'}>
                  {msg.attachments.map(att => {
                    // Voice message — show play button + duration (no text label)
                    if (att.is_voice) {
                      return (
                        <VoiceMessagePlayer
                          key={att.id}
                          attId={att.id}
                          filename={att.filename}
                          duration={att.duration_sec || 0}
                          isOwn={isOwn}
                          onDownload={onDownload}
                          t={t}
                        />
                      );
                    }
                    // Regular file
                    return (
                      <button key={att.id} onClick={() => onDownload(att.id)}
                        className={`flex items-center gap-1.5 text-xs p-1.5 rounded border transition-colors w-full ${
                          isOwn ? 'bg-emerald-700/50 border-emerald-400/30 hover:bg-emerald-700' : 'bg-background border-border hover:bg-muted'
                        }`}>
                        {fileIcon(att.mime_type)}
                        <span className="flex-1 text-left truncate">{att.filename}</span>
                        <span className="text-[10px] opacity-60">{fmtFileSize(att.size)}</span>
                        <Download className="w-3 h-3 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
              {msg.edited_at && <span className="text-[9px] opacity-60 ml-1">{t('chat.message_edited')}</span>}
            </>
          )}
          {!isDeleted && (
            <div className={`absolute top-0 ${isOwn ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-background border rounded shadow-sm p-0.5`}>
              {canModerate && (
                <>
                  {isOwn && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(msg)} title={t('chat.edit')}><Pencil className="w-3 h-3" /></Button>}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => onDelete(msg.id)} title={t('chat.delete_message')}><Trash2 className="w-3 h-3" /></Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Message input (multi-line textarea) ──────────────────────────────────
function MessageInput({
  onSend, onUploadFile, onUploadVoice, onTyping, disabled, replyTo, onCancelReply,
  editingMsg, onCancelEdit, onSaveEdit, t,
}: {
  onSend: (text: string, replyTo?: number) => void;
  onUploadFile: (file: File) => void;
  onUploadVoice: (file: File, durationSec: number) => void;
  onTyping: (isTyping: boolean) => void;
  disabled: boolean;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editingMsg: ChatMessage | null;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef(false);

  // ── Voice recording state ──────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Start voice recording
  const startRecording = useCallback(async () => {
    // First check permission state if available
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (result.state === 'denied') {
          setMicPermission('denied');
          toast.error(t('chat.mic_permission_denied', { defaultValue: 'Доступ к микрофону запрещён. Разрешите его в настройках браузера.' }));
          return;
        }
      } catch { /* permissions API not supported */ }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicPermission('granted');

      // Audio level visualization
      try {
        const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const updateLevel = () => {
          if (!analyserRef.current) return;
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch { /* visualization optional */ }

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      recordedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const duration = (Date.now() - recordStartTimeRef.current) / 1000;
        // Only send if recording is longer than 0.5 sec
        if (duration >= 0.5) {
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
          onUploadVoice(file, duration);
        }
        // Cleanup
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;
        streamRef.current?.getTracks().forEach(tr => tr.stop());
        streamRef.current = null;
        setAudioLevel(0);
      };
      mr.start();
      recordStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordTime(0);
      recordTimerRef.current = setInterval(() => {
        setRecordTime(Math.floor((Date.now() - recordStartTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      setMicPermission('denied');
      const errMsg = err instanceof Error ? err.message : String(err);
      if (/notallowed|permission|denied/i.test(errMsg)) {
        toast.error(t('chat.mic_permission_denied', { defaultValue: 'Доступ к микрофону запрещён. Разрешите его в настройках браузера.' }));
      } else {
        toast.error(t('chat.mic_not_available', { defaultValue: 'Микрофон недоступен' }));
      }
    }
  }, [onUploadVoice, t]);

  // Stop voice recording (send)
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Cancel voice recording (discard)
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // Override onstop to do nothing (discard)
      mediaRecorderRef.current.onstop = () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;
        streamRef.current?.getTracks().forEach(tr => tr.stop());
        streamRef.current = null;
        setAudioLevel(0);
      };
      mediaRecorderRef.current.stop();
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordTime(0);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      if (editingMsg) setText(editingMsg.text);
    }
  }, [replyTo, editingMsg]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editingMsg) onSaveEdit(trimmed);
    else onSend(trimmed, replyTo?.id);
    setText('');
    if (lastTypingSentRef.current) {
      onTyping(false);
      lastTypingSentRef.current = false;
    }
  }, [text, editingMsg, replyTo, onSend, onSaveEdit, onTyping]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (!editingMsg && text.length > 0 && !lastTypingSentRef.current) {
      onTyping(true);
      lastTypingSentRef.current = true;
    }
  }, [handleSend, editingMsg, text.length, onTyping]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(onUploadFile);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onUploadFile]);

  // Format recording time as M:SS
  const fmtRecTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <div className="border-t p-3 space-y-2">
      {(replyTo || editingMsg) && (
        <div className="flex items-center gap-2 p-2 bg-muted rounded-md text-xs">
          {editingMsg ? <><Pencil className="w-3 h-3 text-blue-500" /><span>{t('chat.edit_message')}</span></> :
            <><Reply className="w-3 h-3 text-blue-500" />
              <span className="font-medium">{t('chat.reply')}:</span>
              <span className="text-muted-foreground truncate max-w-xs">
                {replyTo?.username ? `${replyTo.username}: ` : ''}
                {replyTo?.text || (replyTo?.attachments?.length ? '📎' : '')}
              </span>
            </>}
          <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={editingMsg ? onCancelEdit : onCancelReply}><X className="w-3 h-3" /></Button>
        </div>
      )}
      {isRecording ? (
        // ── Recording UI with audio level visualization ────────────────
        <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          {/* Animated recording indicator */}
          <div className="relative flex items-center justify-center w-8 h-8">
            <div
              className="absolute inset-0 rounded-full bg-red-500/30 transition-transform"
              style={{ transform: `scale(${1 + audioLevel / 100})` }}
            />
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse relative z-10" />
          </div>
          {/* Timer + waveform */}
          <div className="flex-1 flex items-center gap-2">
            <span className="text-sm font-mono text-red-500 tabular-nums">{fmtRecTime(recordTime)}</span>
            {/* Audio level bar */}
            <div className="flex-1 h-6 flex items-center gap-0.5">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-all ${i < (audioLevel / 5) ? 'bg-red-500' : 'bg-red-500/20'}`}
                  style={{ height: `${4 + (i < (audioLevel / 5) ? Math.random() * 12 : 0)}px` }}
                />
              ))}
            </div>
          </div>
          {/* Cancel (icon only) + Send (icon only) */}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-500/10 flex-shrink-0" onClick={cancelRecording} title={t('chat.cancel_recording')}>
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button size="icon" className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700 rounded-full flex-shrink-0" onClick={stopRecording} title={t('chat.send')}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        // ── Normal input UI — textarea LEFT, icons RIGHT ─────────────
        // Mic: hold to record, release to send. File: tap to attach. Send: tap to send text.
        <div className="flex items-end gap-1">
          {/* Left: textarea */}
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.message_placeholder')}
              disabled={disabled}
              rows={1}
              className="min-h-[36px] max-h-[120px] resize-none text-sm py-2 px-3 rounded-full"
            />
          </div>
          {/* Right: file + mic + send */}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} multiple />
          {/* File icon */}
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => fileInputRef.current?.click()} disabled={disabled} title={t('chat.attach_file')}>
            <Paperclip className="w-4 h-4" />
          </Button>
          {/* Mic: hold to record, release to send. Show Send icon if there's text. */}
          {text.trim() ? (
            <Button size="icon" className="h-8 w-8 flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 rounded-full" onClick={handleSend} disabled={disabled} title={t('chat.send')}>
              <Send className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={cancelRecording}
              onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
              disabled={disabled}
              title={t('chat.voice_recording_hint')}
            >
              <Mic className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── User search input (reusable) ─────────────────────────────────────────
function UserSearchInput({
  selectedUsers,
  onAdd,
  onRemove,
  excludeIds = [],
  t,
}: {
  selectedUsers: MgmtUser[];
  onAdd: (user: MgmtUser) => void;
  onRemove: (userId: number) => void;
  excludeIds?: number[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MgmtUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const users = await mgmtUsersApi.list({ search: q.trim(), limit: 20 });
      setResults(users.filter(u => !excludeIds.includes(u.id) && u.is_active !== 0));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [excludeIds]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setShowResults(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder={t('chat.search_users_placeholder', { defaultValue: 'Поиск по имени или username...' })}
            className="h-8 text-sm pl-7"
          />
          {searching && <Loader2 className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 animate-spin" />}
        </div>
        {/* Search results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {results.map(u => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onAdd(u); setQuery(''); setResults([]); }}
                className="w-full flex items-center gap-2 p-2 hover:bg-muted transition-colors text-left"
              >
                <Avatar className="w-6 h-6"><AvatarFallback className="text-[9px]">{initials(u.full_name || u.username)}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{u.full_name || u.username}</div>
                  <div className="text-[10px] text-muted-foreground">@{u.username} • ID: {u.id}</div>
                </div>
                <UserPlus className="w-3 h-3 text-emerald-500 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Selected users chips */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedUsers.map(u => (
            <Badge key={u.id} variant="secondary" className="text-xs gap-1 pr-1">
              {u.full_name || u.username}
              <button type="button" onClick={() => onRemove(u.id)} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create room dialog ───────────────────────────────────────────────────
function CreateRoomDialog({
  open, onOpenChange, onCreate, currentUserId, t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (type: RoomType, name: string, memberIds: number[]) => void;
  currentUserId: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [type, setType] = useState<RoomType>('group');
  const [name, setName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<MgmtUser[]>([]);

  const handleCreate = useCallback(() => {
    const memberIds = selectedUsers.map(u => u.id).filter(id => id !== currentUserId);
    onCreate(type, name, memberIds);
    setName('');
    setSelectedUsers([]);
    setType('group');
  }, [type, name, selectedUsers, currentUserId, onCreate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chat.create_room')}</DialogTitle>
          <DialogDescription className="sr-only">{t('chat.create_room')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('chat.create_group')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as RoomType)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="group">{t('chat.create_group')}</SelectItem>
                <SelectItem value="direct">{t('chat.create_direct')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type === 'group' && (
            <div className="space-y-1">
              <Label className="text-xs">{t('chat.room_name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('chat.room_name_placeholder')} className="h-8 text-sm" />
              <p className="text-[10px] text-muted-foreground">{t('chat.auto_title_hint')}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">{t('chat.add_members')}</Label>
            <UserSearchInput
              selectedUsers={selectedUsers}
              onAdd={(u) => setSelectedUsers(prev => prev.some(x => x.id === u.id) ? prev : [...prev, u])}
              onRemove={(id) => setSelectedUsers(prev => prev.filter(x => x.id !== id))}
              excludeIds={[currentUserId]}
              t={t}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCreate} disabled={type === 'group' && !name.trim()}>
            <Plus className="w-4 h-4 mr-1" />{t('chat.create_room')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add member form (with user search) ───────────────────────────────────
function AddMemberForm({ roomId, onAdded, t }: { roomId: number; onAdded: () => void; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const [loading, setLoading] = useState(false);

  const handleAdd = useCallback(async (user: MgmtUser) => {
    setLoading(true);
    try {
      await chatMembersApi.add(roomId, user.id);
      onAdded();
      toast.success(t('chat.room_updated'));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.failed_load_members')));
    } finally {
      setLoading(false);
    }
  }, [roomId, onAdded, t]);

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <Label className="text-xs">{t('chat.add_members')}</Label>
      <UserSearchInput
        selectedUsers={[]}
        onAdd={handleAdd}
        onRemove={() => {}}
        t={t}
      />
      {loading && <Loader2 className="w-3 h-3 animate-spin" />}
    </div>
  );
}
