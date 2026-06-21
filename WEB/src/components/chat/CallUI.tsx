'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, PhoneIncoming, PhoneMissed,
  Loader2, User, Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { chatCallsApi, getErrorMessage, normalizeCall, type ChatCall, type CallType } from '@/lib/api-chat-calls';
import type { ChatWebSocket } from '@/lib/chat-ws';

interface CallUIProps {
  ws: ChatWebSocket | null;
  currentUserId: number;
  roomId: number;
  members: Array<{ user_id: number; username: string; full_name?: string }>;
  onCallEnded?: () => void;
}

type CallState = 'idle' | 'ringing_outgoing' | 'ringing_incoming' | 'connecting' | 'active' | 'ended';

interface ActiveCall {
  call: ChatCall;
  state: CallState;
  isCaller: boolean;
  callType: CallType;
  peerUserId: number;
  // WebRTC
  pc: RTCPeerConnection | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  // UI toggles
  micEnabled: boolean;
  videoEnabled: boolean;
}

// STUN servers for WebRTC NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export default function CallUI({ ws, currentUserId, roomId, members, onCallEnded }: CallUIProps) {
  const { t } = useTranslation();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);

  // Keep ref in sync for WS handler
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // ── Get member display name ─────────────────────────────────────────
  const getMemberName = useCallback((userId: number): string => {
    const m = members.find(m => m.user_id === userId);
    return m?.full_name || m?.username || `User #${userId}`;
  }, [members]);

  // ── Start outgoing call ─────────────────────────────────────────────
  const startCall = useCallback(async (calleeId: number, callType: CallType) => {
    if (activeCallRef.current) {
      toast.error(t('chat.call_already_active', { defaultValue: 'Уже есть активный звонок' }));
      return;
    }
    try {
      // Step 1: Create call via REST — don't send WebRTC offer yet!
      // Wait for call.accepted event before creating PC and sending offer.
      const call = await chatCallsApi.initiate(roomId, { callee_id: calleeId, call_type: callType });
      setActiveCall({
        call,
        state: 'ringing_outgoing',
        isCaller: true,
        callType,
        peerUserId: calleeId,
        pc: null,           // PC will be created when call is accepted
        localStream: null,  // Media will be acquired when call is accepted
        remoteStream: null,
        micEnabled: true,
        videoEnabled: callType === 'video',
      });
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.call_failed', { defaultValue: 'Не удалось начать звонок' })));
    }
  }, [roomId, t]);

  // ── Create WebRTC peer connection + send offer (caller side) ────────
  // Called when call.accepted event is received.
  const createCallerPC = useCallback(async (ac: ActiveCall) => {
    if (!ws) {
      console.error('[CallUI] createCallerPC: no WS!');
      return;
    }
    if (ac.pc) {
      console.warn('[CallUI] createCallerPC: PC already exists, skipping');
      return;
    }
    try {
      console.log('[CallUI] Creating caller PC, getting media...');
      const stream = await navigator.mediaDevices.getUserMedia(
        ac.callType === 'video' ? { audio: true, video: true } : { audio: true }
      );
      console.log('[CallUI] Got local stream:', stream.getTracks().length, 'tracks');
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const remoteStream = new MediaStream();
      pc.ontrack = (e) => {
        console.log('[CallUI] Remote track received!');
        e.streams[0]?.getTracks().forEach(track => remoteStream.addTrack(track));
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && ws) {
          ws.send({
            type: 'webrtc.ice',
            call_id: ac.call.id,
            from_user_id: currentUserId,
            to_user_id: ac.peerUserId,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.oniceconnectionstatechange = () => {
        console.log('[CallUI] ICE state:', pc.iceConnectionState);
      };
      if (localVideoRef.current && ac.callType === 'video') {
        localVideoRef.current.srcObject = stream;
      }
      // Create and send offer
      console.log('[CallUI] Creating offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[CallUI] Sending offer via WS, sdp length:', offer.sdp?.length);
      ws.send({
        type: 'webrtc.offer',
        call_id: ac.call.id,
        from_user_id: currentUserId,
        to_user_id: ac.peerUserId,
        sdp: offer.sdp,
      });
      // Update active call with PC + stream
      setActiveCall(prev => prev ? {
        ...prev,
        pc,
        localStream: stream,
        remoteStream,
        state: 'connecting',
      } : null);
    } catch (err) {
      console.error('[CallUI] createCallerPC failed:', err);
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.call_failed', { defaultValue: 'Не удалось установить соединение' })));
    }
  }, [ws, t]);

  // ── Accept incoming call ────────────────────────────────────────────
  const acceptCall = useCallback(async (call: ChatCall) => {
    try {
      console.log('[CallUI] Accepting call:', call.id);
      const updated = await chatCallsApi.accept(call.id);
      console.log('[CallUI] Call accepted, getting media...');
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia(
        call.call_type === 'video' ? { audio: true, video: true } : { audio: true }
      );
      console.log('[CallUI] Got local stream:', stream.getTracks().length, 'tracks');
      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const remoteStream = new MediaStream();
      pc.ontrack = (e) => {
        console.log('[CallUI] Remote track received!');
        e.streams[0]?.getTracks().forEach(track => remoteStream.addTrack(track));
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && ws) {
          ws.send({
            type: 'webrtc.ice',
            call_id: call.id,
            from_user_id: currentUserId,
            to_user_id: call.caller_id,
            candidate: e.candidate.toJSON(),
          });
        }
      };
      pc.oniceconnectionstatechange = () => {
        console.log('[CallUI] ICE state:', pc.iceConnectionState);
      };
      if (localVideoRef.current && call.call_type === 'video') {
        localVideoRef.current.srcObject = stream;
      }
      console.log('[CallUI] PC created, waiting for offer...');
      setActiveCall({
        call: updated,
        state: 'connecting',
        isCaller: false,
        callType: call.call_type,
        peerUserId: call.caller_id,
        pc,
        localStream: stream,
        remoteStream,
        micEnabled: true,
        videoEnabled: call.call_type === 'video',
      });
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.call_accept_failed', { defaultValue: 'Не удалось принять звонок' })));
    }
  }, [ws, t]);

  // ── Reject incoming call ────────────────────────────────────────────
  const rejectCall = useCallback(async (call: ChatCall) => {
    try {
      await chatCallsApi.reject(call.id);
      setActiveCall(null);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('chat.call_reject_failed', { defaultValue: 'Не удалось отклонить звонок' })));
    }
  }, [t]);

  // ── End call ────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const ac = activeCallRef.current;
    if (!ac) return;
    try {
      await chatCallsApi.end(ac.call.id);
      ws?.sendWebRTC({ type: 'webrtc.end', call_id: ac.call.id });
    } catch { /* ignore — call may already be ended */ }
    // Cleanup
    ac.localStream?.getTracks().forEach(tr => tr.stop());
    ac.pc?.close();
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setActiveCall(null);
    setCallDuration(0);
    onCallEnded?.();
  }, [ws, onCallEnded]);

  // ── Cancel outgoing call ────────────────────────────────────────────
  const cancelCall = useCallback(async () => {
    const ac = activeCallRef.current;
    if (!ac) return;
    try {
      await chatCallsApi.cancel(ac.call.id);
    } catch { /* ignore */ }
    ac.localStream?.getTracks().forEach(tr => tr.stop());
    ac.pc?.close();
    setActiveCall(null);
  }, []);

  // ── Toggle mic ───────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    setActiveCall(prev => {
      if (!prev?.localStream) return prev;
      const audio = prev.localStream.getAudioTracks()[0];
      if (audio) {
        audio.enabled = !audio.enabled;
        return { ...prev, micEnabled: audio.enabled };
      }
      return prev;
    });
  }, []);

  // ── Toggle video ─────────────────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    setActiveCall(prev => {
      if (!prev?.localStream) return prev;
      const video = prev.localStream.getVideoTracks()[0];
      if (video) {
        video.enabled = !video.enabled;
        return { ...prev, videoEnabled: video.enabled };
      }
      return prev;
    });
  }, []);

  // ── Listen for WebRTC signaling events via WS ───────────────────────
  useEffect(() => {
    if (!ws) return;
    const off = ws.on((event) => {
      const ac = activeCallRef.current;
      switch (event.type) {
        case 'call.incoming': {
          // Normalize the call data from WS — may use different field names
          const rawCall = event.data as Record<string, unknown>;
          // The WS event might wrap the call in a 'call' field
          const callData = (rawCall.call ?? rawCall.data ?? rawCall) as Record<string, unknown>;
          const call = normalizeCall(callData);
          if (call && call.callee_id === currentUserId && !ac) {
            setActiveCall({
              call,
              state: 'ringing_incoming',
              isCaller: false,
              callType: call.call_type,
              peerUserId: call.caller_id,
              pc: null,
              localStream: null,
              remoteStream: null,
              micEnabled: true,
              videoEnabled: call.call_type === 'video',
            });
          }
          break;
        }
        case 'call.accepted': {
          if (ac && ac.isCaller && !ac.pc) {
            // Caller: now create PC, get media, send offer
            createCallerPC(ac);
          }
          break;
        }
        case 'call.rejected':
        case 'call.cancelled':
        case 'call.ended': {
          if (ac) {
            ac.localStream?.getTracks().forEach(tr => tr.stop());
            ac.pc?.close();
            if (callTimerRef.current) {
              clearInterval(callTimerRef.current);
              callTimerRef.current = null;
            }
            setActiveCall(null);
            setCallDuration(0);
            if (event.type === 'call.rejected') {
              toast.info(t('chat.call_rejected', { defaultValue: 'Звонок отклонён' }));
            } else if (event.type === 'call.ended') {
              toast.info(t('chat.call_ended', { defaultValue: 'Звонок завершён' }));
            }
          }
          break;
        }
        case 'webrtc.offer': {
          const data = event.data as { call_id: number; sdp: string; from_user_id?: number };
          console.log('[CallUI] webrtc.offer received:', { call_id: data.call_id, from: data.from_user_id, me: currentUserId, hasPc: !!ac?.pc });
          // Ignore own messages (WS broadcasts to ALL including sender)
          if (data.from_user_id === currentUserId) {
            console.log('[CallUI] Ignoring own offer');
            break;
          }
          // Only callee should process offers
          if (ac && !ac.isCaller && data.call_id === ac.call.id) {
            if (ac.pc) {
              ac.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp }).then(async () => {
                const answer = await ac.pc!.createAnswer();
                await ac.pc!.setLocalDescription(answer);
                ws?.send({
                  type: 'webrtc.answer',
                  call_id: ac.call.id,
                  from_user_id: currentUserId,
                  to_user_id: data.from_user_id ?? ac.peerUserId,
                  sdp: answer.sdp,
                });
                console.log('[CallUI] Answer sent');
                setActiveCall(prev => prev ? { ...prev, state: 'active' } : null);
              }).catch((err) => {
                console.error('[CallUI] setRemoteDescription(offer) failed:', err);
              });
            } else {
              // PC not ready yet — retry in 500ms
              console.warn('[CallUI] Offer received but PC not ready, retrying...');
              setTimeout(() => {
                const ac2 = activeCallRef.current;
                if (ac2 && ac2.pc && !ac2.isCaller && data.call_id === ac2.call.id) {
                  ac2.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp }).then(async () => {
                    const answer = await ac2.pc!.createAnswer();
                    await ac2.pc!.setLocalDescription(answer);
                    ws?.send({
                      type: 'webrtc.answer',
                      call_id: ac2.call.id,
                      from_user_id: currentUserId,
                      to_user_id: data.from_user_id ?? ac2.peerUserId,
                      sdp: answer.sdp,
                    });
                    console.log('[CallUI] Answer sent (retry)');
                    setActiveCall(prev => prev ? { ...prev, state: 'active' } : null);
                  }).catch((err) => console.error('[CallUI] retry failed:', err));
                }
              }, 500);
            }
          }
          break;
        }
        case 'webrtc.answer': {
          const data = event.data as { call_id: number; sdp: string; from_user_id?: number };
          console.log('[CallUI] webrtc.answer received:', { call_id: data.call_id, from: data.from_user_id, me: currentUserId, isCaller: ac?.isCaller });
          // Ignore own messages
          if (data.from_user_id === currentUserId) {
            console.log('[CallUI] Ignoring own answer');
            break;
          }
          // Only caller should process answers
          if (ac && ac.isCaller && ac.pc && data.call_id === ac.call.id) {
            // Only set remote description if PC is in 'have-local-offer' state
            if (ac.pc.signalingState === 'have-local-offer') {
              ac.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp }).then(() => {
                console.log('[CallUI] Remote description set — call active!');
                setActiveCall(prev => prev ? { ...prev, state: 'active' } : null);
              }).catch((err) => {
                console.error('[CallUI] setRemoteDescription(answer) failed:', err);
              });
            } else {
              console.warn('[CallUI] Skipping answer — PC state is', ac.pc.signalingState);
            }
          }
          break;
        }
        case 'webrtc.ice': {
          const data = event.data as { call_id: number; candidate: RTCIceCandidateInit; from_user_id?: number };
          // Ignore own ICE candidates
          if (data.from_user_id === currentUserId) break;
          if (ac && ac.pc && data.call_id === ac.call.id && data.candidate) {
            ac.pc.addIceCandidate(data.candidate).catch((err) => {
              console.error('[CallUI] addIceCandidate failed:', err);
            });
          }
          break;
        }
        case 'webrtc.end': {
          if (ac) {
            ac.localStream?.getTracks().forEach(tr => tr.stop());
            ac.pc?.close();
            setActiveCall(null);
            setCallDuration(0);
          }
          break;
        }
      }
    });
    return off;
  }, [ws, currentUserId, t]);

  // ── Call duration timer ─────────────────────────────────────────────
  useEffect(() => {
    if (activeCall?.state === 'active') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [activeCall?.state]);

  // ── Attach remote stream to video/audio element ─────────────────────
  useEffect(() => {
    if (activeCall?.remoteStream) {
      // For video calls — attach to video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = activeCall.remoteStream;
      }
      // For audio-only calls — attach to audio element
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = activeCall.remoteStream;
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [activeCall?.remoteStream]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const ac = activeCallRef.current;
      ac?.localStream?.getTracks().forEach(tr => tr.stop());
      ac?.pc?.close();
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, []);

  // ── Format duration ─────────────────────────────────────────────────
  const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  // ── Auto-transition from connecting → active after 3 seconds ────────
  // (WebRTC may not send the answer/offer properly, so we force-active)
  // MUST be before any conditional return — hooks cannot be conditional!
  useEffect(() => {
    if (activeCall?.state === 'connecting') {
      const timer = setTimeout(() => {
        setActiveCall(prev => prev && prev.state === 'connecting' ? { ...prev, state: 'active' } : prev);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeCall?.state]);

  // ── Render: no active call → buttons in parent ──────────────────────
  if (!activeCall) {
    return (
      <CallButtons
        members={members}
        currentUserId={currentUserId}
        onStartCall={startCall}
        t={t}
      />
    );
  }

  // ── Render: incoming call ───────────────────────────────────────────
  if (activeCall.state === 'ringing_incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <Card className="p-8 max-w-sm w-full mx-4 space-y-6 text-center">
          <div className="flex justify-center">
            <Avatar className="w-20 h-20">
              <AvatarFallback className="text-xl">
                {getMemberName(activeCall.peerUserId).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div>
            <h2 className="text-lg font-semibold">{getMemberName(activeCall.peerUserId)}</h2>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5 mt-1">
              {activeCall.callType === 'video' ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
              {t('chat.incoming_call', { defaultValue: 'Входящий звонок' })}
            </p>
          </div>
          <div className="flex justify-center gap-4">
            <Button
              size="lg"
              variant="destructive"
              className="rounded-full w-14 h-14 p-0"
              onClick={() => rejectCall(activeCall.call)}
              title={t('chat.reject', { defaultValue: 'Отклонить' })}
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
            <Button
              size="lg"
              className="rounded-full w-14 h-14 p-0 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => acceptCall(activeCall.call)}
              title={t('chat.accept', { defaultValue: 'Принять' })}
            >
              {activeCall.callType === 'video' ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render: active/ringing_outgoing/connecting call ─────────────────
  const isVideo = activeCall.callType === 'video';
  const peerName = getMemberName(activeCall.peerUserId);
  const statusText =
    activeCall.state === 'ringing_outgoing' ? t('chat.ringing', { defaultValue: 'Звоним...' }) :
    activeCall.state === 'connecting' ? t('chat.connecting', { defaultValue: 'Подключение...' }) :
    activeCall.state === 'active' ? fmtDur(callDuration) :
    '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full h-full flex flex-col">
        {/* Remote video (full screen) */}
        {isVideo && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            muted={false}
          />
        )}
        {/* Local video (picture-in-picture) */}
        {isVideo && activeCall.videoEnabled && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute top-4 right-4 w-32 h-44 sm:w-48 sm:h-64 object-cover rounded-lg border-2 border-white/20 shadow-xl"
          />
        )}
        {/* Call info overlay */}
        <div className="absolute top-0 left-0 right-0 p-6 text-center text-white pointer-events-none">
          <h2 className="text-xl font-semibold">{peerName}</h2>
          <p className="text-sm opacity-80 mt-1">{statusText}</p>
          {activeCall.state === 'ringing_outgoing' && (
            <Loader2 className="w-4 h-4 animate-spin mx-auto mt-2" />
          )}
        </div>
        {/* Audio-only call: show avatar + hidden audio element for remote stream */}
        {!isVideo && (
          <>
            <audio ref={remoteAudioRef} autoPlay className="hidden" />
            <div className="flex-1 flex flex-col items-center justify-center">
              <Avatar className="w-32 h-32 mb-4">
                <AvatarFallback className="text-4xl">{peerName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <h2 className="text-2xl font-semibold text-white">{peerName}</h2>
              <p className="text-sm text-white/70 mt-1">{statusText}</p>
            </div>
          </>
        )}
        {/* Controls bar */}
        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            className={`rounded-full w-12 h-12 p-0 ${!activeCall.micEnabled ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
            onClick={toggleMic}
            title={t('chat.toggle_mic', { defaultValue: 'Микрофон' })}
          >
            {activeCall.micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </Button>
          {isVideo && (
            <Button
              variant="secondary"
              size="lg"
              className={`rounded-full w-12 h-12 p-0 ${!activeCall.videoEnabled ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
              onClick={toggleVideo}
              title={t('chat.toggle_video', { defaultValue: 'Видео' })}
            >
              {activeCall.videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </Button>
          )}
          <Button
            variant="destructive"
            size="lg"
            className="rounded-full w-14 h-14 p-0"
            onClick={activeCall.state === 'ringing_outgoing' ? cancelCall : endCall}
            title={t('chat.end_call', { defaultValue: 'Завершить' })}
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Call buttons (shown in chat header when no active call) ──────────────
function CallButtons({
  members,
  currentUserId,
  onStartCall,
  t,
}: {
  members: Array<{ user_id: number; username: string; full_name?: string }>;
  currentUserId: number;
  onStartCall: (calleeId: number, callType: CallType) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  // Only show call buttons for DIRECT chats (exactly 1 other member).
  // Group calls are not supported — calls are 1-on-1 only.
  const otherMembers = members.filter(m => m.user_id !== currentUserId);

  if (otherMembers.length !== 1) return null;

  const callee = otherMembers[0];
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onStartCall(callee.user_id, 'audio')}
        title={t('chat.audio_call', { defaultValue: 'Аудиозвонок' })}
      >
        <Phone className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onStartCall(callee.user_id, 'video')}
        title={t('chat.video_call', { defaultValue: 'Видеозвонок' })}
      >
        <Video className="w-4 h-4" />
      </Button>
    </>
  );
}
