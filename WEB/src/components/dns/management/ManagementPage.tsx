'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import {
  Users, KeyRound, Shield, Lock, Trash2, Plus, RefreshCw,
  Loader2, Eye, Copy, Check, Wrench
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import ColumnCustomizer, { useColumnConfig, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';

export default function ManagementPage() {
  const { t } = useTranslation();

  // ── Users Tab ──────────────────────────────────────────────────────────
  const [mgmtUsers, setMgmtUsers] = useState<Record<string, unknown>[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [newMgmtUser, setNewMgmtUser] = useState({ username: '', password: '', role: 'operator' });

  const defaultUserCols: ColumnDef[] = [
    { key: 'id', label: 'ID', visible: true, removable: false },
    { key: 'username', label: t('auth.username'), visible: true },
    { key: 'role', label: t('profile.role'), visible: true },
    { key: 'is_active', label: t('common.status'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: userColConfig, setColumns: setUserColConfig, isColumnVisible: isUserColVisible, extraVisibleColumns: userExtraCols, getColumnWidth: getUserColumnWidth, setColumnWidth: setUserColumnWidth } = useColumnConfig('mgmt-users', defaultUserCols);

  const mgmtUserDataKeys = useMemo(() => {
    const keySet = new Set<string>();
    mgmtUsers.forEach(u => Object.keys(u).forEach(k => keySet.add(k)));
    return [...keySet].sort();
  }, [mgmtUsers]);

  const userColSpan = useMemo(() => userColConfig.filter(c => c.visible).length, [userColConfig]);

  const loadMgmtUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const response = await api.get('/mgmt/users');
      const data = response.data;
      if (Array.isArray(data?.data)) {
        setMgmtUsers(data.data);
      } else if (Array.isArray(data)) {
        setMgmtUsers(data);
      } else if (data.users) {
        setMgmtUsers(data.users);
      } else {
        setMgmtUsers([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedLoadUsers')));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const createMgmtUser = useCallback(async () => {
    try {
      await api.post('/mgmt/users', null, {
        params: {
          username: newMgmtUser.username,
          password: newMgmtUser.password,
          role: newMgmtUser.role,
        },
      });
      toast.success(t('management.userCreated'));
      setCreateUserDialogOpen(false);
      setNewMgmtUser({ username: '', password: '', role: 'operator' });
      loadMgmtUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedCreateUser')));
    }
  }, [newMgmtUser, loadMgmtUsers]);

  const deleteMgmtUser = useCallback(async (userId: number) => {
    if (!confirm(`Delete user #${userId}?`)) return;
    try {
      await api.delete(`/mgmt/users/${userId}`);
      toast.success(`User #${userId} deleted`);
      loadMgmtUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedDeleteUser')));
    }
  }, [loadMgmtUsers]);

  // ── API Keys Tab ───────────────────────────────────────────────────────
  const [apiKeys, setApiKeys] = useState<Record<string, unknown>[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [createKeyDialogOpen, setCreateKeyDialogOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState({ user_id: '', name: '', role: 'operator' });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const defaultKeyCols: ColumnDef[] = [
    { key: 'id', label: 'ID', visible: true, removable: false },
    { key: 'name', label: t('common.name'), visible: true },
    { key: 'user_id', label: t('management.userId'), visible: true },
    { key: 'role', label: t('profile.role'), visible: true },
    { key: 'is_active', label: t('common.status'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: keyColConfig, setColumns: setKeyColConfig, isColumnVisible: isKeyColVisible, extraVisibleColumns: keyExtraCols, getColumnWidth: getKeyColumnWidth, setColumnWidth: setKeyColumnWidth } = useColumnConfig('mgmt-keys', defaultKeyCols);

  const apiKeyDataKeys = useMemo(() => {
    const keySet = new Set<string>();
    apiKeys.forEach(k => Object.keys(k).forEach(kk => keySet.add(kk)));
    return [...keySet].sort();
  }, [apiKeys]);

  const keyColSpan = useMemo(() => keyColConfig.filter(c => c.visible).length, [keyColConfig]);

  const loadApiKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const response = await api.get('/mgmt/keys');
      const data = response.data;
      if (Array.isArray(data?.data)) {
        setApiKeys(data.data);
      } else if (Array.isArray(data)) {
        setApiKeys(data);
      } else if (data.keys) {
        setApiKeys(data.keys);
      } else {
        setApiKeys([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedLoadKeys')));
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const createApiKey = useCallback(async () => {
    try {
      const response = await api.post('/mgmt/keys', null, {
        params: {
          user_id: newApiKey.user_id,
          name: newApiKey.name,
          role: newApiKey.role,
        },
      });
      const data = response.data;
      const key = data?.data?.key || data?.key || '';
      if (key) {
        setCreatedKey(key);
        setKeyCopied(false);
        toast.success(t('management.keyCreated') + ' — ' + t('management.keyWarning').toLowerCase());
      } else {
        toast.success(t('management.keyCreated'));
      }
      loadApiKeys();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedCreateKey')));
    }
  }, [newApiKey, loadApiKeys]);

  const deleteApiKey = useCallback(async (keyId: number) => {
    if (!confirm(`Delete API key #${keyId}?`)) return;
    try {
      await api.delete(`/mgmt/keys/${keyId}`);
      toast.success(t('management.keyDeactivated'));
      loadApiKeys();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedDeleteKey')));
    }
  }, [loadApiKeys]);

  const copyKey = useCallback(async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      toast.success(t('management.keyCopied'));
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      toast.error(safeToastMessage(undefined, t('management.failedCopy')));
    }
  }, [createdKey]);

  // ── Roles Tab ──────────────────────────────────────────────────────────
  const [roles, setRoles] = useState<Record<string, unknown>[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleDetails, setRoleDetails] = useState<Record<string, unknown> | null>(null);
  const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '', permissions: [] as string[] });
  const [availablePermissions, setAvailablePermissions] = useState<Record<string, string[]>>({});

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const response = await api.get('/mgmt/roles');
      const data = response.data;
      if (Array.isArray(data?.data)) {
        setRoles(data.data);
      } else if (Array.isArray(data)) {
        setRoles(data);
      } else if (data.roles) {
        setRoles(data.roles);
      } else {
        setRoles([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('management.failedLoadRoles')));
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const showRole = useCallback(async (roleName: string) => {
    setSelectedRole(roleName);
    setRoleDetails(null);
    try {
      const response = await api.get(`/mgmt/roles/${encodeURIComponent(roleName)}`);
      const data = response.data;
      setRoleDetails(data.data || data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('management.failedLoadRoleDetails')));
    }
  }, []);

  const createRole = useCallback(async () => {
    try {
      await api.post('/mgmt/roles', {
        name: newRole.name,
        description: newRole.description,
        permissions: newRole.permissions,
      });
      toast.success(t('management.roleCreated'));
      setCreateRoleDialogOpen(false);
      setNewRole({ name: '', description: '', permissions: [] });
      loadRoles();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('management.failedCreateRole')));
    }
  }, [newRole, loadRoles]);

  const togglePermission = useCallback((perm: string) => {
    setNewRole(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm],
    }));
  }, []);

  // ── Permissions Tab ────────────────────────────────────────────────────
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [permLoading, setPermLoading] = useState(false);

  const loadPermissions = useCallback(async () => {
    setPermLoading(true);
    try {
      const response = await api.get('/mgmt/permissions');
      const data = response.data;
      const perms = data.categories || data.data || {};
      setPermissions(perms);
      setAvailablePermissions(perms);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('management.failedLoadPermissions')));
    } finally {
      setPermLoading(false);
    }
  }, []);

  // ── Debug Tab ──────────────────────────────────────────────────────────
  const [debugLoading, setDebugLoading] = useState(false);
  const [ldapAttributes, setLdapAttributes] = useState<Record<string, { weight: number; types: string[]; sample: string }>>({});
  const [debugEndpoint, setDebugEndpoint] = useState('/health');
  const [debugMethod, setDebugMethod] = useState<'GET' | 'POST'>('GET');
  const [debugBody, setDebugBody] = useState('');
  const [debugResponse, setDebugResponse] = useState<string>('');
  const [debugRunning, setDebugRunning] = useState(false);
  const [attrSearch, setAttrSearch] = useState('');

  const loadLdapAttributes = useCallback(async () => {
    setDebugLoading(true);
    try {
      const attrMap: Record<string, { weight: number; types: string[]; sample: string }> = {};
      const endpoints = [
        { url: '/users/', key: 'users' },
        { url: '/groups/full', key: 'groups' },
        { url: '/computers/full', key: 'computers' },
        { url: '/gpo/listall', key: 'gpo' },
      ];
      for (const ep of endpoints) {
        try {
          const res = await api.get(ep.url);
          const data = res.data;
          let items: Record<string, unknown>[] = [];
          if (Array.isArray(data)) items = data;
          else if (data?.data && Array.isArray(data.data)) items = data.data;
          else if (data?.users) items = data.users;
          else if (data?.groups) items = data.groups;
          else if (data?.computers) items = data.computers;
          else if (data?.gpos) items = data.gpos;
          else if (data?.items) items = data.items;
          
          for (const item of items.slice(0, 20)) {
            if (typeof item !== 'object' || item === null) continue;
            for (const [k, v] of Object.entries(item)) {
              if (k === '__typename') continue;
              if (!attrMap[k]) {
                attrMap[k] = { weight: 0, types: [], sample: '' };
              }
              attrMap[k].weight += 1;
              const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
              if (!attrMap[k].types.includes(t)) attrMap[k].types.push(t);
              if (!attrMap[k].sample && v !== null && v !== undefined) {
                attrMap[k].sample = Array.isArray(v) ? `[${v.length}]` : typeof v === 'object' ? `{${Object.keys(v as Record<string, unknown>).length} keys}` : String(v).slice(0, 40);
              }
            }
          }
        } catch { /* skip */ }
      }
      setLdapAttributes(attrMap);
    } catch (err: unknown) {
      const error = err as { message?: string };
      toast.error(safeToastMessage(error?.message, 'Failed to load LDAP attributes'));
    } finally {
      setDebugLoading(false);
    }
  }, []);

  const runDebugApi = useCallback(async () => {
    setDebugRunning(true);
    setDebugResponse('');
    try {
      const start = Date.now();
      let res;
      if (debugMethod === 'POST') {
        let bodyData: unknown;
        try { bodyData = JSON.parse(debugBody); } catch { bodyData = debugBody; }
        res = await api.post(debugEndpoint, bodyData);
      } else {
        res = await api.get(debugEndpoint);
      }
      const elapsed = Date.now() - start;
      setDebugResponse(`[${res.status}] ${elapsed}ms\n${JSON.stringify(res.data, null, 2)}`);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: unknown }; message?: string };
      setDebugResponse(`Error: ${error?.response?.status || ''} ${error?.message || 'Unknown error'}\n${error?.response?.data ? JSON.stringify(error.response.data, null, 2) : ''}`);
    } finally {
      setDebugRunning(false);
    }
  }, [debugEndpoint, debugMethod, debugBody]);

  useEffect(() => {
    loadMgmtUsers();
    loadApiKeys();
    loadRoles();
    loadPermissions();
  }, [loadMgmtUsers, loadApiKeys, loadRoles, loadPermissions]);

  return (
    <RequirePermission permission="mgmt.users.list">
      <div className="space-y-4">
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" className="gap-1">
              <Users className="w-3.5 h-3.5" />
              {t('management.users')}
            </TabsTrigger>
            <TabsTrigger value="keys" className="gap-1">
              <KeyRound className="w-3.5 h-3.5" />
              {t('management.apiKeys')}
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-1">
              <Shield className="w-3.5 h-3.5" />
              {t('management.roles')}
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1">
              <Lock className="w-3.5 h-3.5" />
              {t('management.permissions')}
            </TabsTrigger>
            <TabsTrigger value="debug" className="gap-1">
              <Wrench className="w-3.5 h-3.5" />
              {t('management.debug')}
            </TabsTrigger>
          </TabsList>

          {/* ── Users Tab ──────────────────────────────────────────────── */}
          <TabsContent value="users">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Dialog open={createUserDialogOpen} onOpenChange={setCreateUserDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-4 h-4 mr-1" />
                      {t('management.createUser')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('management.createUser')}</DialogTitle>
                      <DialogDescription className="sr-only">{t('management.createUser')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('auth.username')} *</Label>
                        <Input
                          value={newMgmtUser.username}
                          onChange={(e) => setNewMgmtUser(p => ({ ...p, username: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('auth.password')} *</Label>
                        <Input
                          type="password"
                          value={newMgmtUser.password}
                          onChange={(e) => setNewMgmtUser(p => ({ ...p, password: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('profile.role')}</Label>
                        <Select value={newMgmtUser.role} onValueChange={(v) => setNewMgmtUser(p => ({ ...p, role: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">admin</SelectItem>
                            <SelectItem value="operator">operator</SelectItem>
                            <SelectItem value="auditor">auditor</SelectItem>
                            <SelectItem value="viewer">viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={createMgmtUser} disabled={!newMgmtUser.username || !newMgmtUser.password} className="w-full">
                        {t('management.createUser')}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <div className="flex-1" />

                <ColumnCustomizer
                  entityType="mgmt-users"
                  columns={userColConfig}
                  onColumnsChange={setUserColConfig}
                  dataKeys={mgmtUserDataKeys}
                />

                <Button variant="outline" size="sm" onClick={loadMgmtUsers} disabled={usersLoading}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${usersLoading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </Button>
              </div>

              <Card className="overflow-hidden">
                <ScrollArea className="max-h-[calc(100vh-22rem)]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isUserColVisible('id') && <TableHead className="w-12 relative">
                          ID
                          <ResizeHandle onResize={(d) => setUserColumnWidth('id', (getUserColumnWidth('id') || 48) + d)} />
                        </TableHead>}
                        {isUserColVisible('username') && <TableHead style={{ width: getUserColumnWidth('username') || undefined }} className="relative">
                          {t('auth.username')}
                          <ResizeHandle onResize={(d) => setUserColumnWidth('username', (getUserColumnWidth('username') || 150) + d)} />
                        </TableHead>}
                        {isUserColVisible('role') && <TableHead style={{ width: getUserColumnWidth('role') || undefined }} className="relative">
                          {t('profile.role')}
                          <ResizeHandle onResize={(d) => setUserColumnWidth('role', (getUserColumnWidth('role') || 100) + d)} />
                        </TableHead>}
                        {isUserColVisible('is_active') && <TableHead style={{ width: getUserColumnWidth('is_active') || undefined }} className="relative">
                          {t('common.status')}
                          <ResizeHandle onResize={(d) => setUserColumnWidth('is_active', (getUserColumnWidth('is_active') || 100) + d)} />
                        </TableHead>}
                        {isUserColVisible('actions') && <TableHead className="w-24">{t('common.actions')}</TableHead>}
                        {userExtraCols.map(col => (
                          <TableHead key={col.key} style={{ width: getUserColumnWidth(col.key) || undefined }} className="relative">
                            {col.label}
                            <ResizeHandle onResize={(d) => setUserColumnWidth(col.key, (getUserColumnWidth(col.key) || 150) + d)} />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                      <TableBody>
                        {usersLoading ? (
                          <TableRow>
                            <TableCell colSpan={userColSpan} className="text-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ) : mgmtUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={userColSpan} className="text-center py-8 text-muted-foreground">
                              {t('common.noData')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          mgmtUsers.map((user, i) => (
                            <TableRow key={i} className="group">
                              {isUserColVisible('id') && <TableCell className="text-xs text-muted-foreground">{String(user.id || i + 1)}</TableCell>}
                              {isUserColVisible('username') && <TableCell className="font-medium">{String(user.username || '')}</TableCell>}
                              {isUserColVisible('role') && (
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{String(user.role || '')}</Badge>
                                </TableCell>
                              )}
                              {isUserColVisible('is_active') && (
                                <TableCell>
                                  <Badge variant={user.is_active === false ? 'secondary' : 'default'} className="text-xs">
                                    {user.is_active === false ? t('common.disabled') : t('common.active')}
                                  </Badge>
                                </TableCell>
                              )}
                              {isUserColVisible('actions') && (
                                <TableCell>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => deleteMgmtUser(Number(user.id))}
                                    >
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                              {userExtraCols.map(col => (
                                <TableCell key={col.key} className="text-xs text-muted-foreground">
                                  {String(user[col.key] ?? '')}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </Card>
            </div>
          </TabsContent>

          {/* ── API Keys Tab ────────────────────────────────────────────── */}
          <TabsContent value="keys">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Dialog open={createKeyDialogOpen} onOpenChange={(open) => {
                  setCreateKeyDialogOpen(open);
                  if (!open) setCreatedKey(null);
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-4 h-4 mr-1" />
                      {t('management.createKey')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t('management.createKey')}</DialogTitle>
                      <DialogDescription className="sr-only">{t('management.createKey')}</DialogDescription>
                    </DialogHeader>
                    {createdKey ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-muted rounded-lg">
                          <Label className="text-xs font-bold text-amber-500">{t('management.keyWarning')}</Label>
                          <div className="mt-2 flex items-center gap-2">
                            <code className="text-xs font-mono break-all flex-1 bg-background p-2 rounded border">
                              {createdKey}
                            </code>
                            <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={copyKey}>
                              {keyCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            </Button>
                          </div>
                        </div>
                        <Button variant="outline" className="w-full" onClick={() => setCreatedKey(null)}>
                          {t('common.close')}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs">{t('management.userId')} *</Label>
                          <Input
                            type="number"
                            value={newApiKey.user_id}
                            onChange={(e) => setNewApiKey(p => ({ ...p, user_id: e.target.value }))}
                            className="h-8 text-sm"
                            placeholder="1"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('common.name')} *</Label>
                          <Input
                            value={newApiKey.name}
                            onChange={(e) => setNewApiKey(p => ({ ...p, name: e.target.value }))}
                            className="h-8 text-sm"
                            placeholder="My API Key"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('profile.role')}</Label>
                          <Select value={newApiKey.role} onValueChange={(v) => setNewApiKey(p => ({ ...p, role: v }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">admin</SelectItem>
                              <SelectItem value="operator">operator</SelectItem>
                              <SelectItem value="auditor">auditor</SelectItem>
                              <SelectItem value="viewer">viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button onClick={createApiKey} disabled={!newApiKey.user_id || !newApiKey.name} className="w-full">
                          {t('management.createKey')}
                        </Button>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>

                <div className="flex-1" />

                <ColumnCustomizer
                  entityType="mgmt-keys"
                  columns={keyColConfig}
                  onColumnsChange={setKeyColConfig}
                  dataKeys={apiKeyDataKeys}
                />

                <Button variant="outline" size="sm" onClick={loadApiKeys} disabled={keysLoading}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${keysLoading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </Button>
              </div>

              <Card className="overflow-hidden">
                <ScrollArea className="max-h-[calc(100vh-22rem)]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isKeyColVisible('id') && <TableHead className="w-12 relative">
                          ID
                          <ResizeHandle onResize={(d) => setKeyColumnWidth('id', (getKeyColumnWidth('id') || 48) + d)} />
                        </TableHead>}
                        {isKeyColVisible('name') && <TableHead style={{ width: getKeyColumnWidth('name') || undefined }} className="relative">
                          {t('common.name')}
                          <ResizeHandle onResize={(d) => setKeyColumnWidth('name', (getKeyColumnWidth('name') || 150) + d)} />
                        </TableHead>}
                        {isKeyColVisible('user_id') && <TableHead style={{ width: getKeyColumnWidth('user_id') || undefined }} className="relative">
                          {t('management.userId')}
                          <ResizeHandle onResize={(d) => setKeyColumnWidth('user_id', (getKeyColumnWidth('user_id') || 100) + d)} />
                        </TableHead>}
                        {isKeyColVisible('role') && <TableHead style={{ width: getKeyColumnWidth('role') || undefined }} className="relative">
                          {t('profile.role')}
                          <ResizeHandle onResize={(d) => setKeyColumnWidth('role', (getKeyColumnWidth('role') || 100) + d)} />
                        </TableHead>}
                        {isKeyColVisible('is_active') && <TableHead style={{ width: getKeyColumnWidth('is_active') || undefined }} className="relative">
                          {t('common.status')}
                          <ResizeHandle onResize={(d) => setKeyColumnWidth('is_active', (getKeyColumnWidth('is_active') || 100) + d)} />
                        </TableHead>}
                        {isKeyColVisible('actions') && <TableHead className="w-24">{t('common.actions')}</TableHead>}
                        {keyExtraCols.map(col => (
                          <TableHead key={col.key} style={{ width: getKeyColumnWidth(col.key) || undefined }} className="relative">
                            {col.label}
                            <ResizeHandle onResize={(d) => setKeyColumnWidth(col.key, (getKeyColumnWidth(col.key) || 150) + d)} />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                      <TableBody>
                        {keysLoading ? (
                          <TableRow>
                            <TableCell colSpan={keyColSpan} className="text-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ) : apiKeys.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={keyColSpan} className="text-center py-8 text-muted-foreground">
                              {t('common.noData')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          apiKeys.map((key, i) => (
                            <TableRow key={i} className="group">
                              {isKeyColVisible('id') && <TableCell className="text-xs text-muted-foreground">{String(key.id || i + 1)}</TableCell>}
                              {isKeyColVisible('name') && <TableCell className="font-medium">{String(key.name || '')}</TableCell>}
                              {isKeyColVisible('user_id') && <TableCell className="text-sm">{String(key.user_id || '')}</TableCell>}
                              {isKeyColVisible('role') && (
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{String(key.role || '')}</Badge>
                                </TableCell>
                              )}
                              {isKeyColVisible('is_active') && (
                                <TableCell>
                                  <Badge variant={key.is_active === false ? 'secondary' : 'default'} className="text-xs">
                                    {key.is_active === false ? t('common.disabled') : t('common.active')}
                                  </Badge>
                                </TableCell>
                              )}
                              {isKeyColVisible('actions') && (
                                <TableCell>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => deleteApiKey(Number(key.id))}
                                    >
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                              {keyExtraCols.map(col => (
                                <TableCell key={col.key} className="text-xs text-muted-foreground">
                                  {String(key[col.key] ?? '')}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </Card>
            </div>
          </TabsContent>

          {/* ── Roles Tab ───────────────────────────────────────────────── */}
          <TabsContent value="roles">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Dialog open={createRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="w-4 h-4 mr-1" />
                      {t('management.createRole')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-6 pb-3 border-b flex-shrink-0">
                      <DialogTitle>{t('management.createRole')}</DialogTitle>
                      <DialogDescription className="sr-only">{t('management.createRole')}</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('common.name')} *</Label>
                        <Input
                          value={newRole.name}
                          onChange={(e) => setNewRole(p => ({ ...p, name: e.target.value }))}
                          className="h-8 text-sm"
                          placeholder={t('management.roleNamePlaceholder')}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('common.description')}</Label>
                        <Input
                          value={newRole.description}
                          onChange={(e) => setNewRole(p => ({ ...p, description: e.target.value }))}
                          className="h-8 text-sm"
                          placeholder={t('management.roleDescriptionPlaceholder')}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold">{t('management.permissions')}</Label>
                          <Badge variant="outline" className="text-xs">{newRole.permissions.length} {t('common.selected')}</Badge>
                        </div>
                        {Object.keys(availablePermissions).length > 0 ? (
                          <ScrollArea className="max-h-60">
                            <div className="space-y-3">
                              {Object.entries(availablePermissions).map(([category, perms]) => (
                                <div key={category}>
                                  <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                                    <Lock className="w-3 h-3" />
                                    {category}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-4 text-[10px] px-1 ml-auto"
                                      onClick={() => {
                                        const allSelected = perms.every(p => newRole.permissions.includes(p));
                                        setNewRole(prev => ({
                                          ...prev,
                                          permissions: allSelected
                                            ? prev.permissions.filter(p => !perms.includes(p))
                                            : [...new Set([...prev.permissions, ...perms])],
                                        }));
                                      }}
                                    >
                                      {perms.every(p => newRole.permissions.includes(p)) ? t('management.deselectAll') : t('management.selectAll')}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {perms.map((perm) => {
                                      const isSelected = newRole.permissions.includes(perm);
                                      return (
                                        <button
                                          key={perm}
                                          onClick={() => togglePermission(perm)}
                                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                                            isSelected
                                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                                              : 'border-border hover:border-emerald-500/30 text-muted-foreground'
                                          }`}
                                        >
                                          {perm}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        ) : (
                          <p className="text-xs text-muted-foreground py-2">{t('management.loadingPermissions')}</p>
                        )}
                      </div>
                    </div>
                    <DialogFooter className="px-6 py-4 border-t bg-background flex-shrink-0">
                      <Button variant="outline" onClick={() => setCreateRoleDialogOpen(false)} className="mr-auto">
                        {t('common.cancel')}
                      </Button>
                      <Button onClick={createRole} disabled={!newRole.name}>
                        <Plus className="w-4 h-4 mr-1" />
                        {t('management.createRole')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={loadRoles} disabled={rolesLoading}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${rolesLoading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </Button>
              </div>

              <Card className="overflow-hidden">
                <ScrollArea className="max-h-[calc(100vh-22rem)]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.name')}</TableHead>
                        <TableHead>{t('common.description')}</TableHead>
                        <TableHead>{t('management.permissions')}</TableHead>
                        <TableHead className="w-24">{t('common.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                      <TableBody>
                        {rolesLoading ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ) : roles.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              {t('common.noData')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          roles.map((role, i) => {
                            const roleName = String(role.name || role.role_name || `Role ${i + 1}`);
                            const perms = (role.permissions || []) as string[];
                            const desc = String(role.description || '');
                            return (
                              <TableRow key={i} className="group">
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-purple-400" />
                                    <span className="font-medium">{roleName}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{desc}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {perms.length} {t('management.permissions')}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showRole(roleName)}>
                                      <Eye className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </Card>

              {/* Role Details Dialog */}
              {selectedRole && (
                <Dialog open={!!selectedRole} onOpenChange={() => setSelectedRole(null)}>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          {selectedRole}
                        </DialogTitle>
                        <DialogDescription className="sr-only">{selectedRole}</DialogDescription>
                      </DialogHeader>
                    {roleDetails ? (
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-3">
                          {typeof roleDetails.description === 'string' && roleDetails.description && (
                            <p className="text-sm text-muted-foreground">{roleDetails.description}</p>
                          )}
                          <div>
                            <Label className="text-xs font-bold mb-2 block">{t('management.permissions')}</Label>
                            <div className="flex flex-wrap gap-1">
                              {((roleDetails.permissions || []) as string[]).map((perm, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs font-mono">
                                  {perm}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="py-8 text-center">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </TabsContent>

          {/* ── Permissions Tab ─────────────────────────────────────────── */}
          <TabsContent value="permissions">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={loadPermissions} disabled={permLoading}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${permLoading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </Button>
              </div>

              {permLoading ? (
                <div className="py-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : Object.keys(permissions).length === 0 ? (
                <Card>
                  <div className="py-8 text-center text-muted-foreground">{t('common.noData')}</div>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(permissions).map(([category, perms]) => (
                    <Card key={category}>
                      <Card className="border-0 shadow-none">
                        <div className="p-4">
                          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                            <Lock className="w-4 h-4 text-muted-foreground" />
                            {category}
                          </h3>
                          <ScrollArea className="max-h-48">
                            <div className="flex flex-wrap gap-1">
                              {perms.map((perm, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs font-mono">
                                  {perm}
                                </Badge>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      </Card>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Debug Tab ──────────────────────────────────────────────────── */}
          <TabsContent value="debug">
            <div className="space-y-4">
              {/* LDAP Attribute Weight Inspector */}
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Wrench className="w-4 h-4" />
                      {t('debug.attrWeights')}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">{t('debug.attrWeightsDesc')}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadLdapAttributes} disabled={debugLoading}>
                    <RefreshCw className={`w-3 h-3 mr-1 ${debugLoading ? 'animate-spin' : ''}`} />
                    {t('common.refresh')}
                  </Button>
                </div>
                
                <div className="relative mb-3">
                  <Input
                    value={attrSearch}
                    onChange={(e) => setAttrSearch(e.target.value)}
                    placeholder={t('debug.searchAttrs')}
                    className="h-8 text-sm"
                  />
                </div>
                
                {Object.keys(ldapAttributes).length > 0 ? (
                  <ScrollArea className="max-h-[40vh]">
                    <div className="space-y-0.5">
                      <div className="grid grid-cols-[1fr_60px_80px_1fr] gap-2 text-[10px] text-muted-foreground uppercase font-semibold px-2 py-1 border-b">
                        <span>{t('debug.attrName')}</span>
                        <span className="text-center">{t('debug.weight')}</span>
                        <span>{t('debug.type')}</span>
                        <span>{t('debug.sample')}</span>
                      </div>
                      {Object.entries(ldapAttributes)
                        .filter(([k]) => !attrSearch || k.toLowerCase().includes(attrSearch.toLowerCase()))
                        .sort((a, b) => b[1].weight - a[1].weight)
                        .map(([key, info]) => (
                          <div key={key} className="grid grid-cols-[1fr_60px_80px_1fr] gap-2 text-xs py-1 px-2 rounded hover:bg-accent items-center">
                            <span className="font-mono truncate" title={key}>{key}</span>
                            <span className="text-center">
                              <Badge variant="outline" className="text-[10px] font-mono">{info.weight}</Badge>
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">{info.types.join(', ')}</span>
                            <span className="text-[10px] text-muted-foreground truncate" title={info.sample}>{info.sample || '\u2014'}</span>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {debugLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('debug.clickToLoad')}
                  </p>
                )}
              </Card>

              {/* API Tester */}
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  {t('debug.apiTester')}
                </h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Select value={debugMethod} onValueChange={(v) => setDebugMethod(v as 'GET' | 'POST')}>
                      <SelectTrigger className="w-20 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={debugEndpoint}
                      onChange={(e) => setDebugEndpoint(e.target.value)}
                      placeholder="/api/v1/..."
                      className="flex-1 h-8 text-xs font-mono"
                    />
                    <Button size="sm" onClick={runDebugApi} disabled={debugRunning || !debugEndpoint}>
                      {debugRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : t('debug.run')}
                    </Button>
                  </div>
                  {debugMethod === 'POST' && (
                    <Input
                      value={debugBody}
                      onChange={(e) => setDebugBody(e.target.value)}
                      placeholder='{"key": "value"}'
                      className="h-8 text-xs font-mono"
                    />
                  )}
                  {debugResponse && (
                    <ScrollArea className="max-h-[30vh]">
                      <pre className="text-xs font-mono bg-muted p-3 rounded-lg whitespace-pre-wrap break-all border">
                        {debugResponse}
                      </pre>
                    </ScrollArea>
                  )}
                </div>
              </Card>

              {/* Quick Health Check */}
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">{t('debug.healthCheck')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: '/health', endpoint: '/health' },
                    { label: '/stats', endpoint: '/stats' },
                    { label: '/dashboard/full', endpoint: '/dashboard/full' },
                    { label: '/mgmt/permissions', endpoint: '/mgmt/permissions' },
                  ].map(({ label, endpoint }) => (
                    <Button
                      key={endpoint}
                      variant="outline"
                      size="sm"
                      className="text-xs font-mono h-7"
                      onClick={async () => {
                        setDebugEndpoint(endpoint);
                        setDebugMethod('GET');
                        try {
                          const start = Date.now();
                          const res = await api.get(endpoint);
                          const elapsed = Date.now() - start;
                          setDebugResponse(`[GET ${endpoint}] [${res.status}] ${elapsed}ms\n${JSON.stringify(res.data, null, 2).slice(0, 2000)}`);
                        } catch (err: unknown) {
                          const error = err as { response?: { status?: number; data?: unknown }; message?: string };
                          setDebugResponse(`[GET ${endpoint}] Error: ${error?.response?.status || ''} ${error?.message || ''}`);
                        }
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </RequirePermission>
  );
}
