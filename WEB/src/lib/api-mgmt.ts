/**
 * Management API client — typed wrappers for /api/v1/mgmt/* endpoints.
 *
 * All methods return the parsed `data` field from the standard
 * { status: "ok", data: ... } envelope, and throw an Error with a useful
 * message on failure (so callers can `toast.error(getErrorMessage(err))`).
 */
import api, { getErrorMessage } from './api';

// ── Types ────────────────────────────────────────────────────────────────
export interface MgmtUser {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  role: string;
  is_active: number | boolean;
  weight: number;
  last_login_at: string | null;
  login_count: number;
  created_at: string;
  updated_at: string;
}

export interface MgmtApiKey {
  id: number;
  key_prefix: string;
  user_id: number;
  name: string;
  description?: string;
  role: string;
  is_active: number | boolean;
  weight: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface MgmtRole {
  name: string;
  description?: string;
  permissions: string[];
  is_builtin: boolean;
  is_active: number | boolean;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface MgmtStats {
  users: { total: number; active: number };
  api_keys: { total: number; active: number; soon_to_expire_7d: number };
  roles: { total: number; active: number };
  audit_log: { total: number };
  auth: { failed_logins_24h: number; successful_logins_24h: number };
  roles_breakdown: Array<{
    name: string;
    is_active: number | boolean;
    users: number;
    keys: number;
  }>;
}

export interface MgmtAuditEntry {
  id: number;
  user_id: number | null;
  api_key_id: number | null;
  action: string;
  endpoint: string;
  ip_address: string | null;
  timestamp: string;
  details: unknown;
  username: string | null;
  method: string;
  status_code: number;
  duration_ms: number;
  user_agent: string | null;
  request_body: string;
  auth_method: string;
  event_type: string;
}

export interface BulkResult {
  action: string;
  ok: number[];
  failed: Array<{ id: number; error: string }>;
}

// ── Users ────────────────────────────────────────────────────────────────
export interface UserListParams {
  role?: string;
  is_active?: boolean;
  search?: string;
  offset?: number;
  limit?: number;
}

export const mgmtUsersApi = {
  list: async (params: UserListParams = {}): Promise<MgmtUser[]> => {
    const res = await api.get('/mgmt/users', { params: { offset: 0, limit: 100, ...params } });
    return (res.data?.data ?? res.data) as MgmtUser[];
  },
  get: async (id: number): Promise<MgmtUser> => {
    const res = await api.get(`/mgmt/users/${id}`);
    return (res.data?.data ?? res.data) as MgmtUser;
  },
  create: async (body: {
    username: string;
    password: string;
    role: string;
    full_name?: string;
    email?: string;
    weight?: number;
  }): Promise<MgmtUser> => {
    const res = await api.post('/mgmt/users', body);
    return (res.data?.data ?? res.data) as MgmtUser;
  },
  update: async (id: number, body: {
    username?: string;
    password?: string;
    role?: string;
    full_name?: string;
    email?: string;
    is_active?: boolean;
    weight?: number;
  }): Promise<MgmtUser> => {
    const res = await api.put(`/mgmt/users/${id}`, body);
    return (res.data?.data ?? res.data) as MgmtUser;
  },
  delete: async (id: number, hard = false): Promise<void> => {
    await api.delete(`/mgmt/users/${id}`, { params: { hard } });
  },
  enable: async (id: number): Promise<void> => {
    await api.post(`/mgmt/users/${id}/enable`, '');
  },
  disable: async (id: number): Promise<void> => {
    await api.post(`/mgmt/users/${id}/disable`, '');
  },
  purge: async (id: number): Promise<void> => {
    await api.post(`/mgmt/users/${id}/purge`, '');
  },
  resetPassword: async (id: number, new_password: string): Promise<void> => {
    await api.post(`/mgmt/users/${id}/reset-password`, { new_password });
  },
  keys: async (id: number, include_inactive = false): Promise<MgmtApiKey[]> => {
    const res = await api.get(`/mgmt/users/${id}/keys`, { params: { include_inactive } });
    return (res.data?.data ?? res.data) as MgmtApiKey[];
  },
  bulk: async (ids: number[], action: 'enable' | 'disable' | 'purge'): Promise<BulkResult> => {
    const res = await api.post('/mgmt/users/bulk', { ids, action });
    return (res.data?.data ?? res.data) as BulkResult;
  },
};

// ── API Keys ─────────────────────────────────────────────────────────────
export interface KeyListParams {
  user_id?: number;
  include_inactive?: boolean;
  offset?: number;
  limit?: number;
}

export const mgmtKeysApi = {
  list: async (params: KeyListParams = {}): Promise<MgmtApiKey[]> => {
    const res = await api.get('/mgmt/keys', { params });
    return (res.data?.data ?? res.data) as MgmtApiKey[];
  },
  get: async (id: number): Promise<MgmtApiKey> => {
    const res = await api.get(`/mgmt/keys/${id}`);
    return (res.data?.data ?? res.data) as MgmtApiKey;
  },
  create: async (body: {
    user_id: number;
    name: string;
    role: string;
    description?: string;
    expires_days?: number;
    weight?: number;
  }): Promise<{ key: string }> => {
    const res = await api.post('/mgmt/keys', body);
    return (res.data?.data ?? res.data) as { key: string };
  },
  update: async (id: number, body: {
    name?: string;
    role?: string;
    description?: string;
    is_active?: boolean;
    expires_days?: number;
    weight?: number;
  }): Promise<MgmtApiKey> => {
    const res = await api.put(`/mgmt/keys/${id}`, body);
    return (res.data?.data ?? res.data) as MgmtApiKey;
  },
  delete: async (id: number, hard = false): Promise<void> => {
    await api.delete(`/mgmt/keys/${id}`, { params: { hard } });
  },
  enable: async (id: number): Promise<void> => {
    await api.post(`/mgmt/keys/${id}/enable`, '');
  },
  disable: async (id: number): Promise<void> => {
    await api.post(`/mgmt/keys/${id}/disable`, '');
  },
  purge: async (id: number): Promise<void> => {
    await api.post(`/mgmt/keys/${id}/purge`, '');
  },
  rotate: async (id: number): Promise<{ key: string }> => {
    const res = await api.post(`/mgmt/keys/${id}/rotate`, '');
    return (res.data?.data ?? res.data) as { key: string };
  },
  bulk: async (ids: number[], action: 'enable' | 'disable' | 'purge'): Promise<BulkResult> => {
    const res = await api.post('/mgmt/keys/bulk', { ids, action });
    return (res.data?.data ?? res.data) as BulkResult;
  },
};

// ── Roles ────────────────────────────────────────────────────────────────
export interface RoleListParams {
  include_disabled?: boolean;
}

export const mgmtRolesApi = {
  list: async (params: RoleListParams = {}): Promise<MgmtRole[]> => {
    const res = await api.get('/mgmt/roles', { params });
    return (res.data?.data ?? res.data) as MgmtRole[];
  },
  get: async (name: string): Promise<MgmtRole> => {
    const res = await api.get(`/mgmt/roles/${encodeURIComponent(name)}`);
    return (res.data?.data ?? res.data) as MgmtRole;
  },
  create: async (body: {
    name: string;
    description?: string;
    permissions: string[];
    weight?: number;
  }): Promise<MgmtRole> => {
    const res = await api.post('/mgmt/roles', body);
    return (res.data?.data ?? res.data) as MgmtRole;
  },
  update: async (name: string, body: {
    name?: string;
    description?: string;
    permissions?: string[];
    weight?: number;
    is_active?: boolean;
  }): Promise<MgmtRole> => {
    const res = await api.put(`/mgmt/roles/${encodeURIComponent(name)}`, body);
    return (res.data?.data ?? res.data) as MgmtRole;
  },
  delete: async (name: string): Promise<void> => {
    await api.delete(`/mgmt/roles/${encodeURIComponent(name)}`);
  },
  enable: async (name: string): Promise<void> => {
    await api.post(`/mgmt/roles/${encodeURIComponent(name)}/enable`, '');
  },
  disable: async (name: string): Promise<void> => {
    await api.post(`/mgmt/roles/${encodeURIComponent(name)}/disable`, '');
  },
  genKey: async (name: string, body: {
    user_id: number;
    name: string;
    description?: string;
    expires_days?: number;
    weight?: number;
  }): Promise<{ key: string; role: string }> => {
    const res = await api.post(`/mgmt/roles/${encodeURIComponent(name)}/gen-key`, body);
    return (res.data?.data ?? res.data) as { key: string; role: string };
  },
  users: async (name: string, include_inactive = false): Promise<MgmtUser[]> => {
    const res = await api.get(`/mgmt/roles/${encodeURIComponent(name)}/users`, {
      params: { include_inactive },
    });
    return (res.data?.data ?? res.data) as MgmtUser[];
  },
  keys: async (name: string, include_inactive = false): Promise<MgmtApiKey[]> => {
    const res = await api.get(`/mgmt/roles/${encodeURIComponent(name)}/keys`, {
      params: { include_inactive },
    });
    return (res.data?.data ?? res.data) as MgmtApiKey[];
  },
};

// ── Permissions ──────────────────────────────────────────────────────────
export interface PermissionsByCategory {
  [category: string]: string[];
}

export const mgmtPermissionsApi = {
  list: async (): Promise<{ total: number; categories: PermissionsByCategory }> => {
    const res = await api.get('/mgmt/permissions');
    return {
      total: res.data?.total ?? 0,
      categories: (res.data?.categories ?? res.data?.data ?? {}) as PermissionsByCategory,
    };
  },
  assign: async (role_name: string, permissions: string[]): Promise<MgmtRole> => {
    const res = await api.post('/mgmt/permissions/assign', { role_name, permissions });
    return (res.data?.data ?? res.data) as MgmtRole;
  },
  revoke: async (role_name: string, permissions: string[]): Promise<MgmtRole> => {
    const res = await api.post('/mgmt/permissions/revoke', { role_name, permissions });
    return (res.data?.data ?? res.data) as MgmtRole;
  },
};

// ── Stats ────────────────────────────────────────────────────────────────
export const mgmtStatsApi = {
  get: async (): Promise<MgmtStats> => {
    const res = await api.get('/mgmt/stats');
    return (res.data?.data ?? res.data) as MgmtStats;
  },
};

// ── Audit ────────────────────────────────────────────────────────────────
export interface AuditListParams {
  offset?: number;
  limit?: number;
  user_id?: number;
  action?: string;
  method?: string;
  status_code?: number;
  search?: string;
}

export interface AuditListResponse {
  entries: MgmtAuditEntry[];
  count: number;
  offset: number;
  limit: number;
}

export const mgmtAuditApi = {
  list: async (params: AuditListParams = {}): Promise<AuditListResponse> => {
    const res = await api.get('/mgmt/audit', {
      params: { offset: 0, limit: 50, ...params },
    });
    const data = res.data?.data ?? res.data;
    const entries = Array.isArray(data) ? data : (data?.entries ?? data?.items ?? []);
    return {
      entries,
      count: res.data?.count ?? entries.length,
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
    };
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────
export { getErrorMessage };
