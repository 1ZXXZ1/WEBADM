'use client';

import React, { useState } from 'react';
import '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import api from '@/lib/api';
import LoginPage from '@/components/auth/LoginPage';
import MainLayout, { type PageId } from '@/components/layout/MainLayout';
import DashboardPage from '@/components/dashboard/DashboardPage';
import UsersPage from '@/components/users/UsersPage';
import GroupsPage from '@/components/groups/GroupsPage';
import ComputersPage from '@/components/computers/ComputersPage';
import ContactsPage from '@/components/contacts/ContactsPage';
import OUsPage from '@/components/ous/OUsPage';
import GPOPage from '@/components/gpo/GPOPage';
import DomainPage from '@/components/domain/DomainPage';
import ManagementPage from '@/components/management/ManagementPage';
import DNSPage from '@/components/dns/DNSPage';
import ShellTerminal from '@/components/shell/ShellTerminal';
import ShellProjectsPage from '@/components/shell/ShellProjectsPage';
import ETLBuilder from '@/components/etl/ETLBuilder';
import DataForgePage from '@/components/dataforge/DataForgePage';
import AuditPage from '@/components/audit/AuditPage';
import ChatPage from '@/components/chat/ChatPage';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import { AnimatedLoadingScreen, PermissionDeniedScreen, BannedScreen, SessionExpiredScreen, AccountDisabledScreen, ServerDownScreen } from '@/components/shared/Screens';

function useMounted() {
  const [mounted, setMounted] = useState(false);
  React.useEffect(() => {
    const savedTheme = localStorage.getItem('samba-theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
    setMounted(true);
  }, []);
  return mounted;
}

export default function Home() {
  const { isAuthenticated, hasPermission, logout } = useAuthStore();
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const mounted = useMounted();
  const [banInfo, setBanInfo] = useState<{ message: string; timestamp: string } | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [disabledInfo, setDisabledInfo] = useState<{ message: string; timestamp: string } | null>(null);
  const [serverDownInfo, setServerDownInfo] = useState<{ message: string; code?: string; timestamp: string } | null>(null);

  // Listen for session expired events (from axios 401 interceptor)
  React.useEffect(() => {
    const handler = () => {
      setSessionExpired(true);
    };
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, []);

  // Listen for "user disabled" events (from axios 401/403 interceptor when
  // the backend says the account is disabled, not just expired).
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; timestamp: string }>).detail;
      setDisabledInfo(detail || { message: '', timestamp: new Date().toISOString() });
      // Clear any server-down state — the disabled screen takes priority
      // and we don't want a stale "Сервер спит" to override it.
      try { localStorage.removeItem('samba-server-down'); } catch { /* ignore */ }
      setServerDownInfo(null);
    };
    window.addEventListener('user-disabled', handler as EventListener);
    return () => window.removeEventListener('user-disabled', handler as EventListener);
  }, []);

  // Listen for "server down" events (network errors, 502/503/504).
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; code?: string; timestamp: string }>).detail;
      setServerDownInfo(detail || { message: 'Server unreachable', timestamp: new Date().toISOString() });
    };
    window.addEventListener('server-down', handler as EventListener);
    return () => window.removeEventListener('server-down', handler as EventListener);
  }, []);

  // Check for stored disabled info on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('samba-disabled-info');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.message) {
          setDisabledInfo(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Check for stored server-down info on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('samba-server-down');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.message) {
          setServerDownInfo(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Mount-time auth probe ────────────────────────────────────────────
  // When the page loads and the user appears authenticated (auth-method in
  // localStorage), explicitly probe /auth/test to verify the credentials
  // still work. This is a SAFETY NET — if the key was disabled between
  // sessions, the probe will return { valid:false, code:"KEY_DISABLED" }
  // and we can fire `user-disabled` → AccountDisabledScreen shows immediately,
  // instead of the user seeing a blank dashboard (because DashboardPage
  // silently swallows the 403 in its own catch block).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const authMethod = localStorage.getItem('samba-auth-method');
    if (authMethod !== 'apikey' && authMethod !== 'jwt') return;
    // Don't probe if we already know we're disabled or server is down
    if (localStorage.getItem('samba-disabled-info')) return;
    if (localStorage.getItem('samba-server-down')) return;

    let cancelled = false;
    const probe = async () => {
      try {
        const res = await api.get('/auth/test');
        if (cancelled) return;
        const data = res.data || {};
        // /auth/test returns { valid: false, code, message } for invalid keys
        // (HTTP 200, so the response interceptor doesn't fire). Handle here.
        if (data.valid === false) {
          const code = (data.code || '').toUpperCase();
          const message = data.message || 'Credentials are no longer valid';
          if (code === 'ACCOUNT_DISABLED' || code === 'KEY_DISABLED' ||
              code === 'ROLE_DISABLED' || code === 'KEY_EXPIRED') {
            const info = { message, code, timestamp: new Date().toISOString() };
            try { localStorage.setItem('samba-disabled-info', JSON.stringify(info)); } catch { /* ignore */ }
            try { localStorage.removeItem('samba-server-down'); } catch { /* ignore */ }
            window.dispatchEvent(new CustomEvent('user-disabled', { detail: info }));
          } else if (code === 'INVALID_API_KEY' || code === 'INVALID_JWT' || code === 'AUTH_REQUIRED') {
            // Truly invalid / expired — fall back to session-expired
            window.dispatchEvent(new CustomEvent('session-expired'));
          }
        }
        // valid === true → credentials OK, nothing to do
      } catch {
        // The interceptor already handled it (fired user-disabled,
        // server-down, or session-expired). We just need to bail.
      }
      void cancelled;
    };
    probe();
    return () => { cancelled = true; };
  }, []);

  // Check for stored ban info on mount (from previous 403 response)
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('samba-ban-info');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.message) {
          setBanInfo(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Listen for real-time ban events (from axios 403 interceptor)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; timestamp: string }>).detail;
      if (detail?.message) {
        setBanInfo(detail);
      }
    };
    window.addEventListener('user-banned', handler as EventListener);
    return () => window.removeEventListener('user-banned', handler as EventListener);
  }, []);

  // Clear ban info on logout
  const handleLogout = React.useCallback(() => {
    try { localStorage.removeItem('samba-ban-info'); } catch { /* ignore */ }
    try { localStorage.removeItem('samba-disabled-info'); } catch { /* ignore */ }
    try { localStorage.removeItem('samba-server-down'); } catch { /* ignore */ }
    setBanInfo(null);
    setDisabledInfo(null);
    setServerDownInfo(null);
    setSessionExpired(false);
    logout();
  }, [logout]);

  // Retry from ServerDownScreen — clears the flag and reloads the page
  const handleServerRetry = React.useCallback(() => {
    try { localStorage.removeItem('samba-server-down'); } catch { /* ignore */ }
    setServerDownInfo(null);
    // Hard reload to re-probe all endpoints cleanly
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  // Permission map: page → required permission
  const PAGE_PERMISSIONS: Partial<Record<PageId, string>> = {
    dashboard: 'dashboard.full',
    users: 'user.list',
    groups: 'group.list',
    computers: 'computer.list',
    contacts: 'contact.list',
    ou: 'ou.list',
    dns: 'dns.zonelist',
    gpo: 'gpo.list',
    domain: 'domain.info',
    shell: 'shell.execute',
    'shell-projects': 'shell.execute',
    tasks: 'batch.execute',
    dataforge: 'sdb.info',
    audit: 'mgmt.audit.view',
    chat: 'chat.rooms.list',
    management: 'mgmt.users.list',
  };

  // Check if current page is permitted; if not, show permission denied screen
  React.useEffect(() => {
    const requiredPerm = PAGE_PERMISSIONS[currentPage];
    if (requiredPerm && !hasPermission(requiredPerm)) {
      // Don't auto-redirect — show permission denied screen instead
      // (more transparent than silently redirecting to dashboard)
    }
  }, [currentPage, hasPermission]);

  // Listen for cross-component navigation requests (e.g. AI Chat → DataForge)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ page: string }>).detail;
      if (!detail || !detail.page) return;
      // Validate page id
      const validPages: PageId[] = ['dashboard', 'users', 'groups', 'computers', 'contacts', 'ou',
        'dns', 'gpo', 'domain', 'shell', 'shell-projects', 'tasks', 'dataforge', 'audit', 'management'];
      if (validPages.includes(detail.page as PageId)) {
        // Check permission before navigating
        const requiredPerm = PAGE_PERMISSIONS[detail.page as PageId];
        if (!requiredPerm || hasPermission(requiredPerm)) {
          setCurrentPage(detail.page as PageId);
        }
      }
    };
    window.addEventListener('navigate-to-page', handler as EventListener);
    return () => window.removeEventListener('navigate-to-page', handler as EventListener);
  }, [hasPermission]);

  if (!mounted) {
    return <AnimatedLoadingScreen />;
  }

  // Account disabled (by admin) — HIGHEST priority.
  // Why higher than server-down? When a key is disabled, the dashboard fires
  // many parallel requests. Some return 403 with KEY_DISABLED (correct),
  // but others may hit endpoints that misbehave (502, timeout, CORS) — those
  // would otherwise trigger "Сервер спит" and hide the real cause. The
  // disabled screen is more specific and actionable, so it wins.
  if (disabledInfo) {
    return <AccountDisabledScreen info={disabledInfo} onLogout={handleLogout} />;
  }

  // Server down — second priority. If the backend is unreachable (and the
  // user is NOT disabled), show the funny "сервер спить Zzz" screen.
  if (serverDownInfo) {
    return <ServerDownScreen info={serverDownInfo} onRetry={handleServerRetry} onLogout={handleLogout} />;
  }

  // Session expired — only for users with NO recorded auth-method (e.g.
  // stale tab from yesterday, cleared storage). Real logged-in users
  // always go through the disabled screen above.
  if (sessionExpired) {
    return <SessionExpiredScreen onLogout={() => {
      setSessionExpired(false);
      handleLogout();
    }} />;
  }

  // If user is banned, show BannedScreen (takes priority over everything)
  if (banInfo && isAuthenticated) {
    return <BannedScreen banInfo={banInfo} onLogout={handleLogout} />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Check permission for current page
  const requiredPerm = PAGE_PERMISSIONS[currentPage];
  if (requiredPerm && !hasPermission(requiredPerm)) {
    return (
      <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
        <PermissionDeniedScreen
          pageName={currentPage}
          requiredPermission={requiredPerm}
        />
      </MainLayout>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'users':
        return <UsersPage />;
      case 'groups':
        return <GroupsPage />;
      case 'computers':
        return <ComputersPage />;
      case 'contacts':
        return <ContactsPage />;
      case 'ou':
        return <OUsPage />;
      case 'dns':
        return <DNSPage />;
      case 'gpo':
        return <GPOPage />;
      case 'domain':
        return <DomainPage />;
      case 'shell':
        return <ShellTerminal />;
      case 'shell-projects':
        return <ShellProjectsPage />;
      case 'tasks':
        return <ETLBuilder />;
      case 'dataforge':
        return <DataForgePage />;
      case 'audit':
        return <AuditPage />;
      case 'chat':
        return <ChatPage />;
      case 'management':
        return <ManagementPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      <div key={currentPage}>{renderPage()}</div>
    </MainLayout>
  );
}
