'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, RefreshCw, Loader2, Trash2, Pencil,
  Power, PowerOff, RotateCw, Ban, Copy, Check, ShieldAlert,
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
  mgmtKeysApi, getErrorMessage,
  type MgmtApiKey, type MgmtUser,
} from '@/lib/api-mgmt';
import { fmtDate, fmtAgo, isActive, isExpired } from './mgmt-utils';
import ScrollableTable from './ScrollableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface KeysTabProps {
  roleOptions: string[];
  users: MgmtUser[];
}

export default function KeysTab({ roleOptions, users }: KeysTabProps) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [keys, setKeys] = useState<MgmtApiKey[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState<string>('__any__');
  const [activeFilter, setActiveFilter] = useState<string>('__all__');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [pageSize, setPageSize] = useState(100);

  // Create / Edit / Rotate
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [editKey, setEditKey] = useState<MgmtApiKey | null>(null);
  const [rotatedKey, setRotatedKey] = useState<{ key: MgmtApiKey; value: string } | null>(null);

  // Bulk
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const emptyNew = {
    user_id: '',
    name: '',
    role: 'operator',
    description: '',
    expires_days: 0,
    weight: 0,
  };
  const [newKey, setNewKey] = useState({ ...emptyNew });
  const [editForm, setEditForm] = useState({
    name: '', role: 'operator', description: '',
    is_active: true, expires_days: 0, weight: 0,
  });

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof mgmtKeysApi.list>[0] = {
        include_inactive: includeInactive,
        offset: 0,
        limit: pageSize,
      };
      if (userFilter !== '__any__') params.user_id = Number(userFilter);
      let data = await mgmtKeysApi.list(params);

      // Client-side filtering for active / search (server supports include_inactive only)
      if (activeFilter === 'active') {
        data = data.filter(k => isActive(k.is_active) && !isExpired(k));
      } else if (activeFilter === 'inactive') {
        data = data.filter(k => !isActive(k.is_active) || isExpired(k));
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        data = data.filter(k =>
          k.name?.toLowerCase().includes(q) ||
          k.key_prefix?.toLowerCase().includes(q) ||
          k.description?.toLowerCase().includes(q) ||
          k.role?.toLowerCase().includes(q)
        );
      }
      setKeys(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadKeys')));
    } finally {
      setLoading(false);
    }
  }, [search, userFilter, activeFilter, includeInactive, pageSize, t]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  // ── Create ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    try {
      const result = await mgmtKeysApi.create({
        user_id: Number(newKey.user_id),
        name: newKey.name,
        role: newKey.role,
        description: newKey.description || undefined,
        expires_days: newKey.expires_days ? Number(newKey.expires_days) : undefined,
        weight: Number(newKey.weight) || 0,
      });
      setCreatedKey(result.key);
      setKeyCopied(false);
      toast.success(t('management.keyCreated') + ' — ' + t('management.keyWarning').toLowerCase());
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedCreateKey')));
    }
  }, [newKey, loadKeys, t]);

  // ── Edit ────────────────────────────────────────────────────────────
  const openEdit = useCallback((k: MgmtApiKey) => {
    setEditForm({
      name: k.name,
      role: k.role,
      description: k.description ?? '',
      is_active: isActive(k.is_active),
      expires_days: k.expires_at
        ? Math.max(1, Math.ceil((new Date(k.expires_at).getTime() - Date.now()) / 86_400_000))
        : 0,
      weight: k.weight ?? 0,
    });
    setEditKey(k);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editKey) return;
    try {
      await mgmtKeysApi.update(editKey.id, {
        name: editForm.name,
        role: editForm.role,
        description: editForm.description || undefined,
        is_active: editForm.is_active,
        expires_days: editForm.expires_days ? Number(editForm.expires_days) : undefined,
        weight: Number(editForm.weight) || 0,
      });
      toast.success(t('management.keys_updated'));
      setEditKey(null);
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_update')));
    }
  }, [editKey, editForm, loadKeys, t]);

  // ── Enable / Disable / Purge / Rotate ───────────────────────────────
  const handleEnable = useCallback(async (k: MgmtApiKey) => {
    try {
      await mgmtKeysApi.enable(k.id);
      toast.success(t('management.keys_enabled'));
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_enable')));
    }
  }, [loadKeys, t]);

  const handleDisable = useCallback(async (k: MgmtApiKey) => {
    try {
      await mgmtKeysApi.disable(k.id);
      // Show a prominent warning toast — "key was disabled by administrator"
      // styled like the 500-error toast (amber/orange, longer duration, with
      // icon) so the user understands the action is irreversible from the
      // owning user's side without admin help.
      toast.warning(
        `${t('management.keys_revoked_banner_title')} — ${k.name} (#${k.id})`,
        {
          description: t('management.keys_revoked_tooltip'),
          duration: 6000,
          icon: <ShieldAlert className="w-4 h-4" />,
        }
      );
      toast.success(t('management.keys_disabled'));
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_disable')));
    }
  }, [loadKeys, t]);

  const handlePurge = useCallback(async (k: MgmtApiKey) => {
    if (!confirm(t('management.keys_confirm_purge', { id: k.id, name: k.name }))) return;
    try {
      await mgmtKeysApi.purge(k.id);
      toast.success(t('management.keys_purged', { id: k.id }));
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_purge')));
    }
  }, [loadKeys, t]);

  const handleSoftDelete = useCallback(async (k: MgmtApiKey) => {
    try {
      await mgmtKeysApi.delete(k.id, false);
      toast.success(t('management.keyDeactivated'));
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedDeleteKey')));
    }
  }, [loadKeys, t]);

  const handleRotate = useCallback(async (k: MgmtApiKey) => {
    if (!confirm(t('management.keys_confirm_rotate', { id: k.id, name: k.name }))) return;
    try {
      const result = await mgmtKeysApi.rotate(k.id);
      setRotatedKey({ key: k, value: result.key });
      toast.success(t('management.keys_rotated'));
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_rotate')));
    }
  }, [loadKeys, t]);

  // ── Copy ────────────────────────────────────────────────────────────
  const copyKey = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setKeyCopied(true);
      toast.success(t('management.keyCopied'));
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      toast.error(safeToastMessage(undefined, t('management.failedCopy')));
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
      if (prev.size === keys.length) return new Set();
      return new Set(keys.map(k => k.id));
    });
  }, [keys]);

  const handleBulk = useCallback(async (action: 'enable' | 'disable' | 'purge') => {
    if (selected.size === 0) return;
    if (!confirm(t('management.keys_confirm_bulk', { action, count: selected.size }))) return;
    try {
      const result = await mgmtKeysApi.bulk([...selected], action);
      toast.success(t('management.keys_bulk_success', {
        count: result.ok.length,
        failed: result.failed.length,
      }));
      setSelected(new Set());
      loadKeys();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.keys_failed_bulk')));
    }
  }, [selected, loadKeys, t]);

  const allChecked = keys.length > 0 && selected.size === keys.length;
  const someChecked = selected.size > 0 && selected.size < keys.length;
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  // user_id -> username map for nicer display
  const userMap = useMemo(() => {
    const m = new Map<number, string>();
    users.forEach(u => m.set(u.id, u.username));
    return m;
  }, [users]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 md:gap-2">
        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreatedKey(null);
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('management.createKey')}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
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
                    <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => copyKey(createdKey)}>
                      {keyCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => { setCreatedKey(null); setCreateOpen(false); }}>
                  {t('common.close')}
                </Button>
              </div>
            ) : (
              <>
                <KeyForm
                  form={newKey}
                  onChange={setNewKey}
                  roleOptions={roleOptions}
                  users={users}
                  t={t}
                />
                <Button onClick={handleCreate} disabled={!newKey.user_id || !newKey.name} className="w-full">
                  {t('management.createKey')}
                </Button>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Input
          placeholder={t('management.keys_search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadKeys(); }}
          className="h-8 md:h-9 w-full sm:max-w-xs text-sm"
        />

        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-48 text-xs">
            <SelectValue placeholder={t('management.keys_user_filter_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">{t('management.keys_user_filter_placeholder')}</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={String(u.id)}>
                #{u.id} {u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('management.keys_all')}</SelectItem>
            <SelectItem value="active">{t('management.keys_active_only')}</SelectItem>
            <SelectItem value="inactive">{t('management.keys_inactive_only')}</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(v) => setIncludeInactive(v === true)}
          />
          {t('management.keys_include_inactive')}
        </label>

        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[50, 100, 200, 500].map(n => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={loadKeys} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>

        <div className="flex-1" />

        {selected.size > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted w-full sm:w-auto">
            <span className="text-xs text-muted-foreground mr-1">
              {selected.size} {t('common.selected')}
            </span>
            <Button size="sm" variant="outline" onClick={() => handleBulk('enable')} className="h-7 px-2 text-xs">
              <Power className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.keys_bulk_enable')}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulk('disable')} className="h-7 px-2 text-xs">
              <PowerOff className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.keys_bulk_disable')}</span>
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleBulk('purge')} className="h-7 px-2 text-xs">
              <Trash2 className="w-3 h-3 md:mr-1" />
              <span className="hidden sm:inline">{t('management.users_purge')}</span>
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
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : keys.map((k) => {
            const a = isActive(k.is_active);
            const exp = isExpired(k);
            const checked = selected.has(k.id);
            return (
              <Card key={`m-${k.id}`} className="p-3">
                <div className="flex items-start gap-2">
                  <Checkbox checked={checked} onCheckedChange={() => toggleSelected(k.id)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm truncate">{k.name}</span>
                      <Badge variant="outline" className="text-[10px]">#{k.id}</Badge>
                      <Badge variant="outline" className="text-[10px]">{k.role}</Badge>
                      <Badge variant={a && !exp ? 'default' : 'secondary'} className="text-[10px]">
                        {!a ? t('common.disabled') : exp ? t('management.keys_expired') : t('common.active')}
                      </Badge>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">
                      {k.key_prefix}
                    </div>
                    {k.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{k.description}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {t('management.userId')}: #{k.user_id}{userMap.get(k.user_id) ? ` ${userMap.get(k.user_id)}` : ''}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{t('management.keys_weight')}: {k.weight ?? 0}</span>
                      <span className="truncate">{t('management.keys_expires_at')}: {k.expires_at ? fmtDate(k.expires_at, locale) : t('management.keys_never_expires')}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t('management.keys_last_used_at')}: {k.last_used_at ? fmtAgo(k.last_used_at, locale) : t('management.keys_never_used')}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 mt-2 pt-2 border-t justify-end flex-wrap">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(k)} title={t('management.keys_edit')}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRotate(k)} title={t('management.keys_rotate')}>
                    <RotateCw className="w-4 h-4 text-blue-400" />
                  </Button>
                  {a ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDisable(k)} title={t('management.keys_disable')}>
                      <PowerOff className="w-4 h-4 text-amber-500" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEnable(k)} title={t('management.keys_enable')}>
                      <Power className="w-4 h-4 text-emerald-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSoftDelete(k)} title={t('management.keys_soft_delete')}>
                    <Ban className="w-4 h-4 text-orange-400" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePurge(k)} title={t('management.keys_purge')}>
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
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_key_prefix')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.name')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.userId')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('profile.role')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('common.status')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_weight')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_expires_at')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_last_used_at')}</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.keys_created_at')}</TableHead>
                  <TableHead className="w-40 sticky top-0 bg-card z-10">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      {t('common.noData')}
                    </TableCell>
                  </TableRow>
                ) : keys.map((k) => {
                  const a = isActive(k.is_active);
                  const exp = isExpired(k);
                  const checked = selected.has(k.id);
                  return (
                    <TableRow key={k.id} className="group">
                      <TableCell>
                        <Checkbox checked={checked} onCheckedChange={() => toggleSelected(k.id)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{k.id}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{k.key_prefix}</TableCell>
                      <TableCell className="font-medium">
                        {k.name}
                        {k.description ? (
                          <div className="text-[10px] text-muted-foreground font-normal">{k.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-muted-foreground">#{k.user_id}</span>
                        {userMap.get(k.user_id) ? ` ${userMap.get(k.user_id)}` : ''}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{k.role}</Badge></TableCell>
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
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(k.created_at, locale)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(k)} title={t('management.keys_edit')}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRotate(k)} title={t('management.keys_rotate')}>
                            <RotateCw className="w-3 h-3 text-blue-400" />
                          </Button>
                          {a ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDisable(k)} title={t('management.keys_disable')}>
                              <PowerOff className="w-3 h-3 text-amber-500" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEnable(k)} title={t('management.keys_enable')}>
                              <Power className="w-3 h-3 text-emerald-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSoftDelete(k)} title={t('management.keys_soft_delete')}>
                            <Ban className="w-3 h-3 text-orange-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePurge(k)} title={t('management.keys_purge')}>
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
      <Dialog open={!!editKey} onOpenChange={(open) => !open && setEditKey(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('management.keys_edit')} #{editKey?.id}</DialogTitle>
            <DialogDescription className="sr-only">{t('management.keys_edit')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('common.name')} *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.keys_description')}</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm(p => ({ ...p, description: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('profile.role')}</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm(p => ({ ...p, role: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('management.keys_weight')}</Label>
                <Input
                  type="number"
                  value={editForm.weight}
                  onChange={(e) => setEditForm(p => ({ ...p, weight: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('management.keys_expires_days')}</Label>
                <Input
                  type="number"
                  value={editForm.expires_days}
                  onChange={(e) => setEditForm(p => ({ ...p, expires_days: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">{t('management.keys_expires_days_hint')}</p>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={editForm.is_active}
                    onCheckedChange={(v) => setEditForm(p => ({ ...p, is_active: v === true }))}
                  />
                  <span className="text-xs">{t('common.active')}</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditKey(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleUpdate}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotated key dialog */}
      <Dialog open={!!rotatedKey} onOpenChange={(open) => !open && setRotatedKey(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('management.keys_rotate')} #{rotatedKey?.key.id}</DialogTitle>
            <DialogDescription className="sr-only">{t('management.keys_rotated')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 bg-muted rounded-lg">
              <Label className="text-xs font-bold text-amber-500">{t('management.keyWarning')}</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-xs font-mono break-all flex-1 bg-background p-2 rounded border">
                  {rotatedKey?.value}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => rotatedKey && copyKey(rotatedKey.value)}
                >
                  {keyCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setRotatedKey(null)}>
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Reusable create form ───────────────────────────────────────────────
interface KeyFormProps {
  form: {
    user_id: string;
    name: string;
    role: string;
    description: string;
    expires_days: number | string;
    weight: number | string;
  };
  onChange: (v: KeyFormProps['form']) => void;
  roleOptions: string[];
  users: MgmtUser[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function KeyForm({ form, onChange, roleOptions, users, t }: KeyFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">{t('management.userId')} *</Label>
        <Select
          value={form.user_id}
          onValueChange={(v) => onChange({ ...form, user_id: v })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {users.map(u => (
              <SelectItem key={u.id} value={String(u.id)}>
                #{u.id} {u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('common.name')} *</Label>
        <Input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          className="h-8 text-sm"
          placeholder="My API Key"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('management.keys_description')}</Label>
        <Input
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          className="h-8 text-sm"
        />
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
          <Label className="text-xs">{t('management.keys_weight')}</Label>
          <Input
            type="number"
            value={form.weight}
            onChange={(e) => onChange({ ...form, weight: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t('management.keys_expires_days')}</Label>
        <Input
          type="number"
          value={form.expires_days}
          onChange={(e) => onChange({ ...form, expires_days: e.target.value })}
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-muted-foreground">{t('management.keys_expires_days_hint')}</p>
      </div>
    </div>
  );
}
