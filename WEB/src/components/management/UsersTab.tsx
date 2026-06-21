'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, RefreshCw, Loader2, Trash2, Pencil, KeyRound,
  Power, PowerOff, RotateCcw, Ban, CheckSquare, Square,
  AlertTriangle, ShieldAlert, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import {
  mgmtUsersApi, mgmtKeysApi, getErrorMessage,
  type MgmtUser, type MgmtApiKey,
} from '@/lib/api-mgmt';
import { fmtDate, fmtAgo, isActive, isExpired } from './mgmt-utils';
import ScrollableTable from './ScrollableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface UsersTabProps {
  roleOptions: string[];
  onRolesMaybeChanged: () => void;
}

export default function UsersTab({ roleOptions, onRolesMaybeChanged }: UsersTabProps) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [users, setUsers] = useState<MgmtUser[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('__any__');
  const [activeFilter, setActiveFilter] = useState<string>('__all__');
  const [pageSize, setPageSize] = useState(100);

  // Create / Edit / Reset-password dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<MgmtUser | null>(null);
  const [resetUser, setResetUser] = useState<MgmtUser | null>(null);
  const [keysUser, setKeysUser] = useState<MgmtUser | null>(null);

  // Bulk
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Form state
  const emptyNew = { username: '', password: '', role: 'operator', full_name: '', email: '', weight: 0 };
  const [newUser, setNewUser] = useState({ ...emptyNew });
  const [editForm, setEditForm] = useState({ ...emptyNew, is_active: true, password: '' });
  const [resetPassword, setResetPassword] = useState('');

  // User keys dialog
  const [userKeys, setUserKeys] = useState<MgmtApiKey[]>([]);
  const [userKeysLoading, setUserKeysLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof mgmtUsersApi.list>[0] = {
        offset: 0,
        limit: pageSize,
      };
      if (search.trim()) params.search = search.trim();
      if (roleFilter !== '__any__') params.role = roleFilter;
      if (activeFilter === 'active') params.is_active = true;
      if (activeFilter === 'inactive') params.is_active = false;
      const data = await mgmtUsersApi.list(params);
      setUsers(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadUsers')));
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, activeFilter, pageSize, t]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ── Create ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    try {
      await mgmtUsersApi.create({
        username: newUser.username,
        password: newUser.password,
        role: newUser.role,
        full_name: newUser.full_name || undefined,
        email: newUser.email || undefined,
        weight: Number(newUser.weight) || 0,
      });
      toast.success(t('management.userCreated'));
      setCreateOpen(false);
      setNewUser({ ...emptyNew });
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedCreateUser')));
    }
  }, [newUser, loadUsers, t]);

  // ── Edit ────────────────────────────────────────────────────────────
  const openEdit = useCallback((u: MgmtUser) => {
    setEditForm({
      username: u.username,
      password: '',
      role: u.role,
      full_name: u.full_name ?? '',
      email: u.email ?? '',
      weight: u.weight ?? 0,
      is_active: isActive(u.is_active),
    });
    setEditUser(u);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editUser) return;
    try {
      await mgmtUsersApi.update(editUser.id, {
        username: editForm.username,
        password: editForm.password || undefined,
        role: editForm.role,
        full_name: editForm.full_name || undefined,
        email: editForm.email || undefined,
        is_active: editForm.is_active,
        weight: Number(editForm.weight) || 0,
      });
      toast.success(t('management.users_updated'));
      setEditUser(null);
      loadUsers();
      onRolesMaybeChanged();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_update')));
    }
  }, [editUser, editForm, loadUsers, onRolesMaybeChanged, t]);

  // ── Enable / Disable / Purge ────────────────────────────────────────
  const handleEnable = useCallback(async (u: MgmtUser) => {
    try {
      await mgmtUsersApi.enable(u.id);
      toast.success(t('management.users_enabled'));
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_enable')));
    }
  }, [loadUsers, t]);

  const handleDisable = useCallback(async (u: MgmtUser) => {
    if (!confirm(t('management.users_confirm_soft_delete', { id: u.id, username: u.username }))) return;
    try {
      await mgmtUsersApi.disable(u.id);
      toast.success(t('management.users_disabled'));
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_disable')));
    }
  }, [loadUsers, t]);

  const handlePurge = useCallback(async (u: MgmtUser) => {
    if (!confirm(t('management.users_confirm_purge', { id: u.id, username: u.username }))) return;
    try {
      await mgmtUsersApi.purge(u.id);
      toast.success(t('management.users_purged', { id: u.id }));
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_purge')));
    }
  }, [loadUsers, t]);

  // ── Reset password ──────────────────────────────────────────────────
  const handleResetPassword = useCallback(async () => {
    if (!resetUser) return;
    try {
      await mgmtUsersApi.resetPassword(resetUser.id, resetPassword);
      toast.success(t('management.users_password_reset', { id: resetUser.id }));
      setResetUser(null);
      setResetPassword('');
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_reset_password')));
    }
  }, [resetUser, resetPassword, t]);

  // ── Soft delete (DELETE ?hard=false) ───────────────────────────────
  const handleSoftDelete = useCallback(async (u: MgmtUser) => {
    if (!confirm(t('management.users_confirm_soft_delete', { id: u.id, username: u.username }))) return;
    try {
      await mgmtUsersApi.delete(u.id, false);
      toast.success(t('management.users_disabled'));
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedDeleteUser')));
    }
  }, [loadUsers, t]);

  // ── View keys ───────────────────────────────────────────────────────
  const openKeys = useCallback(async (u: MgmtUser) => {
    setKeysUser(u);
    setUserKeysLoading(true);
    setUserKeys([]);
    try {
      const data = await mgmtUsersApi.keys(u.id, true);
      setUserKeys(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadKeys')));
    } finally {
      setUserKeysLoading(false);
    }
  }, [t]);

  // ── Bulk ────────────────────────────────────────────────────────────
  const toggleSelected = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected(prev => {
      if (prev.size === users.length) return new Set();
      return new Set(users.map(u => u.id));
    });
  }, [users]);

  const handleBulk = useCallback(async (action: 'enable' | 'disable' | 'purge') => {
    if (selected.size === 0) return;
    if (!confirm(t('management.users_confirm_bulk', { action, count: selected.size }))) return;
    try {
      const result = await mgmtUsersApi.bulk([...selected], action);
      toast.success(t('management.users_bulk_success', {
        count: result.ok.length,
        failed: result.failed.length,
      }));
      setSelected(new Set());
      loadUsers();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.users_failed_bulk')));
    }
  }, [selected, loadUsers, t]);

  const allChecked = users.length > 0 && selected.size === users.length;
  const someChecked = selected.size > 0 && selected.size < users.length;

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 md:gap-2">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('management.createUser')}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('management.createUser')}</DialogTitle>
              <DialogDescription className="sr-only">{t('management.createUser')}</DialogDescription>
            </DialogHeader>
            <UserForm
              form={newUser}
              onChange={setNewUser}
              roleOptions={roleOptions}
              passwordRequired
              t={t}
            />
            <Button onClick={handleCreate} disabled={!newUser.username || !newUser.password} className="w-full">
              {t('management.createUser')}
            </Button>
          </DialogContent>
        </Dialog>

        <Input
          placeholder={t('management.users_search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadUsers(); }}
          className="h-8 md:h-9 w-full sm:max-w-xs text-sm"
        />

        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-44 text-xs">
            <SelectValue placeholder={t('management.users_role_filter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">{t('management.users_any_role')}</SelectItem>
            {roleOptions.map(r => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('management.users_all')}</SelectItem>
            <SelectItem value="active">{t('management.users_active_only')}</SelectItem>
            <SelectItem value="inactive">{t('management.users_inactive_only')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[50, 100, 200, 500].map(n => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>

        <div className="flex-1" />

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted w-full sm:w-auto">
            <span className="text-xs text-muted-foreground mr-1">
              {selected.size} {t('common.selected')}
            </span>
            <Button size="sm" variant="outline" onClick={() => handleBulk('enable')} className="h-7 px-2 text-xs">
              <Power className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.users_bulk_enable')}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulk('disable')} className="h-7 px-2 text-xs">
              <PowerOff className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.users_bulk_disable')}</span>
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleBulk('purge')} className="h-7 px-2 text-xs">
              <Trash2 className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.users_bulk_purge')}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Mobile card view */}
      {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : users.map((u) => {
            const active = isActive(u.is_active);
            const checked = selected.has(u.id);
            return (
              <Card key={`m-${u.id}`} className="p-3">
                <div className="flex items-start gap-2">
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(u.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm truncate">{u.username}</span>
                      <Badge variant="outline" className="text-[10px]">#{u.id}</Badge>
                      <Badge variant="outline" className="text-[10px]">{u.role}</Badge>
                      <Badge variant={active ? 'default' : 'secondary'} className="text-[10px]">
                        {active ? t('common.active') : t('common.disabled')}
                      </Badge>
                    </div>
                    {u.full_name && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{u.full_name}</div>
                    )}
                    {u.email && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{t('management.users_weight')}: {u.weight ?? 0}</span>
                      <span>{t('management.users_login_count')}: {u.login_count ?? 0}</span>
                    </div>
                    {u.last_login_at && (
                      <div className="text-[10px] text-muted-foreground mt-0.5" title={u.last_login_at}>
                        {t('management.users_last_login')}: {fmtAgo(u.last_login_at, locale)}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t('management.users_created_at')}: {fmtDate(u.created_at, locale)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} title={t('management.users_edit')}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openKeys(u)} title={t('management.users_view_keys')}>
                    <KeyRound className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setResetUser(u)} title={t('management.users_reset_password')}>
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  {active ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDisable(u)} title={t('management.users_disable')}>
                      <PowerOff className="w-4 h-4 text-amber-500" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEnable(u)} title={t('management.users_enable')}>
                      <Power className="w-4 h-4 text-emerald-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSoftDelete(u)} title={t('management.users_soft_delete')}>
                    <Ban className="w-4 h-4 text-orange-400" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePurge(u)} title={t('management.users_purge')}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Desktop table */}
      {!isMobile && (
      <Card className="overflow-hidden p-0">
        <ScrollableTable maxHeight="calc(100vh-22rem)">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 sticky top-0 bg-card z-10">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="w-12 sticky top-0 bg-card z-10">ID</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('auth.username')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_full_name')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_email')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('profile.role')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_weight')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_login_count')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_last_login')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_created_at')}</TableHead>
                  <TableHead className="w-32 sticky top-0 bg-card z-10">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      {t('common.noData')}
                    </TableCell>
                  </TableRow>
                ) : users.map((u) => {
                  const active = isActive(u.is_active);
                  const checked = selected.has(u.id);
                  return (
                    <TableRow key={u.id} className="group">
                      <TableCell>
                        <Checkbox checked={checked} onCheckedChange={() => toggleSelected(u.id)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell className="text-sm">{u.full_name || '—'}</TableCell>
                      <TableCell className="text-sm">{u.email || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={active ? 'default' : 'secondary'} className="text-xs">
                          {active ? t('common.active') : t('common.disabled')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.weight ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.login_count ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground" title={u.last_login_at ?? ''}>
                        {u.last_login_at ? fmtAgo(u.last_login_at, locale) : t('management.users_never_logged_in')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(u.created_at, locale)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)} title={t('management.users_edit')}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openKeys(u)} title={t('management.users_view_keys')}>
                            <KeyRound className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setResetUser(u)} title={t('management.users_reset_password')}>
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                          {active ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDisable(u)} title={t('management.users_disable')}>
                              <PowerOff className="w-3 h-3 text-amber-500" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEnable(u)} title={t('management.users_enable')}>
                              <Power className="w-3 h-3 text-emerald-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSoftDelete(u)} title={t('management.users_soft_delete')}>
                            <Ban className="w-3 h-3 text-orange-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePurge(u)} title={t('management.users_purge')}>
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        </ScrollableTable>
      </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('management.users_edit')} #{editUser?.id}</DialogTitle>
            <DialogDescription className="sr-only">{t('management.users_edit')}</DialogDescription>
          </DialogHeader>
          <UserForm
            form={editForm}
            onChange={(v) => setEditForm(v as typeof editForm)}
            roleOptions={roleOptions}
            passwordRequired={false}
            showActive
            t={t}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleUpdate}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetUser} onOpenChange={(open) => !open && setResetUser(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('management.users_reset_password')} #{resetUser?.id} ({resetUser?.username})</DialogTitle>
            <DialogDescription className="sr-only">{t('management.users_reset_password')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('management.users_new_password')} *</Label>
              <Input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="h-8 md:h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleResetPassword} disabled={!resetPassword}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User keys dialog — resizable, wide, with admin-revoked banner */}
      <Dialog open={!!keysUser} onOpenChange={(open) => !open && setKeysUser(null)}>
        <DialogContent className="mgmt-resizable max-w-[95vw] md:max-w-[98vw] md:w-[1200px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              {t('management.users_admin_keys_dialog', { username: keysUser?.username ?? '', count: userKeys.length })}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.users_admin_keys_dialog', { username: keysUser?.username ?? '', count: userKeys.length })}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t('common.horizontal_scroll_hint')}</span>
            <span className="italic">{t('management.users_keys_resize_hint')}</span>
          </div>

          {/* Revoked / expired banner — shown only if there are disabled or expired keys */}
          {!userKeysLoading && userKeys.length > 0 && (() => {
            const disabled = userKeys.filter(k => !isActive(k.is_active));
            const expired = userKeys.filter(k => isActive(k.is_active) && isExpired(k));
            const totalInactive = disabled.length + expired.length;
            if (totalInactive === 0) return null;
            return (
              <div className="mgmt-revoked-banner p-3 rounded-md flex items-start gap-2">
                <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-sm">
                    {t('management.keys_revoked_banner_title')}
                  </div>
                  <div className="text-xs">
                    {t('management.keys_inactive_count', { count: totalInactive, total: userKeys.length })}
                    {expired.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t('management.keys_expired_banner_body', { count: expired.length })}
                      </span>
                    )}
                  </div>
                  <div className="text-xs">
                    {t('management.keys_revoked_banner_body', { count: disabled.length, total: userKeys.length })}
                  </div>
                </div>
              </div>
            );
          })()}

          {userKeysLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : userKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t('management.users_no_keys')}</p>
          ) : (
            <ScrollableTable maxHeight="calc(92vh - 240px)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 sticky top-0 bg-card z-10">ID</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_key_prefix')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('common.name')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_description')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('profile.role')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_weight')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_expires_at')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_last_used_at')}</TableHead>
                    <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_created_at')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userKeys.map((k) => {
                    const a = isActive(k.is_active);
                    const exp = isExpired(k);
                    const revoked = !a;
                    return (
                      <TableRow
                        key={k.id}
                        className={revoked ? 'opacity-70' : ''}
                        title={revoked ? t('management.keys_revoked_tooltip') : undefined}
                      >
                        <TableCell className="text-xs text-muted-foreground">{k.id}</TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {k.key_prefix}
                          {revoked && <ShieldAlert className="inline-block w-3 h-3 ml-1 text-amber-500" />}
                        </TableCell>
                        <TableCell className="text-sm">{k.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{k.description || '—'}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{k.role}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={a && !exp ? 'default' : 'secondary'} className="text-xs">
                            {!a ? t('common.disabled') : exp ? t('management.keys_expired') : t('common.active')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{k.weight ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{k.expires_at ? fmtDate(k.expires_at, locale) : t('management.keys_never_expires')}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{k.last_used_at ? fmtAgo(k.last_used_at, locale) : t('management.keys_never_used')}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(k.created_at, locale)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Reusable form for create / edit ────────────────────────────────────
interface UserFormProps {
  form: {
    username: string;
    password: string;
    role: string;
    full_name: string;
    email: string;
    weight: number | string;
    is_active?: boolean;
  };
  onChange: (v: UserFormProps['form']) => void;
  roleOptions: string[];
  passwordRequired: boolean;
  showActive?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function UserForm({ form, onChange, roleOptions, passwordRequired, showActive, t }: UserFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">{t('auth.username')} *</Label>
        <Input
          value={form.username}
          onChange={(e) => onChange({ ...form, username: e.target.value })}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          {t('auth.password')}{passwordRequired ? ' *' : ` (${t('management.users_new_password_hint')})`}
        </Label>
        <Input
          type="password"
          value={form.password}
          onChange={(e) => onChange({ ...form, password: e.target.value })}
          className="h-8 text-sm"
          placeholder={passwordRequired ? '' : '••••••••'}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('management.users_full_name')}</Label>
          <Input
            value={form.full_name}
            onChange={(e) => onChange({ ...form, full_name: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('management.users_email')}</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('profile.role')}</Label>
          <Select value={form.role} onValueChange={(v) => onChange({ ...form, role: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roleOptions.map(r => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('management.users_weight')}</Label>
          <Input
            type="number"
            value={form.weight}
            onChange={(e) => onChange({ ...form, weight: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>
      {showActive && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="user-active"
            checked={form.is_active ?? true}
            onCheckedChange={(v) => onChange({ ...form, is_active: v === true })}
          />
          <Label htmlFor="user-active" className="text-xs cursor-pointer">{t('common.active')}</Label>
        </div>
      )}
    </div>
  );
}
