import axios from 'axios';

// Default backend URL — relative path so the app works behind any reverse proxy
// (Caddy, nginx, etc.) without hardcoding host:port.
// The Go server / Caddy serves both the SPA and the API on the same origin,
// so '/api/v1' resolves correctly.
const DEFAULT_API_URL = '/api/v1';

// The base URL is resolved dynamically on each request via the interceptor.
const getDefaultBaseURL = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('samba-api-url');
    if (stored && stored !== 'http://127.0.0.1:8099/api/v1') return stored;
    // Migrate old hardcoded URL to relative path
    localStorage.setItem('samba-api-url', DEFAULT_API_URL);
    return DEFAULT_API_URL;
  }
  return '/api/v1';
};

const api = axios.create({
  baseURL: getDefaultBaseURL(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor: re-evaluate baseURL + attach auth headers
api.interceptors.request.use((config) => {
  // Dynamically update baseURL from localStorage (in case user changed it on login page)
  if (typeof window !== 'undefined') {
    const storedUrl = localStorage.getItem('samba-api-url');
    const baseURL = storedUrl || DEFAULT_API_URL;
    if (config.baseURL !== baseURL) {
      config.baseURL = baseURL;
    }

    // Attach auth headers
    const authMethod = localStorage.getItem('samba-auth-method');

    if (authMethod === 'jwt') {
      const token = localStorage.getItem('samba-access-token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } else if (authMethod === 'apikey') {
      const apiKey = localStorage.getItem('samba-api-key');
      if (apiKey) {
        config.headers['X-API-Key'] = apiKey;
      }
    }
  }

  return config;
});

// Response interceptor: handle 401, 403 (ban), and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // ── Helper: extract structured error info from backend response ──────
    // Backend (v2.4+) returns errors in the shape:
    //   { "detail": { "status":"error", "message":"...", "code":"ACCOUNT_DISABLED", "username":"..." } }
    // Older endpoints return { "detail": "string" } or { "message": "string" }.
    // We normalize everything into { message, code, username }.
    const extractErrInfo = (): { message: string; code?: string; username?: string } => {
      const data = error.response?.data;
      if (!data) return { message: error.message || '' };
      // New structured shape: data.detail is an object with code/message
      if (data.detail && typeof data.detail === 'object') {
        const d = data.detail as Record<string, unknown>;
        return {
          message: typeof d.message === 'string' ? d.message : '',
          code: typeof d.code === 'string' ? d.code : undefined,
          username: typeof d.username === 'string' ? d.username : undefined,
        };
      }
      // Old shape: data.detail is a string
      if (typeof data.detail === 'string') return { message: data.detail };
      // Plain { message: "..." }
      if (typeof data.message === 'string') return { message: data.message };
      return { message: error.message || '' };
    };

    // ── Network errors / server down ────────────────────────────────────
    // Detect situations where the backend is unreachable:
    //   - ERR_NETWORK          — connection refused / DNS error / CORS
    //   - ECONNABORTED         — timeout
    //   - ECONNREFUSED         — port closed (server not running)
    //   - HTTP 502/503/504     — bad gateway / service unavailable / timeout
    //   - HTTP 500-599         — server errors (may indicate crash)
    // Show the funny "сервер спить Zzz" screen instead of generic toasts.
    const isNetworkError =
      !error.response &&
      (error.code === 'ERR_NETWORK' ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        /network error/i.test(error.message || ''));

    const serverStatus = error.response?.status;
    const isServerDown =
      isNetworkError ||
      (serverStatus === 502 || serverStatus === 503 || serverStatus === 504);

    if (isServerDown) {
      // Don't fire on probe requests (auth/check, auth/me) — those are used
      // to verify auth and would trigger the screen on every page load.
      const isProbeRequest =
        originalRequest?.url?.includes('/auth/check') ||
        originalRequest?.url?.includes('/auth/me') ||
        originalRequest?.url?.includes('/auth/test') ||
        originalRequest?.url?.includes('/auth/login');
      // ALSO: if the user is already known to be disabled (samba-disabled-info
      // in localStorage), suppress server-down entirely. This handles the
      // race condition where the dashboard fires many parallel requests
      // when a key is disabled — some return 403 (correct → user-disabled),
      // but others may timeout or get 502 from endpoints that misbehave
      // when the auth context changes mid-request. Without this guard, the
      // user would briefly see "Сервер спит" instead of "ОЙ — отключили".
      const alreadyDisabled =
        typeof window !== 'undefined' &&
        !!localStorage.getItem('samba-disabled-info');
      if (!isProbeRequest && !alreadyDisabled) {
        const info = {
          message: error.message || 'Backend server is unreachable',
          code: error.code || String(serverStatus || 'NETWORK'),
          timestamp: new Date().toISOString(),
        };
        try { localStorage.setItem('samba-server-down', JSON.stringify(info)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('server-down', { detail: info }));
      }
    }

    // ── 403 Forbidden: detect disabled / banned / role-disabled ─────────
    // Backend (v2.4+) returns structured codes:
    //   ACCOUNT_DISABLED  → "Account 'su' is disabled..."
    //   KEY_DISABLED      → "This API key is deactivated..."
    //   ROLE_DISABLED     → "Role 'no' is disabled..."
    //   BANNED            → "User 'alice' is banned: ..."
    if (error.response?.status === 403) {
      const info = extractErrInfo();
      const code = info.code?.toUpperCase();
      const msg = info.message;
      if (code === 'ACCOUNT_DISABLED' || code === 'KEY_DISABLED' || code === 'ROLE_DISABLED') {
        const detail = {
          message: msg || 'Account was deactivated by an administrator',
          code,
          timestamp: new Date().toISOString(),
        };
        try { localStorage.setItem('samba-disabled-info', JSON.stringify(detail)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('user-disabled', { detail }));
      } else if (code === 'BANNED' || /is banned|забанен/i.test(msg)) {
        const banInfo = { message: msg, timestamp: new Date().toISOString() };
        try { localStorage.setItem('samba-ban-info', JSON.stringify(banInfo)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('user-banned', { detail: banInfo }));
      } else if (/is disabled|is inactive|отключ[её]н|deactivated|revoked/i.test(msg)) {
        // Fallback for older backends without the `code` field
        const detail = { message: msg, timestamp: new Date().toISOString() };
        try { localStorage.setItem('samba-disabled-info', JSON.stringify(detail)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('user-disabled', { detail }));
      }
    }

    // ── 401 Unauthorized ──
    // Rule of thumb: if the user was authenticated (any auth-method recorded
    // in localStorage) and now gets a 401, it means the account / API key
    // was deactivated by an admin. There is no "natural" expiry for API
    // keys in this system, so we ALWAYS show the funny "ОЙ — отключили"
    // screen for logged-in users. The boring "Сессия истекла" screen is
    // reserved for the rare case where auth-method is missing entirely
    // (e.g. stale tab opened after the user cleared storage).
    if (error.response?.status === 401 && !originalRequest._retry) {
      const authMethod = localStorage.getItem('samba-auth-method');
      const info = extractErrInfo();
      const code = info.code?.toUpperCase();
      const msg = info.message;
      // Skip probe/login requests — they're used to CHECK auth on login,
      // the login form itself will display the localized error.
      const isProbeRequest =
        originalRequest.url?.includes('/auth/check') ||
        originalRequest.url?.includes('/auth/me') ||
        originalRequest.url?.includes('/auth/test') ||
        originalRequest.url?.includes('/auth/login');

      // ── JWT auth: try refresh-token flow first ──
      // BUT skip refresh if backend explicitly says KEY_EXPIRED,
      // ACCOUNT_DISABLED, KEY_DISABLED, or INVALID_API_KEY — refresh
      // won't help in those cases.
      if (authMethod === 'jwt' &&
          code !== 'KEY_EXPIRED' &&
          code !== 'ACCOUNT_DISABLED' &&
          code !== 'KEY_DISABLED' &&
          code !== 'INVALID_API_KEY') {
        const refreshToken = localStorage.getItem('samba-refresh-token');
        if (refreshToken) {
          originalRequest._retry = true;
          try {
            const currentBaseURL = getDefaultBaseURL();
            const response = await axios.post(
              `${currentBaseURL}/auth/refresh`,
              { refresh_token: refreshToken }
            );
            const { access_token, refresh_token } = response.data;
            localStorage.setItem('samba-access-token', access_token);
            localStorage.setItem('samba-refresh-token', refresh_token);
            originalRequest.headers.Authorization = `Bearer ${access_token}`;
            return api(originalRequest);
          } catch {
            // Refresh failed — show disabled screen with backend's message
            const detail = {
              message: msg || 'Account was deactivated by an administrator',
              code,
              timestamp: new Date().toISOString(),
            };
            try { localStorage.setItem('samba-disabled-info', JSON.stringify(detail)); } catch { /* ignore */ }
            if (!isProbeRequest) {
              window.dispatchEvent(new CustomEvent('user-disabled', { detail }));
            }
            return Promise.reject(error);
          }
        }
        // JWT but no refresh token — assume disabled
      }

      // ── KEY_EXPIRED / ACCOUNT_DISABLED / KEY_DISABLED / generic 401 ──
      // For an already-authenticated user, ANY 401 means the key/account
      // was deactivated. Show the funny "ОЙ — отключили" screen.
      if (authMethod === 'apikey' || authMethod === 'jwt' || authMethod === 'local') {
        const detail = {
          message: msg ||
            (authMethod === 'apikey'
              ? 'API key was deactivated or revoked by an administrator'
              : 'Account was deactivated by an administrator'),
          code,
          timestamp: new Date().toISOString(),
        };
        try { localStorage.setItem('samba-disabled-info', JSON.stringify(detail)); } catch { /* ignore */ }
        if (!isProbeRequest) {
          window.dispatchEvent(new CustomEvent('user-disabled', { detail }));
        }
        return Promise.reject(error);
      }

      // ── No auth method recorded → genuine "session expired" ──
      // (e.g. tab open from yesterday, storage cleared, etc.)
      if (!isProbeRequest) {
        window.dispatchEvent(new CustomEvent('session-expired'));
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Safely extract a string error message from any API error.
 * Handles: FastAPI validation errors ({detail: [{type, loc, msg, input}]}),
 * plain error objects ({message, detail}), string errors, and JS Error instances.
 * This prevents "Objects are not valid as a React child" errors in toast notifications.
 */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err === null || err === undefined) return fallback;
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    // ── Suppress noisy 401/403 axios messages for logged-in users ──
    // When a logged-in user (apikey/jwt) gets a 401 or 403 from a disabled
    // account / key, we already dispatch `user-disabled` and show the funny
    // orange "ОЙ — отключили" screen. The leftover axios message would just
    // confuse the user with a duplicate toast. Return empty so
    // safeToastMessage falls back to the localized "Failed to load X" string.
    if (typeof window !== 'undefined') {
      const authMethod = localStorage.getItem('samba-auth-method');
      if (authMethod && /status code (401|403)/i.test(err.message)) {
        return '';
      }
    }
    return err.message || fallback;
  }

  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;

    // Same 401/403-suppression for axios-shaped errors
    if (typeof window !== 'undefined') {
      const authMethod = localStorage.getItem('samba-auth-method');
      const status = (obj.response as { status?: number } | undefined)?.status;
      if (authMethod && (status === 401 || status === 403)) {
        // If backend returned a structured ACCOUNT_DISABLED / KEY_DISABLED /
        // KEY_EXPIRED / ROLE_DISABLED error, suppress the toast entirely
        // — the disabled screen will show the message.
        const data = (obj.response as { data?: { detail?: { code?: string } } } | undefined)?.data;
        const code = data?.detail?.code;
        if (code && /ACCOUNT_DISABLED|KEY_DISABLED|KEY_EXPIRED|ROLE_DISABLED|BANNED|INVALID_API_KEY/.test(code)) {
          return '';
        }
      }
    }

    // Axios error: err.response.data.detail or err.response.data.message
    if (obj.response && typeof obj.response === 'object') {
      const resp = obj.response as Record<string, unknown>;
      const data = resp.data;
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        // FastAPI validation errors: {detail: [{type, loc, msg, input}, ...]}
        if (Array.isArray(d.detail)) {
          return d.detail
            .map((item: unknown) => {
              if (typeof item === 'string') return item;
              if (item && typeof item === 'object') {
                const v = item as Record<string, unknown>;
                // Format: field path + message
                const loc = Array.isArray(v.loc) ? v.loc.join('.') : '';
                const msg = v.msg ? String(v.msg) : '';
                return loc ? `${loc}: ${msg}` : msg;
              }
              return String(item);
            })
            .filter(Boolean)
            .join('; ');
        }
        if (typeof d.detail === 'string') return d.detail;
        if (typeof d.message === 'string') return d.message;
      }
      if (typeof data === 'string') return data;
    }

    // Direct error objects
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.detail === 'string') return obj.detail;
    if (Array.isArray(obj.detail)) {
      return obj.detail
        .map((item: unknown) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const v = item as Record<string, unknown>;
            const loc = Array.isArray(v.loc) ? v.loc.join('.') : '';
            const msg = v.msg ? String(v.msg) : '';
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(item);
        })
        .filter(Boolean)
        .join('; ');
    }
  }

  return fallback;
}

export default api;
