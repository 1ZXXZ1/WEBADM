'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, RefreshCw, Loader2, Trash2, Pencil,
  Power, PowerOff, KeyRound, Eye, Shield, Lock, Search, Users, Copy, Check,
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
  mgmtRolesApi, mgmtPermissionsApi, getErrorMessage,
  type MgmtRole, type MgmtUser, type MgmtApiKey, type PermissionsByCategory,
} from '@/lib/api-mgmt';
import { fmtDate, fmtAgo, isActive, isExpired } from './mgmt-utils';
import ScrollableTable from './ScrollableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface RolesTabProps {
  roles: MgmtRole[];
  loading: boolean;
  onReload: () => void;
  users: MgmtUser[];
}

export default function RolesTab({ roles, loading, onReload, users }: RolesTabProps) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  // Permission catalog (loaded once)
  const [permCatalog, setPermCatalog] = useState<PermissionsByCategory>({});
  const [permTotal, setPermTotal] = useState(0);
  const [permLoading, setPermLoading] = useState(false);

  // Create / Edit dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<MgmtRole | null>(null);
  const [roleDetails, setRoleDetails] = useState<MgmtRole | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Gen-key / view users / view keys dialogs
  const [genKeyRole, setGenKeyRole] = useState<MgmtRole | null>(null);
  const [viewUsersRole, setViewUsersRole] = useState<MgmtRole | null>(null);
  const [viewKeysRole, setViewKeysRole] = useState<MgmtRole | null>(null);

  // Forms
  const emptyRole = { name: '', description: '', permissions: [] as string[], weight: 0 };
  const [newRole, setNewRole] = useState({ ...emptyRole });
  const [editForm, setEditForm] = useState({ ...emptyRole, is_active: true });

  // Permission editor state (for both create and edit)
  const [permSearch, setPermSearch] = useState('');

  // Load permissions catalog
  const loadPermissions = useCallback(async () => {
    setPermLoading(true);
    try {
      const { categories, total } = await mgmtPermissionsApi.list();
      setPermCatalog(categories);
      setPermTotal(total);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadPermissions')));
    } finally {
      setPermLoading(false);
    }
  }, [t]);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  // Filtered permissions based on search
  const filteredCatalog = useMemo(() => {
    if (!permSearch.trim()) return permCatalog;
    const q = permSearch.trim().toLowerCase();
    const out: PermissionsByCategory = {};
    for (const [cat, perms] of Object.entries(permCatalog)) {
      const filtered = perms.filter(p => p.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [permCatalog, permSearch]);

  // ── Create ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    try {
      await mgmtRolesApi.create({
        name: newRole.name,
        description: newRole.description || undefined,
        permissions: newRole.permissions,
        weight: Number(newRole.weight) || 0,
      });
      toast.success(t('management.roleCreated'));
      setCreateOpen(false);
      setNewRole({ ...emptyRole });
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedCreateRole')));
    }
  }, [newRole, onReload, t]);

  // ── View role details ───────────────────────────────────────────────
  const openDetails = useCallback(async (r: MgmtRole) => {
    setDetailsOpen(true);
    setRoleDetails(null);
    try {
      const data = await mgmtRolesApi.get(r.name);
      setRoleDetails(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadRoleDetails')));
    }
  }, [t]);

  // ── Edit ────────────────────────────────────────────────────────────
  const openEdit = useCallback(async (r: MgmtRole) => {
    try {
      const data = await mgmtRolesApi.get(r.name);
      setEditForm({
        name: data.name,
        description: data.description ?? '',
        permissions: data.permissions,
        weight: data.weight ?? 0,
        is_active: isActive(data.is_active),
      });
      setEditRole(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadRoleDetails')));
    }
  }, [t]);

  const handleUpdate = useCallback(async () => {
    if (!editRole) return;
    try {
      await mgmtRolesApi.update(editRole.name, {
        name: editForm.name,
        description: editForm.description || undefined,
        permissions: editForm.permissions,
        weight: Number(editForm.weight) || 0,
        is_active: editForm.is_active,
      });
      toast.success(t('management.roles_updated'));
      setEditRole(null);
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.roles_failed_update')));
    }
  }, [editRole, editForm, onReload, t]);

  // ── Enable / Disable / Delete ───────────────────────────────────────
  const handleEnable = useCallback(async (r: MgmtRole) => {
    try {
      await mgmtRolesApi.enable(r.name);
      toast.success(t('management.roles_enabled', { name: r.name }));
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.roles_failed_enable')));
    }
  }, [onReload, t]);

  const handleDisable = useCallback(async (r: MgmtRole) => {
    try {
      await mgmtRolesApi.disable(r.name);
      toast.success(t('management.roles_disabled', { name: r.name }));
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.roles_failed_disable')));
    }
  }, [onReload, t]);

  const handleDelete = useCallback(async (r: MgmtRole) => {
    if (!confirm(t('management.roles_confirm_delete', { name: r.name }))) return;
    try {
      await mgmtRolesApi.delete(r.name);
      toast.success(t('management.roles_deleted', { name: r.name }));
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.roles_failed_delete')));
    }
  }, [onReload, t]);

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 md:gap-2 flex-wrap">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('management.createRole')}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] md:max-w-2xl md:max-h-[85vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
            <DialogHeader className="px-4 md:px-6 pt-6 pb-3 border-b flex-shrink-0">
              <DialogTitle>{t('management.createRole')}</DialogTitle>
              <DialogDescription className="sr-only">{t('management.createRole')}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
              <RoleForm
                form={newRole}
                onChange={setNewRole}
                permCatalog={filteredCatalog}
                permTotal={permTotal}
                permLoading={permLoading}
                permSearch={permSearch}
                onPermSearchChange={setPermSearch}
                showActive={false}
                t={t}
              />
            </div>
            <DialogFooter className="px-4 md:px-6 py-4 border-t bg-background flex-shrink-0">
              <Button variant="outline" onClick={() => setCreateOpen(false)} className="mr-auto">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={!newRole.name} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                <span className="hidden sm:inline">{t('management.createRole')}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => { onReload(); loadPermissions(); }} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>
      </div>

      {/* Mobile card view */}
      {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : roles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : roles.map((r, i) => {
            const active = isActive(r.is_active);
            return (
              <Card key={`m-${r.name}`} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-7 h-7 rounded bg-purple-500/10 flex items-center justify-center">
                    <Shield className={`w-3.5 h-3.5 ${r.is_builtin ? 'text-blue-400' : 'text-purple-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm truncate">{r.name}</span>
                      <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                      <Badge variant={active ? 'default' : 'secondary'} className="text-[10px]">
                        {active ? t('management.roles_active') : t('management.roles_inactive')}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.is_builtin ? t('management.roles_builtin') : t('management.roles_custom')}
                    </div>
                    {r.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{r.description}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{t('management.roles_weight')}: {r.weight ?? 0}</span>
                      <span>{t('management.roles_permissions_count', { count: r.permissions.length })}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t('management.roles_created_at')}: {fmtDate(r.created_at, locale)}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 mt-2 pt-2 border-t justify-end flex-wrap">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetails(r)} title={t('common.show')}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)} title={t('management.roles_edit')}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setGenKeyRole(r)} title={t('management.roles_gen_key')}>
                    <KeyRound className="w-4 h-4 text-blue-400" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewUsersRole(r)} title={t('management.roles_view_users')}>
                    <Users className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewKeysRole(r)} title={t('management.roles_view_keys')}>
                    <KeyRound className="w-4 h-4 text-purple-400" />
                  </Button>
                  {!r.is_builtin && (
                    <>
                      {active ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDisable(r)} title={t('management.roles_disable')}>
                          <PowerOff className="w-4 h-4 text-amber-500" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEnable(r)} title={t('management.roles_enable')}>
                          <Power className="w-4 h-4 text-emerald-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(r)} title={t('management.roles_delete')}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </>
                  )}
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
                  <TableHead className="w-12 sticky top-0 bg-card z-10">ID</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.name')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.description')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.permissions')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.roles_weight')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.roles_created_at')}</TableHead>
                  <TableHead className="w-48 sticky top-0 bg-card z-10">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : roles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {t('common.noData')}
                    </TableCell>
                  </TableRow>
                ) : roles.map((r, i) => {
                  const active = isActive(r.is_active);
                  return (
                    <TableRow key={r.name} className="group">
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Shield className={`w-4 h-4 ${r.is_builtin ? 'text-blue-400' : 'text-purple-400'}`} />
                          <div>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {r.is_builtin ? t('management.roles_builtin') : t('management.roles_custom')}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.description || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {t('management.roles_permissions_count', { count: r.permissions.length })}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={active ? 'default' : 'secondary'} className="text-xs">
                          {active ? t('management.roles_active') : t('management.roles_inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.weight ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.created_at, locale)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetails(r)} title={t('common.show')}>
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} title={t('management.roles_edit')}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGenKeyRole(r)} title={t('management.roles_gen_key')}>
                            <KeyRound className="w-3 h-3 text-blue-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewUsersRole(r)} title={t('management.roles_view_users')}>
                            <Users className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewKeysRole(r)} title={t('management.roles_view_keys')}>
                            <KeyRound className="w-3 h-3 text-purple-400" />
                          </Button>
                          {!r.is_builtin && (
                            <>
                              {active ? (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDisable(r)} title={t('management.roles_disable')}>
                                  <PowerOff className="w-3 h-3 text-amber-500" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEnable(r)} title={t('management.roles_enable')}>
                                  <Power className="w-3 h-3 text-emerald-500" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(r)} title={t('management.roles_delete')}>
                                <Trash2 className="w-3 h-3 text-red-500" />
                              </Button>
                            </>
                          )}
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

      {/* Role details dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {roleDetails?.name ?? '…'}
            </DialogTitle>
            <DialogDescription className="sr-only">{roleDetails?.name ?? ''}</DialogDescription>
          </DialogHeader>
          {roleDetails ? (
            <ScrollableTable maxHeight="60vh" className="border-0">
              <div className="space-y-3 p-1">
                {roleDetails.description && (
                  <p className="text-sm text-muted-foreground">{roleDetails.description}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{roleDetails.is_builtin ? t('management.roles_builtin') : t('management.roles_custom')}</Badge>
                  <Badge variant={isActive(roleDetails.is_active) ? 'default' : 'secondary'}>
                    {isActive(roleDetails.is_active) ? t('management.roles_active') : t('management.roles_inactive')}
                  </Badge>
                  <Badge variant="outline">{t('management.roles_weight')}: {roleDetails.weight ?? 0}</Badge>
                  <Badge variant="outline">{t('management.roles_permissions_count', { count: roleDetails.permissions.length })}</Badge>
                </div>
                <div>
                  <Label className="text-xs font-bold mb-2 block">{t('management.permissions')}</Label>
                  <div className="flex flex-wrap gap-1">
                    {roleDetails.permissions.map((perm, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs font-mono">{perm}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollableTable>
          ) : (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editRole} onOpenChange={(open) => !open && setEditRole(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl md:max-h-[85vh] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-4 md:px-6 pt-6 pb-3 border-b flex-shrink-0">
            <DialogTitle>{t('management.roles_edit')} «{editRole?.name}»</DialogTitle>
            <DialogDescription className="sr-only">{t('management.roles_edit')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
            <RoleForm
              form={editForm}
              onChange={(v) => setEditForm(v as typeof editForm)}
              permCatalog={filteredCatalog}
              permTotal={permTotal}
              permLoading={permLoading}
              permSearch={permSearch}
              onPermSearchChange={setPermSearch}
              showActive
              t={t}
            />
          </div>
          <DialogFooter className="px-4 md:px-6 py-4 border-t bg-background flex-shrink-0">
            <Button variant="outline" onClick={() => setEditRole(null)} className="mr-auto">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate key for role */}
      {genKeyRole && (
        <GenKeyDialog
          role={genKeyRole}
          users={users}
          onClose={() => setGenKeyRole(null)}
          t={t}
        />
      )}

      {/* View role users */}
      {viewUsersRole && (
        <RoleUsersDialog role={viewUsersRole} locale={locale} onClose={() => setViewUsersRole(null)} t={t} />
      )}

      {/* View role keys */}
      {viewKeysRole && (
        <RoleKeysDialog role={viewKeysRole} locale={locale} onClose={() => setViewKeysRole(null)} t={t} />
      )}
    </div>
  );
}

// ── Reusable form for create / edit ────────────────────────────────────
interface RoleFormProps {
  form: {
    name: string;
    description: string;
    permissions: string[];
    weight: number | string;
    is_active?: boolean;
  };
  onChange: (v: RoleFormProps['form']) => void;
  permCatalog: PermissionsByCategory;
  permTotal: number;
  permLoading: boolean;
  permSearch: string;
  onPermSearchChange: (v: string) => void;
  showActive: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function RoleForm({ form, onChange, permCatalog, permTotal, permLoading, permSearch, onPermSearchChange, showActive, t }: RoleFormProps) {
  const togglePerm = (perm: string) => {
    onChange({
      ...form,
      permissions: form.permissions.includes(perm)
        ? form.permissions.filter(p => p !== perm)
        : [...form.permissions, perm],
    });
  };

  const toggleCategory = (cat: string, perms: string[]) => {
    const allSelected = perms.every(p => form.permissions.includes(p));
    if (allSelected) {
      onChange({ ...form, permissions: form.permissions.filter(p => !perms.includes(p)) });
    } else {
      onChange({ ...form, permissions: [...new Set([...form.permissions, ...perms])] });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 space-y-1">
          <Label className="text-xs">{t('common.name')} *</Label>
          <Input
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            className="h-8 text-sm"
            placeholder={t('management.roleNamePlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('management.roles_weight')}</Label>
          <Input
            type="number"
            value={form.weight}
            onChange={(e) => onChange({ ...form, weight: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('common.description')}</Label>
        <Input
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          className="h-8 text-sm"
          placeholder={t('management.roleDescriptionPlaceholder')}
        />
      </div>
      {showActive && (
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.is_active ?? true}
            onCheckedChange={(v) => onChange({ ...form, is_active: v === true })}
          />
          <span className="text-xs">{t('common.active')}</span>
        </label>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">{t('management.permissions')}</Label>
          <Badge variant="outline" className="text-xs">
            {t('management.perms_assigned_count', { count: form.permissions.length })}
          </Badge>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {t('management.perms_total', { count: permTotal })}
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={permSearch}
            onChange={(e) => onPermSearchChange(e.target.value)}
            placeholder={t('management.perms_search')}
            className="h-8 text-xs pl-7"
          />
        </div>
        {permLoading ? (
          <p className="text-xs text-muted-foreground py-2">{t('management.loadingPermissions')}</p>
        ) : Object.keys(permCatalog).length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{t('common.noData')}</p>
        ) : (
          <ScrollableTable maxHeight="18rem" className="rounded-md">
            <div className="space-y-2 p-2">
              {Object.entries(permCatalog).map(([cat, perms]) => {
                const allSel = perms.every(p => form.permissions.includes(p));
                const someSel = perms.some(p => form.permissions.includes(p));
                return (
                  <div key={cat}>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
                      <Lock className="w-3 h-3" />
                      <span className="font-mono">{cat}</span>
                      <Badge variant="outline" className="text-[10px] ml-1">{perms.length}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 text-[10px] px-1 ml-auto"
                        onClick={() => toggleCategory(cat, perms)}
                      >
                        {allSel ? t('management.deselectAll') : t('management.selectAll')}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {perms.map((perm) => {
                        const isSel = form.permissions.includes(perm);
                        return (
                          <button
                            key={perm}
                            onClick={() => togglePerm(perm)}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                              isSel
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                                : 'border-border hover:border-emerald-500/30 text-muted-foreground'
                            }`}
                          >
                            {perm}
                          </button>
                        );
                      })}
                    </div>
                    {someSel && !allSel && (
                      <div className="text-[9px] text-amber-500 mt-1">⏵ partial</div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollableTable>
        )}
      </div>
    </div>
  );
}

// ── Generate key dialog ────────────────────────────────────────────────
function GenKeyDialog({
  role, users, onClose, t,
}: {
  role: MgmtRole;
  users: MgmtUser[];
  onClose: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [form, setForm] = useState({
    user_id: '', name: '', description: '', expires_days: 30, weight: 0,
  });
  const [generated, setGenerated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGen = useCallback(async () => {
    setLoading(true);
    try {
      // Backend rejects 0 / missing expires_days — send a sensible default (30d)
      // or null when the user explicitly clears the field.
      const expiresDays = form.expires_days
        ? Number(form.expires_days)
        : null;
      const payload: Parameters<typeof mgmtRolesApi.genKey>[1] = {
        user_id: Number(form.user_id),
        name: form.name,
        weight: Number(form.weight) || 0,
      };
      if (form.description) payload.description = form.description;
      if (expiresDays !== null) payload.expires_days = expiresDays;
      const result = await mgmtRolesApi.genKey(role.name, payload);
      setGenerated(result.key);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedCreateKey')));
    } finally {
      setLoading(false);
    }
  }, [role.name, form, t]);

  const copyGen = useCallback(async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      toast.success(t('management.keyCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(safeToastMessage(undefined, t('management.failedCopy')));
    }
  }, [generated, t]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('management.roles_gen_key_dialog', { role: role.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t('management.roles_gen_key_dialog', { role: role.name })}</DialogDescription>
        </DialogHeader>
        {generated ? (
          <div className="space-y-3">
            <div className="p-3 bg-muted rounded-lg">
              <Label className="text-xs font-bold text-amber-500">{t('management.keyWarning')}</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-xs font-mono break-all flex-1 bg-background p-2 rounded border">
                  {generated}
                </code>
                <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={copyGen}>
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={onClose}>{t('common.close')}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('management.userId')} *</Label>
              <Select value={form.user_id} onValueChange={(v) => setForm(p => ({ ...p, user_id: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>#{u.id} {u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('common.name')} *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.keys_description')}</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('management.keys_expires_days')}</Label>
                <Input
                  type="number"
                  value={form.expires_days}
                  onChange={(e) => setForm(p => ({ ...p, expires_days: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('management.keys_weight')}</Label>
                <Input
                  type="number"
                  value={form.weight}
                  onChange={(e) => setForm(p => ({ ...p, weight: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button onClick={handleGen} disabled={!form.user_id || !form.name || loading}>
                {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {t('management.roles_gen_key')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── View role users ────────────────────────────────────────────────────
function RoleUsersDialog({
  role, locale, onClose, t,
}: {
  role: MgmtRole;
  locale: string;
  onClose: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [users, setUsers] = useState<MgmtUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmtRolesApi.users(role.name, includeInactive);
      setUsers(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadUsers')));
    } finally {
      setLoading(false);
    }
  }, [role.name, includeInactive, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="mgmt-resizable max-w-[95vw] md:max-w-[98vw] md:w-[1200px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            {t('management.roles_role_users', { role: role.name })}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('management.roles_role_users', { role: role.name })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={includeInactive} onCheckedChange={(v) => setIncludeInactive(v === true)} />
              {t('management.roles_include_disabled')}
            </label>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground italic">{t('management.users_keys_resize_hint')}</span>
        </div>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('management.roles_no_users')}</p>
        ) : (
          <ScrollableTable maxHeight="calc(92vh - 220px)">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 sticky top-0 bg-card z-10">ID</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('auth.username')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_full_name')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_email')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_last_login')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.users_login_count')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => {
                  const a = isActive(u.is_active);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell className="text-sm">{u.full_name || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.email || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={a ? 'default' : 'secondary'} className="text-xs">
                          {a ? t('common.active') : t('common.disabled')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {u.last_login_at ? fmtAgo(u.last_login_at, locale) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.login_count ?? 0}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── View role keys ─────────────────────────────────────────────────────
function RoleKeysDialog({
  role, locale, onClose, t,
}: {
  role: MgmtRole;
  locale: string;
  onClose: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [keys, setKeys] = useState<MgmtApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmtRolesApi.keys(role.name, includeInactive);
      setKeys(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadKeys')));
    } finally {
      setLoading(false);
    }
  }, [role.name, includeInactive, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="mgmt-resizable max-w-[95vw] md:max-w-[98vw] md:w-[1200px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-purple-400" />
            {t('management.roles_role_keys', { role: role.name })}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('management.roles_role_keys', { role: role.name })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={includeInactive} onCheckedChange={(v) => setIncludeInactive(v === true)} />
              {t('management.roles_include_disabled')}
            </label>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground italic">{t('management.users_keys_resize_hint')}</span>
        </div>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('management.roles_no_keys')}</p>
        ) : (
          <ScrollableTable maxHeight="calc(92vh - 220px)">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 sticky top-0 bg-card z-10">ID</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_key_prefix')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.name')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_description')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.userId')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_weight')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_expires_at')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_last_used_at')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map(k => {
                  const a = isActive(k.is_active);
                  const exp = isExpired(k);
                  return (
                    <TableRow key={k.id}>
                      <TableCell className="text-xs text-muted-foreground">{k.id}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{k.key_prefix}</TableCell>
                      <TableCell className="text-sm">{k.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{k.description || '—'}</TableCell>
                      <TableCell className="text-xs">#{k.user_id}</TableCell>
                      <TableCell>
                        <Badge variant={a && !exp ? 'default' : 'secondary'} className="text-xs">
                          {!a ? t('common.disabled') : exp ? t('management.keys_expired') : t('common.active')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{k.weight ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {k.expires_at ? fmtDate(k.expires_at, locale) : t('management.keys_never_expires')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {k.last_used_at ? fmtAgo(k.last_used_at, locale) : t('management.keys_never_used')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Local helper removed — using lucide-react's Users icon directly.

