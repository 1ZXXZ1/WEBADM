'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Loader2, ServerCrash, Ghost, Frown, AlertTriangle, Ban, Clock, ShieldX, LogOut, User, KeyRound, PowerOff, Moon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ═══════════════════════════════════════════════════════════════════════════
// Animated Loading Screen — shown on initial app mount
// ═══════════════════════════════════════════════════════════════════════════

const LOADING_MESSAGES_RU = [
  'Загрузка Samba AD...',
  'Подключение к контроллеру домена...',
  'Синхронизация с LDAP...',
  'Инициализация разрешений...',
  'Загрузка схемы AD...',
  'Подготовка интерфейса...',
  'Почти готово...',
];

const LOADING_MESSAGES_EN = [
  'Loading Samba AD...',
  'Connecting to domain controller...',
  'Syncing with LDAP...',
  'Initializing permissions...',
  'Loading AD schema...',
  'Preparing interface...',
  'Almost there...',
];

export function AnimatedLoadingScreen() {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? LOADING_MESSAGES_RU : LOADING_MESSAGES_EN;
  const [msgIdx, setMsgIdx] = useState(0);
  const [dots, setDots] = useState('');

  // Cycle through loading messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 800);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev.length >= 3) return '';
        return prev + '.';
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 space-y-6">
      {/* Animated logo / spinner */}
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center animate-pulse">
          <ServerCrash className="w-8 h-8 text-white" />
        </div>
        {/* Spinning ring around the logo */}
        <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
      </div>

      {/* App name */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-white">Samba AD</h1>
        <p className="text-xs text-gray-500">
          {lang === 'ru' ? 'Панель управления' : 'Management Panel'}
        </p>
      </div>

      {/* Animated loading message */}
      <div className="text-center space-y-2 min-h-[60px]">
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span className="font-mono">
            {messages[msgIdx]}{dots}
          </span>
        </div>
        {/* Progress bar animation */}
        <div className="w-48 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full"
            style={{
              width: `${((msgIdx + 1) / messages.length) * 100}%`,
              transition: 'width 0.8s ease-in-out',
            }}
          />
        </div>
      </div>

      {/* Language indicator */}
      <div className="flex items-center gap-2 text-[10px] text-gray-600">
        <span className={lang === 'ru' ? 'text-emerald-400 font-bold' : ''}>RU</span>
        <span>|</span>
        <span className={lang === 'en' ? 'text-emerald-400 font-bold' : ''}>EN</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Permission Denied Screen — shown when user lacks permission for a page
// ═══════════════════════════════════════════════════════════════════════════

const FUNNY_DENY_MESSAGES_RU = [
  '( ´･･)ﾉ(._.\`)  От вас ¯\\_(ツ)_/¯  тоже Дашборд  ಥ_ಥ',
  '༼ つ ◕_◕ ༽つ  Дашборд убежал!',
  '(╯°□°)╯︵ ┻━┻  Доступ запрещён!',
  '¯\\_(ツ)_/¯  Нет прав — нет печенек.',
  '(•_•)  Вы не можете сюда.  (•_•)',
  'ヽ(ｏ｀皿´ｏ)ﾉ  Доступ закрыт!',
];

const FUNNY_DENY_MESSAGES_EN = [
  '( ´･･)ﾉ(._.\`)  From you ¯\\_(ツ)_/¯  the Dashboard too ಥ_ಥ',
  '༼ つ ◕_◕ ༽つ  Dashboard ran away!',
  '(╯°□°)╯︵ ┻━┻  Access denied!',
  '¯\\_(ツ)_/¯  No permission — no cookies.',
  '(•_•)  You cannot pass.  (•_•)',
  'ヽ(ｏ｀皿´ｏ)ﾉ  Access closed!',
];

interface PermissionDeniedScreenProps {
  pageName?: string;
  requiredPermission?: string;
}

export function PermissionDeniedScreen({ pageName, requiredPermission }: PermissionDeniedScreenProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? FUNNY_DENY_MESSAGES_RU : FUNNY_DENY_MESSAGES_EN;
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * messages.length));

  // Rotate message every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] space-y-6 text-center px-4">
      {/* Big lock icon */}
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center animate-pulse">
          <Lock className="w-12 h-12 text-red-400" />
        </div>
        {/* Shake animation on hover */}
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-red-400">
          {lang === 'ru' ? 'Доступ запрещён' : 'Access Denied'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lang === 'ru'
            ? `У вас нет прав для просмотра раздела «${pageName || 'этот'}»`
            : `You don't have permission to view "${pageName || 'this'}" section`}
        </p>
      </div>

      {/* Funny message */}
      <div className="max-w-md p-4 rounded-lg bg-muted/30 border border-border/50">
        <pre className="text-xs font-mono text-amber-400 whitespace-pre-wrap text-center leading-relaxed">
          {messages[msgIdx]}
        </pre>
      </div>

      {/* Required permission */}
      {requiredPermission && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{lang === 'ru' ? 'Требуется разрешение:' : 'Required permission:'}</span>
          <code className="px-2 py-0.5 rounded bg-muted font-mono text-amber-400">
            {requiredPermission}
          </code>
        </div>
      )}

      {/* Hint */}
      <p className="text-[10px] text-muted-foreground/60 max-w-sm">
        {lang === 'ru'
          ? 'Обратитесь к администратору, чтобы получить необходимые права. Либо переключитесь на раздел, к которому у вас есть доступ.'
          : 'Contact your administrator to get the required permissions. Or switch to a section you have access to.'}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Screen — for HTTP error codes (400, 403, 404, 500, etc.)
// ═══════════════════════════════════════════════════════════════════════════

interface ErrorScreenProps {
  code?: number;
  title?: string;
  message?: string;
  onRetry?: () => void;
  onHome?: () => void;
}

const ERROR_CONFIG: Record<number, { icon: React.ElementType; color: string; titleRu: string; titleEn: string; msgRu: string; msgEn: string; funnyRu: string; funnyEn: string }> = {
  400: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    titleRu: '400 — Неверный запрос',
    titleEn: '400 — Bad Request',
    msgRu: 'Сервер не понял ваш запрос. Возможно, данные были отправлены в неправильном формате.',
    msgEn: 'The server did not understand your request. The data may have been sent in the wrong format.',
    funnyRu: '(¬_¬)  Вы точно уверены, что нажали правильно?',
    funnyEn: '(¬_¬)  Are you sure you clicked correctly?',
  },
  403: {
    icon: Lock,
    color: 'text-red-400',
    titleRu: '403 — Доступ запрещён',
    titleEn: '403 — Forbidden',
    msgRu: 'У вас нет прав для доступа к этому ресурсу.',
    msgEn: 'You do not have permission to access this resource.',
    funnyRu: '(╯°□°)╯︵ ┻━┻  Нет прав — нет доступа!',
    funnyEn: '(╯°□°)╯︵ ┻━┻  No permission — no access!',
  },
  404: {
    icon: Ghost,
    color: 'text-purple-400',
    titleRu: '404 — Не найдено',
    titleEn: '404 — Not Found',
    msgRu: 'Страница, которую вы ищете, не существует или была перемещена.',
    msgEn: 'The page you are looking for does not exist or has been moved.',
    funnyRu: '( ´･_･`)  Страница убежала...  ᕕ( ᐛ )ᕗ',
    funnyEn: '( ´･_･`)  The page ran away...  ᕕ( ᐛ )ᕗ',
  },
  500: {
    icon: ServerCrash,
    color: 'text-red-500',
    titleRu: '500 — Внутренняя ошибка сервера',
    titleEn: '500 — Internal Server Error',
    msgRu: 'Что-то пошло не так на стороне сервера. Попробуйте позже.',
    msgEn: 'Something went wrong on the server side. Please try again later.',
    funnyRu: '(╥_╥)  Сервер плачет...  ╥﹏╥',
    funnyEn: '(╥_╥)  The server is crying...  ╥﹏╥',
  },
  502: {
    icon: ServerCrash,
    color: 'text-orange-400',
    titleRu: '502 — Шлюз недоступен',
    titleEn: '502 — Bad Gateway',
    msgRu: 'Сервер-шлюз не получил ответ от вышестоящего сервера.',
    msgEn: 'The gateway server did not receive a response from the upstream server.',
    funnyRu: '¯\\_(ツ)_/¯  Сервер где-то потерялся...',
    funnyEn: '¯\\_(ツ)_/¯  The server got lost somewhere...',
  },
  503: {
    icon: Frown,
    color: 'text-amber-400',
    titleRu: '503 — Сервис недоступен',
    titleEn: '503 — Service Unavailable',
    msgRu: 'Сервис временно недоступен. Возможно, идёт обслуживание.',
    msgEn: 'The service is temporarily unavailable. Maintenance may be in progress.',
    funnyRu: '(｡•́︿•̀｡)  Сервер отдыхает...  zZz',
    funnyEn: '(｡•́︿•̀｡)  The server is resting...  zZz',
  },
};

export function ErrorScreen({ code = 404, title, message, onRetry, onHome }: ErrorScreenProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const config = ERROR_CONFIG[code] || ERROR_CONFIG[404];
  const Icon = config.icon;

  const displayTitle = title || (lang === 'ru' ? config.titleRu : config.titleEn);
  const displayMsg = message || (lang === 'ru' ? config.msgRu : config.msgEn);
  const funnyMsg = lang === 'ru' ? config.funnyRu : config.funnyEn;

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] space-y-6 text-center px-4">
      {/* Big error code */}
      <div className="relative">
        <div className={`text-8xl font-bold ${config.color} animate-pulse`}>
          {code}
        </div>
        <Icon className={`w-12 h-12 ${config.color} absolute -top-2 -right-8 animate-bounce`} />
      </div>

      {/* Title */}
      <h2 className="text-xl font-bold text-foreground">{displayTitle}</h2>

      {/* Message */}
      <p className="text-sm text-muted-foreground max-w-md">{displayMsg}</p>

      {/* Funny message */}
      <div className="max-w-md p-3 rounded-lg bg-muted/30 border border-border/50">
        <pre className="text-xs font-mono text-amber-400 whitespace-pre-wrap text-center">
          {funnyMsg}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {lang === 'ru' ? 'Повторить' : 'Retry'}
          </Button>
        )}
        {onHome && (
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onHome}>
            {lang === 'ru' ? 'На главную' : 'Go Home'}
          </Button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline Error Component — for embedding inside pages (e.g. API errors)
// ═══════════════════════════════════════════════════════════════════════════

interface InlineErrorProps {
  code?: number;
  message?: string;
  onRetry?: () => void;
}

export function InlineError({ code = 500, message, onRetry }: InlineErrorProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const config = ERROR_CONFIG[code] || ERROR_CONFIG[500];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
      <div className={`text-5xl font-bold ${config.color}`}>{code}</div>
      <Icon className={`w-8 h-8 ${config.color}`} />
      <p className="text-sm text-muted-foreground max-w-sm">
        {message || (lang === 'ru' ? config.msgRu : config.msgEn)}
      </p>
      <pre className="text-[10px] font-mono text-amber-400/70">
        {lang === 'ru' ? config.funnyRu : config.funnyEn}
      </pre>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {lang === 'ru' ? 'Повторить' : 'Retry'}
        </Button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Expired Screen — shown when JWT tokens expire (401)
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_EXPIRED_FUNNY_RU = [
  '(╯°□°)╯︵ ┻━┻  Сессия истекла!',
  '( ´･_･`)  Ваш токен ушёл...  ᕕ( ᐛ )ᕗ',
  '¯\\_(ツ)_/¯  Время вышло. Зайдите снова.',
  '(｡•́︿•̀｡)  Сессия спит...  zZz',
  'ヽ(ｏ｀皿´ｏ)ﾉ  Токен протух!',
];

const SESSION_EXPIRED_FUNNY_EN = [
  '(╯°□°)╯︵ ┻━┻  Session expired!',
  '( ´･_･`)  Your token ran away...  ᕕ( ᐛ )ᕗ',
  "¯\\_(ツ)_/¯  Time's up. Log in again.",
  '(｡•́︿•̀｡)  Session is sleeping...  zZz',
  'ヽ(ｏ｀皿´ｏ)ﾉ  Token expired!',
];

export function SessionExpiredScreen({ onLogout }: { onLogout?: () => void }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? SESSION_EXPIRED_FUNNY_RU : SESSION_EXPIRED_FUNNY_EN;
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 space-y-6 px-4">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-amber-500/10 flex items-center justify-center">
          <Clock className="w-12 h-12 text-amber-400" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-amber-400">
          {lang === 'ru' ? 'Сессия истекла' : 'Session Expired'}
        </h1>
        <p className="text-sm text-gray-500">
          {lang === 'ru'
            ? 'Ваш токен авторизации больше не действителен. Зайдите снова.'
            : 'Your authorization token is no longer valid. Please log in again.'}
        </p>
      </div>

      <div className="max-w-md p-3 rounded-lg bg-muted/20 border border-border/30">
        <pre className="text-xs font-mono text-amber-400/80 whitespace-pre-wrap text-center">
          {messages[msgIdx]}
        </pre>
      </div>

      <Button
        size="sm"
        className="bg-amber-600 hover:bg-amber-700 text-white"
        onClick={onLogout}
      >
        <LogOut className="w-4 h-4 mr-1" />
        {lang === 'ru' ? 'Выйти и войти заново' : 'Logout & Login Again'}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Account Disabled Screen — shown when the user's own account was disabled
// (e.g. by another admin) and the API returns 401/403 with "is disabled".
// Distinguished from SessionExpiredScreen so the user understands they
// haven't just timed out — they've been administratively deactivated.
//
// Uses rotating funny kaomoji messages like the BannedScreen, so the user
// gets a clear visual cue: "you've been switched off, not just timed out".
// ═══════════════════════════════════════════════════════════════════════════

interface DisabledInfo {
  message: string;
  timestamp: string;
}

const DISABLED_FUNNY_RU = [
  'ОЙ (ˉ﹃ˉ) походу запретили',
  '༼ つ ◕_◕ ༽つ сам поливается WEBADC   ¯\\_(ツ)_/¯',
  '(；⌣̀_⌣́)  Кто-то нажал красную кнопку...',
  '¯\\_(⊙_⊙)_/¯  Ключ отобрали. Молча.',
  '( ╥ω╥ )  Меня выключили из розетки',
  '( •̀ - •́ )  Администратор сказал «низя»',
  '(＃￣ω￣)  Ваш токен отправился в отпуск',
  '╮(╯▽╰)╭  Это не баг, это фича отключения',
];

const DISABLED_FUNNY_EN = [
  'OOPS (ˉ﹃ˉ) looks like you got cut off',
  '༼ つ ◕_◕ ༽つ WEBADC pouring itself   ¯\\_(ツ)_/¯',
  '(；⌣̀_⌣́)  Someone pressed the red button...',
  '¯\\_(⊙_⊙)_/¯  Key was taken away. Silently.',
  '( ╥ω╥ )  I was unplugged from the wall',
  '( •̀ - •́ )  Admin said "nope"',
  '(＃￣ω￣)  Your token went on vacation',
  '╮(╯▽╰)╭  Not a bug, it\'s a disable feature',
];

export function AccountDisabledScreen({
  info,
  onLogout,
}: {
  info?: DisabledInfo | null;
  onLogout?: () => void;
}) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? DISABLED_FUNNY_RU : DISABLED_FUNNY_EN;
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 space-y-6 px-4">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-orange-500/10 flex items-center justify-center">
          <PowerOff className="w-12 h-12 text-orange-400" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-orange-500/30 border-t-orange-400 animate-spin" style={{ animationDuration: '4s' }} />
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-orange-400">
          {t('session.disabled_title', { defaultValue: lang === 'ru' ? 'ОЙ — отключили' : 'OOPS — Disabled' })}
        </h1>
        <p className="text-sm text-gray-500 max-w-md">
          {t('session.disabled_message', {
            defaultValue: lang === 'ru'
              ? 'Ваша учётная запись или API-ключ были отключены администратором. Это не истечение сессии — вас явно деактивировали. Обратитесь к администратору для восстановления доступа.'
              : 'Your account or API key has been disabled by an administrator. This is not a session timeout — you have been explicitly deactivated. Please contact an administrator to restore access.',
          })}
        </p>
      </div>

      <div className="max-w-md p-3 rounded-lg bg-muted/20 border border-border/30">
        <pre className="text-xs font-mono text-orange-400/80 whitespace-pre-wrap text-center">
          {messages[msgIdx]}
        </pre>
      </div>

      {info?.message && (
        <div className="max-w-md p-3 rounded-lg bg-orange-500/5 border border-orange-500/30">
          <div className="text-[10px] text-orange-400/60 mb-1 uppercase tracking-wider">
            {lang === 'ru' ? 'Сообщение от сервера' : 'Server message'}
          </div>
          <pre className="text-xs font-mono text-orange-400/80 whitespace-pre-wrap text-center break-all">
            {info.message}
          </pre>
        </div>
      )}

      <Button
        size="sm"
        className="bg-orange-600 hover:bg-orange-700 text-white"
        onClick={onLogout}
      >
        <LogOut className="w-4 h-4 mr-1" />
        {t('session.disabled_logout', { defaultValue: lang === 'ru' ? 'На страницу входа' : 'Back to login' })}
      </Button>
    </div>
  );
}

interface BanInfo {
  message: string;
  timestamp: string;
}

const BANNED_FUNNY_RU = [
  '(╯°□°)╯︵ ┻━┻  Вас забанили!',
  '( •̀ ω •́ )✧  Банхаммер настиг вас!',
  '¯\\_(ツ)_/¯  Кажется, вы кому-то не понравились...',
  '(｡•́︿•̀｡)  Доступ закрыт. Навсегда? Или нет...',
  'ヽ(ｏ｀皿´ｏ)ﾉ  BANNED!',
];

const BANNED_FUNNY_EN = [
  '(╯°□°)╯︵ ┻━┻  You have been banned!',
  '( •̀ ω •́ )✧  The banhammer has struck!',
  "¯\\_(ツ)_/¯  Seems someone doesn't like you...",
  '(｡•́︿•̀｡)  Access closed. Forever? Or not...',
  'ヽ(ｏ｀皿´ｏ)ﾉ  BANNED!',
];

export function BannedScreen({ banInfo, onLogout }: { banInfo: BanInfo; onLogout?: () => void }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? BANNED_FUNNY_RU : BANNED_FUNNY_EN;
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Parse ban details from the message
  // Backend message format: "User 'alice' is banned: test ban (expires: 2026-06-17T10:00:00Z)"
  // or: "Key 'abc12345' is banned: suspicious activity"
  const reason = React.useMemo(() => {
    const m = banInfo.message.match(/is banned:\s*(.+?)(?:\s*\(expires:|$)/i);
    return m ? m[1].trim() : (lang === 'ru' ? 'Причина не указана' : 'No reason specified');
  }, [banInfo.message, lang]);

  const expiresAt = React.useMemo(() => {
    const m = banInfo.message.match(/\(expires:\s*([^)]+)\)/i);
    return m ? m[1].trim() : null;
  }, [banInfo.message]);

  const targetType = React.useMemo(() => {
    if (/^user/i.test(banInfo.message)) return 'user';
    if (/^key/i.test(banInfo.message)) return 'key';
    return 'unknown';
  }, [banInfo.message]);

  const targetName = React.useMemo(() => {
    const m = banInfo.message.match(/(?:user|key)\s+['"]([^'"]+)['"]/i);
    return m ? m[1] : '';
  }, [banInfo.message]);

  const isPermanent = !expiresAt;

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 space-y-6 px-4">
      {/* Big banned icon */}
      <div className="relative">
        <div className="w-28 h-28 rounded-full bg-red-500/10 flex items-center justify-center">
          <Ban className="w-14 h-14 text-red-500" />
        </div>
        {/* Pulsing red ring */}
        <div className="absolute inset-0 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" style={{ animationDuration: '3s' }} />
      </div>

      {/* Title */}
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-bold text-red-500">
          {lang === 'ru' ? 'ВЫ ЗАБАНЕНЫ' : 'YOU ARE BANNED'}
        </h1>
        <p className="text-sm text-gray-500">
          {lang === 'ru' ? 'Доступ к системе заблокирован' : 'Access to the system is blocked'}
        </p>
      </div>

      {/* Ban details card */}
      <div className="max-w-lg w-full rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
          <ShieldX className="w-4 h-4" />
          {lang === 'ru' ? 'Детали блокировки' : 'Ban Details'}
        </div>

        {/* Target */}
        {targetName && (
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">{lang === 'ru' ? 'Цель' : 'Target'}:</span>
            <span className="font-mono text-foreground flex items-center gap-1">
              {targetType === 'user' ? <User className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />}
              {targetName}
            </span>
          </div>
        )}

        {/* Reason */}
        <div className="flex justify-between text-xs gap-2">
          <span className="text-muted-foreground flex-shrink-0">{lang === 'ru' ? 'Причина' : 'Reason'}:</span>
          <span className="text-amber-400 text-right">{reason}</span>
        </div>

        {/* Duration / Expiry */}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {lang === 'ru' ? 'Срок' : 'Duration'}:
          </span>
          {isPermanent ? (
            <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
              {lang === 'ru' ? '∞ Бессрочно' : '∞ Permanent'}
            </Badge>
          ) : (
            <span className="text-amber-400 font-mono">{formatTime(expiresAt!)}</span>
          )}
        </div>

        {/* Detected at */}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{lang === 'ru' ? 'Обнаружено' : 'Detected at'}:</span>
          <span className="text-muted-foreground/70 font-mono">{formatTime(banInfo.timestamp)}</span>
        </div>
      </div>

      {/* Funny message */}
      <div className="max-w-md p-3 rounded-lg bg-muted/20 border border-border/30">
        <pre className="text-xs font-mono text-amber-400/80 whitespace-pre-wrap text-center">
          {messages[msgIdx]}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {onLogout && (
          <Button variant="outline" size="sm" onClick={onLogout} className="border-red-500/30 text-red-400 hover:bg-red-500/10">
            <LogOut className="w-4 h-4 mr-1" />
            {lang === 'ru' ? 'Выйти' : 'Logout'}
          </Button>
        )}
      </div>

      {/* Hint */}
      <p className="text-[10px] text-gray-600 max-w-sm text-center">
        {lang === 'ru'
          ? 'Если вы считаете, что это ошибка — обратитесь к администратору системы.'
          : 'If you believe this is an error, contact your system administrator.'}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Server Down Screen — shown when the backend API is unreachable.
// Triggers:
//   - axios ERR_NETWORK / ECONNABORTED / ECONNREFUSED / ETIMEDOUT
//   - HTTP 502 / 503 / 504 (bad gateway / unavailable / gateway timeout)
//
// Uses rotating funny kaomoji "сервер спить Zzz" messages so the user
// understands it's a backend issue, not their fault.
// ═══════════════════════════════════════════════════════════════════════════

interface ServerDownInfo {
  message: string;
  code?: string;
  timestamp: string;
}

const SERVER_DOWN_FUNNY_RU = [
  'Походу (┬┬﹏┬┬) сервер спить Zzz',
  '(¬_¬ ) Что то пито ಥ_ಥ рано спить Zzz',
  '(︶︹︶) бэкенд ушёл в спячку',
  '( ˘ω˘ )睡 сервер сопит в две дырочки',
  '¯\\_(ᴗ_ᴗ)_/¯ сервер пошёл поспать',
  '(｡˘︿˘｡) API уснуло, никого не трогает',
  '(￣o￣) zZ сервер сказал «пять минуточек»',
  '(•́ – •̀;) бэкенд упал, но мы его поднимем',
];

const SERVER_DOWN_FUNNY_EN = [
  'Looks like (┬┬﹏┬⬠) the server is sleeping Zzz',
  '(¬_¬ ) Something ಥ_ಥ too early to sleep Zzz',
  "(︶︹︶) backend went into hibernation",
  '( ˘ω˘ )睡 server is snoring softly',
  '¯\\_(ᴗ_ᴗ)_/¯ server went to take a nap',
  '(｡˘︿˘｡) the API fell asleep, minding its own business',
  "(￣o￣) zZ server said 'just five more minutes'",
  '(•́ – •̀;) backend fell down, but we\'ll pick it up',
];

export function ServerDownScreen({
  info,
  onRetry,
  onLogout,
}: {
  info?: ServerDownInfo | null;
  onRetry?: () => void;
  onLogout?: () => void;
}) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';
  const messages = lang === 'ru' ? SERVER_DOWN_FUNNY_RU : SERVER_DOWN_FUNNY_EN;
  const [msgIdx, setMsgIdx] = useState(() => Math.floor(Math.random() * messages.length));
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [messages.length]);

  const handleRetry = () => {
    setRetrying(true);
    // Clear stored server-down flag so we don't auto-show the screen again
    try { localStorage.removeItem('samba-server-down'); } catch { /* ignore */ }
    onRetry?.();
    // Give the page a moment to re-probe; if still down, the interceptor
    // will re-fire the event.
    setTimeout(() => setRetrying(false), 1500);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 space-y-6 px-4">
      {/* Sleeping moon icon with Zzz particles (text-based since lucide has no Zzz icon) */}
      <div className="relative">
        <div className="w-28 h-28 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <Moon className="w-14 h-14 text-indigo-300" />
        </div>
        {/* Floating Zzz particles as styled text */}
        <span className="absolute -top-1 -right-2 text-base font-bold text-indigo-400/70 animate-pulse">Z</span>
        <span className="absolute top-3 -right-6 text-sm font-bold text-indigo-400/50 animate-pulse" style={{ animationDelay: '0.5s' }}>z</span>
        <span className="absolute -top-4 right-3 text-xs font-bold text-indigo-400/40 animate-pulse" style={{ animationDelay: '1s' }}>z</span>
      </div>

      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-indigo-300">
          {t('session.server_down_title', { defaultValue: lang === 'ru' ? 'Сервер спит' : 'Server is asleep' })}
        </h1>
        <p className="text-sm text-gray-500 max-w-md">
          {t('session.server_down_message', {
            defaultValue: lang === 'ru'
              ? 'Бэкенд-сервер не отвечает. Возможно, он перезапускается, упал, или сеть недоступна. Подождите немного и попробуйте снова.'
              : 'The backend server is not responding. It may be restarting, crashed, or the network is down. Wait a moment and try again.',
          })}
        </p>
      </div>

      {/* Rotating funny kaomoji message */}
      <div className="max-w-lg p-3 rounded-lg bg-muted/20 border border-border/30">
        <pre className="text-xs font-mono text-indigo-300/80 whitespace-pre-wrap text-center">
          {messages[msgIdx]}
        </pre>
      </div>

      {/* Server message (technical detail) */}
      {info?.message && (
        <div className="max-w-lg p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/30">
          <div className="text-[10px] text-indigo-300/60 mb-1 uppercase tracking-wider">
            {lang === 'ru' ? 'Техническая деталь' : 'Technical detail'}
            {info.code && <span className="ml-2 font-mono">[{info.code}]</span>}
          </div>
          <pre className="text-xs font-mono text-indigo-300/80 whitespace-pre-wrap text-center break-all">
            {info.message}
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
          onClick={handleRetry}
          disabled={retrying}
        >
          {retrying ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1" />
          )}
          {t('session.server_down_retry', { defaultValue: lang === 'ru' ? 'Попробовать снова' : 'Try again' })}
        </Button>
        {onLogout && (
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="w-4 h-4 mr-1" />
            {t('session.server_down_logout', { defaultValue: lang === 'ru' ? 'Выйти' : 'Logout' })}
          </Button>
        )}
      </div>

      <p className="text-[10px] text-gray-600 max-w-sm text-center">
        {lang === 'ru'
          ? 'Если сервер не поднимается долго — обратитесь к администратору.'
          : 'If the server stays down for long, contact your administrator.'}
      </p>
    </div>
  );
}
