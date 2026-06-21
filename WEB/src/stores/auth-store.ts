import { create } from 'zustand';
import type { User } from '@/types';

interface AuthStore {
  isAuthenticated: boolean;
  isLocalMode: boolean;
  user: User | null;
  authMethod: 'jwt' | 'apikey' | 'local' | null;
  accessToken: string | null;
  refreshToken: string | null;
  apiKey: string | null;

  setJWTAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setApiKeyAuth: (apiKey: string, user?: User) => void;
  setLocalAuth: () => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('samba-auth-method') : false,
  isLocalMode: typeof window !== 'undefined' ? localStorage.getItem('samba-auth-method') === 'local' : false,
  user: typeof window !== 'undefined' ? (() => {
    try {
      const u = localStorage.getItem('samba-user');
      return u ? JSON.parse(u) : null;
    } catch { return null; }
  })() : null,
  authMethod: typeof window !== 'undefined'
    ? (localStorage.getItem('samba-auth-method') as 'jwt' | 'apikey' | null)
    : null,
  accessToken: typeof window !== 'undefined' ? localStorage.getItem('samba-access-token') : null,
  refreshToken: typeof window !== 'undefined' ? localStorage.getItem('samba-refresh-token') : null,
  apiKey: typeof window !== 'undefined' ? localStorage.getItem('samba-api-key') : null,

  setJWTAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('samba-auth-method', 'jwt');
    localStorage.setItem('samba-access-token', accessToken);
    localStorage.setItem('samba-refresh-token', refreshToken);
    localStorage.setItem('samba-user', JSON.stringify(user));
    set({
      isAuthenticated: true,
      user,
      authMethod: 'jwt',
      accessToken,
      refreshToken,
    });
  },

  setApiKeyAuth: (apiKey, user) => {
    localStorage.setItem('samba-auth-method', 'apikey');
    localStorage.setItem('samba-api-key', apiKey);
    if (user) {
      localStorage.setItem('samba-user', JSON.stringify(user));
    }
    set({
      isAuthenticated: true,
      isLocalMode: false,
      user: user || null,
      authMethod: 'apikey',
      apiKey,
    });
  },

  setLocalAuth: () => {
    const localUser: User = {
      username: 'admin',
      role: 'admin',
      permissions: [
        'dashboard.full',
        'user.list', 'user.create', 'user.edit', 'user.delete',
        'group.list', 'group.create', 'group.edit', 'group.delete',
        'computer.list', 'computer.create', 'computer.edit', 'computer.delete',
        'contact.list', 'contact.create', 'contact.edit', 'contact.delete',
        'ou.list', 'ou.create', 'ou.edit', 'ou.delete',
        'dns.zonelist', 'dns.zonecreate', 'dns.zoneedit', 'dns.zonedelete',
        'gpo.list', 'gpo.create', 'gpo.edit', 'gpo.delete',
        'domain.info', 'domain.edit',
        'shell.execute',
        'batch.execute',
        // SDB permissions (DataForge / Данные SDB)
        'sdb.info', 'sdb.full', 'sdb.select', 'sdb.script', 'sdb.query',
        'sdb.show', 'sdb.databases', 'sdb.synthesis', 'sdb.export',
        // CFG permissions (Управление → ENV)
        'cfg.list', 'cfg.show', 'cfg.schema', 'cfg.raw', 'cfg.update',
        'cfg.bulk', 'cfg.delete', 'cfg.disable', 'cfg.enable', 'cfg.reload', 'cfg.persist',
        // BAN permissions (Управление → Блокировка)
        'ban.create', 'ban.unban', 'ban.list', 'ban.show', 'ban.delete',
        'mgmt.audit.view', 'mgmt.users.list', 'mgmt.users.create', 'mgmt.users.edit', 'mgmt.users.delete',
        // Chat permissions (Чат — all authenticated users can chat)
        'chat.rooms.list', 'chat.rooms.create', 'chat.rooms.read', 'chat.rooms.update', 'chat.rooms.delete',
        'chat.members.list', 'chat.members.add', 'chat.members.remove',
        'chat.messages.list', 'chat.messages.send', 'chat.messages.edit', 'chat.messages.delete',
        'chat.files.upload', 'chat.files.download', 'chat.voice.upload',
        'chat.search',
      ],
    };
    localStorage.setItem('samba-auth-method', 'local');
    localStorage.setItem('samba-user', JSON.stringify(localUser));
    set({
      isAuthenticated: true,
      isLocalMode: true,
      user: localUser,
      authMethod: 'local',
      accessToken: null,
      refreshToken: null,
      apiKey: null,
    });
  },

  logout: () => {
    localStorage.removeItem('samba-auth-method');
    localStorage.removeItem('samba-access-token');
    localStorage.removeItem('samba-refresh-token');
    localStorage.removeItem('samba-api-key');
    localStorage.removeItem('samba-user');
    set({
      isAuthenticated: false,
      isLocalMode: false,
      user: null,
      authMethod: null,
      accessToken: null,
      refreshToken: null,
      apiKey: null,
    });
  },

  hasPermission: (permission: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!user.permissions) return false;
    // Exact match
    if (user.permissions.includes(permission)) return true;
    // Wildcard match: if user has 'sdb.*' and we check 'sdb.info' → true
    const parts = permission.split('.');
    if (parts.length >= 2) {
      const wildcard = `${parts[0]}.*`;
      if (user.permissions.includes(wildcard)) return true;
    }
    return false;
  },

  isAdmin: () => {
    const { user } = get();
    return user?.role === 'admin';
  },
}));
