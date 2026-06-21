'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import api from '@/lib/api';
import { Shield, Key, Loader2, Server, AlertTriangle } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { safeToastMessage } from '@/lib/parsers';

export default function LoginPage() {
  const { t } = useTranslation();
  const { setJWTAuth, setApiKeyAuth } = useAuthStore();
  const [activeTab, setActiveTab] = useState('password');
  const [isLoading, setIsLoading] = useState(false);
  const [apiUrl, setApiUrl] = useState(
    typeof window !== 'undefined' ? (localStorage.getItem('samba-api-url') || '/api/v1') : ''
  );

  // Password login form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // API Key login form
  const [apiKey, setApiKey] = useState('');

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoading(true);

    try {
      const response = await api.post('/auth/login', { username, password });
      const { access_token, refresh_token } = response.data;

      // Stash the token temporarily so subsequent /auth/test call attaches
      // it automatically via the request interceptor.
      localStorage.setItem('samba-auth-method', 'jwt');
      localStorage.setItem('samba-access-token', access_token);
      localStorage.setItem('samba-refresh-token', refresh_token);

      // Use the new /auth/test endpoint to verify the JWT and get the
      // user's role + permissions in one roundtrip.
      let role = response.data.role || 'viewer';
      let permissions = response.data.permissions || [];

      try {
        const testResponse = await api.get('/auth/test');
        const testData = testResponse.data || {};
        if (testData.valid === false) {
          // The login succeeded but the account got disabled mid-flight
          // (rare) or the JWT is somehow invalid. Show the disabled screen.
          const code = (testData.code || '').toUpperCase();
          const message = testData.message || 'Account is not active';
          if (code === 'ACCOUNT_DISABLED' || code === 'ROLE_DISABLED' || code === 'INVALID_JWT') {
            const info = { message, code, timestamp: new Date().toISOString() };
            try { localStorage.setItem('samba-disabled-info', JSON.stringify(info)); } catch { /* ignore */ }
            window.dispatchEvent(new CustomEvent('user-disabled', { detail: info }));
            return;
          }
        } else if (testData.valid === true) {
          role = testData.role || role;
          permissions = testData.permissions || permissions;
          // Capture user_id from /auth/test so chat can identify "own" messages
          if (testData.user_id) {
            (response.data as Record<string, unknown>)._user_id = testData.user_id;
          }
        }
      } catch {
        // /auth/test failed — try /auth/me as fallback
        try {
          const meResponse = await api.get('/auth/me');
          role = meResponse.data.role || role;
          permissions = meResponse.data.permissions || permissions;
        } catch {
          // Use whatever we got from login
        }
      }

      const testDataUserId = (response.data as Record<string, unknown>)._user_id as number | undefined;
      const user = {
        id: testDataUserId ?? undefined,
        username,
        role,
        permissions,
      };
      setJWTAuth(user, access_token, refresh_token);
      toast.success(`${t('common.success')}! Role: ${role}`);
    } catch (err: unknown) {
      // Backend v2.4+ returns errors in { detail: { message, code, username } }
      // Older backends: { detail: "string" } or { message: "string" }
      const error = err as {
        response?: { data?: { detail?: { message?: string; code?: string; username?: string } | string; message?: string } };
        message?: string;
      };
      const detail = error.response?.data?.detail;
      const detailObj = typeof detail === 'object' ? detail : null;
      const detailMsg = detailObj?.message || (typeof detail === 'string' ? detail : '');
      const code = detailObj?.code?.toUpperCase();
      const backendMsg = detailMsg || error.response?.data?.message || error?.message;

      // Clean up any temp credentials we set above (login failed)
      localStorage.removeItem('samba-access-token');
      localStorage.removeItem('samba-refresh-token');
      localStorage.removeItem('samba-auth-method');

      // If the backend explicitly says the account is disabled, fire
      // `user-disabled` so the "ОЙ — отключили" screen shows.
      if (code === 'ACCOUNT_DISABLED' || code === 'KEY_DISABLED' || code === 'ROLE_DISABLED') {
        const info = {
          message: backendMsg || 'Account was deactivated by an administrator',
          code,
          timestamp: new Date().toISOString(),
        };
        try { localStorage.setItem('samba-disabled-info', JSON.stringify(info)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('user-disabled', { detail: info }));
        return;
      }

      toast.error(safeToastMessage(backendMsg, t('auth.invalidCredentials')));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApiKeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) return;
    setIsLoading(true);

    try {
      // Use the new /auth/test endpoint (v2.4+) to validate the key and
      // get the user's role + permissions in a single roundtrip.
      // The interceptor attaches X-API-Key automatically for apikey auth,
      // but here we haven't set it yet — pass it explicitly.
      const response = await api.get('/auth/test', {
        headers: { 'X-API-Key': apiKey },
      });

      const data = response.data || {};
      // /auth/test returns { valid, auth_method, message, code?, username, role, permissions, ... }
      if (data.valid === false) {
        // Key is invalid / disabled / expired / role-disabled.
        // /auth/test returns 200 even for invalid keys, with valid:false
        // and a code field — so we handle it here directly.
        const code = (data.code || '').toUpperCase();
        const message = data.message || 'API key is invalid';
        if (code === 'ACCOUNT_DISABLED' || code === 'KEY_DISABLED' || code === 'ROLE_DISABLED' || code === 'KEY_EXPIRED') {
          const info = {
            message,
            code,
            timestamp: new Date().toISOString(),
          };
          try { localStorage.setItem('samba-disabled-info', JSON.stringify(info)); } catch { /* ignore */ }
          window.dispatchEvent(new CustomEvent('user-disabled', { detail: info }));
          return;
        }
        // INVALID_API_KEY, AUTH_REQUIRED, INVALID_JWT — generic login error
        toast.error(safeToastMessage(message, t('auth.invalidCredentials')));
        return;
      }

      // valid === true → extract user info (including user_id from /auth/test)
      const user = {
        id: data.user_id ?? undefined,
        username: data.username || 'api-user',
        role: data.role || 'viewer',
        permissions: data.permissions || [],
      };

      setApiKeyAuth(apiKey, user);
      toast.success(`${t('common.success')}! Role: ${user.role}`);
    } catch (err: unknown) {
      // Fallback: if /auth/test returned a non-200 status (shouldn't happen
      // with the new endpoint, but just in case), parse the error.
      const error = err as {
        response?: { data?: { detail?: { message?: string; code?: string; username?: string } | string; message?: string; valid?: boolean; code?: string } };
        message?: string;
      };
      const respData = error.response?.data;
      // /auth/test might return { valid:false, code, message } directly in data
      // OR wrapped in { detail: { ... } }
      const directValid = respData?.valid;
      const directCode = (respData?.code || '').toUpperCase();
      const detail = respData?.detail;
      const detailObj = typeof detail === 'object' ? detail : null;
      const code = directCode || (detailObj?.code || '').toUpperCase();
      const message =
        (typeof respData?.message === 'string' ? respData.message : '') ||
        detailObj?.message ||
        (typeof detail === 'string' ? detail : '') ||
        error?.message ||
        '';

      if (directValid === false || code === 'ACCOUNT_DISABLED' || code === 'KEY_DISABLED' || code === 'ROLE_DISABLED' || code === 'KEY_EXPIRED') {
        const info = {
          message: message || 'Account was deactivated by an administrator',
          code,
          timestamp: new Date().toISOString(),
        };
        try { localStorage.setItem('samba-disabled-info', JSON.stringify(info)); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('user-disabled', { detail: info }));
        return;
      }

      localStorage.removeItem('samba-api-key');
      localStorage.removeItem('samba-auth-method');
      toast.error(safeToastMessage(message, t('auth.invalidCredentials')));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-3 md:p-4">
      {/* Subtle animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md max-w-[95vw]">
        {/* Logo and Title */}
        <div className="text-center mb-6 md:mb-8">
          <div className="inline-flex items-center justify-center mb-3 md:mb-4">
            <Image src="/logo.svg" alt="Samba AD Panel" width={48} height={48} className="rounded-2xl md:w-14 md:h-14" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Samba AD Panel</h1>
          <p className="text-xs md:text-sm text-gray-400 mt-1">Управление Active Directory</p>
        </div>

        {/* Alpha notice — auto-shown, reads from .env */}
        {process.env.NEXT_PUBLIC_ALPHA_BADGE && (
          <div className="mb-3 md:mb-4 bg-amber-950/60 backdrop-blur border border-amber-700/50 rounded-xl p-2.5 md:p-3 flex items-start gap-2 md:gap-3">
            <Badge
              variant="outline"
              className="bg-amber-600/20 border-amber-500/60 text-amber-400 shrink-0 mt-0.5 text-[10px] tracking-widest font-bold px-2 py-0.5"
            >
              {process.env.NEXT_PUBLIC_ALPHA_BADGE}
            </Badge>
            <div className="min-w-0 flex-1">
              {process.env.NEXT_PUBLIC_ALPHA_TITLE && (
                <p className="text-amber-300 text-xs md:text-sm font-semibold leading-snug">
                  {process.env.NEXT_PUBLIC_ALPHA_TITLE}
                </p>
              )}
              {process.env.NEXT_PUBLIC_ALPHA_DESCRIPTION && (
                <p className="text-amber-400/80 text-[11px] md:text-xs leading-relaxed mt-0.5">
                  {process.env.NEXT_PUBLIC_ALPHA_DESCRIPTION}
                </p>
              )}
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          </div>
        )}

        {/* Login Card */}
        <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl p-4 md:p-6 shadow-2xl">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 bg-gray-800/50 mb-4 md:mb-6 h-10 md:h-11">
              <TabsTrigger value="password" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs md:text-sm">
                <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" />
                <span className="truncate">{t('auth.loginByPassword')}</span>
              </TabsTrigger>
              <TabsTrigger value="apikey" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs md:text-sm">
                <Key className="w-3.5 h-3.5 md:w-4 md:h-4 mr-1.5 md:mr-2" />
                <span className="truncate">{t('auth.loginByApiKey')}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="password">
              <form onSubmit={handlePasswordLogin} className="space-y-3 md:space-y-4">
                <div className="space-y-1.5 md:space-y-2">
                  <Label htmlFor="username" className="text-gray-300 text-xs md:text-sm">{t('auth.username')}</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 h-9 md:h-10 text-sm"
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-1.5 md:space-y-2">
                  <Label htmlFor="password" className="text-gray-300 text-xs md:text-sm">{t('auth.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 h-9 md:h-10 text-sm"
                    autoComplete="current-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || !username || !password}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-9 md:h-10 text-sm"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {t('auth.enter')}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="apikey">
              <form onSubmit={handleApiKeyLogin} className="space-y-3 md:space-y-4">
                <div className="space-y-1.5 md:space-y-2">
                  <Label htmlFor="apikey" className="text-gray-300 text-xs md:text-sm">{t('auth.apiKey')}</Label>
                  <Input
                    id="apikey"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-xxxxxxxxxxxx"
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 font-mono h-9 md:h-10 text-sm"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || !apiKey}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-9 md:h-10 text-sm"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {t('auth.enter')}
                </Button>
              </form>
            </TabsContent>

          </Tabs>

          {/* API URL config */}
          <div className="mt-4 md:mt-6 pt-3 md:pt-4 border-t border-gray-800">
            <div className="space-y-1.5 md:space-y-2">
              <Label className="text-xs text-gray-500 flex items-center gap-1">
                <Server className="w-3 h-3" />
                API Server URL (optional)
              </Label>
              <Input
                value={apiUrl}
                onChange={(e) => {
                  setApiUrl(e.target.value);
                  localStorage.setItem('samba-api-url', e.target.value || '/api/v1');
                }}
                placeholder="/api/v1"
                className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 text-xs font-mono h-8"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
