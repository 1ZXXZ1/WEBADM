'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import { getErrorMessage } from '@/lib/api';
import {
  Ban, Unlock, Trash2, Plus, RefreshCw, Loader2, Eye, Shield, ShieldCheck,
  Clock, User, KeyRound, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface BanRecord {
  id: number;
  target_type: string;
  target_name: string;
  target_id?: number | null;
  reason: string;
  banned_by: string;
  banned_by_ip: string;
  created_at: string;
  expires_at: string | null;
  lifted_at: string | null;
  lifted_by: string | null;
  lifted_reason: string | null;
  is_active: boolean;
}

interface BanListResponse {
  status: string;
  total: number;
  active: number;
  bans: BanRecord[];
}

/**
 * BAN/UNBAN tab — manage user/API-key bans.
 * Backend endpoints:
 *   POST   /api/v1/ban                    — create ban
 *   POST   /api/v1/ban/unban              — lift ban
 *   GET    /api/v1/ban                    — list bans (?active=&limit=&offset=)
 *   GET    /api/v1/ban/{id}               — show ban
 *   GET    /api/v1/ban/check/{type}/{name} — check if banned
 *   DELETE /api/v1/ban/{id}               — hard-delete record
 */
export default function BanManagementTab() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  const [bans, setBans] = useState<BanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBan, setNewBan] = useState({
    target_type: 'user',
    target_name: '',
    reason: '',
    duration_minutes: 0,
  });
  const [creating, setCreating] = useState(false);

  // Unban dialog
  const [unbanDialogOpen, setUnbanDialogOpen] = useState(false);
  const [unbanTarget, setUnbanTarget] = useState<BanRecord | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanning, setUnbanning] = useState(false);

  // Check dialog
  const [checkDialogOpen, setCheckDialogOpen] = useState(false);
  const [checkType, setCheckType] = useState('user');
  const [checkName, setCheckName] = useState('');
  const [checkResult, setCheckResult] = useState<{ banned: boolean; ban: BanRecord | null } | null>(null);
  const [checking, setChecking] = useState(false);

  const loadBans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<BanListResponse>('/ban', {
        params: { active: showActiveOnly ? undefined : false, limit: 200, offset: 0 },
      });
      const data = res.data;
      setBans(Array.isArray(data?.bans) ? data.bans : []);
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.ban.failedLoad', { defaultValue: 'Не удалось загрузить список банов' })));
    } finally {
      setLoading(false);
    }
  }, [showActiveOnly, t]);

  useEffect(() => {
    loadBans();
  }, [loadBans]);

  const createBan = useCallback(async () => {
    if (!newBan.target_name.trim()) return;
    setCreating(true);
    try {
      await api.post('/ban', {
        target_type: newBan.target_type,
        target_name: newBan.target_name.trim(),
        reason: newBan.reason || undefined,
        duration_minutes: newBan.duration_minutes || 0,
      });
      toast.success(t('management.ban.created', { name: newBan.target_name, defaultValue: `Бан создан для «${newBan.target_name}»` }));
      setCreateDialogOpen(false);
      setNewBan({ target_type: 'user', target_name: '', reason: '', duration_minutes: 0 });
      loadBans();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.ban.failedCreate', { defaultValue: 'Не удалось создать бан' })));
    } finally {
      setCreating(false);
    }
  }, [newBan, loadBans, t]);

  const liftBan = useCallback(async () => {
    if (!unbanTarget) return;
    setUnbanning(true);
    try {
      await api.post('/ban/unban', {
        ban_id: unbanTarget.id,
        target_type: unbanTarget.target_type,
        target_name: unbanTarget.target_name,
        lifted_reason: unbanReason || undefined,
      });
      toast.success(t('management.ban.lifted', { name: unbanTarget.target_name, defaultValue: `Бан снят с «${unbanTarget.target_name}»` }));
      setUnbanDialogOpen(false);
      setUnbanTarget(null);
      setUnbanReason('');
      loadBans();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.ban.failedLift', { defaultValue: 'Не удалось снять бан' })));
    } finally {
      setUnbanning(false);
    }
  }, [unbanTarget, unbanReason, loadBans, t]);

  const deleteBan = useCallback(async (banId: number) => {
    if (!confirm(t('management.ban.confirmDelete', { id: banId, defaultValue: `Удалить запись о бане #${banId}? Это действие необратимо.` }))) return;
    try {
      await api.delete(`/ban/${banId}`);
      toast.success(t('management.ban.deleted', { id: banId, defaultValue: `Запись #${banId} удалена` }));
      loadBans();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.ban.failedDelete', { defaultValue: 'Не удалось удалить запись' })));
    }
  }, [loadBans, t]);

  const checkBan = useCallback(async () => {
    if (!checkName.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await api.get(`/ban/check/${encodeURIComponent(checkType)}/${encodeURIComponent(checkName.trim())}`);
      setCheckResult({
        banned: !!res.data?.banned,
        ban: res.data?.ban || null,
      });
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.ban.failedCheck', { defaultValue: 'Не удалось проверить статус' })));
    } finally {
      setChecking(false);
    }
  }, [checkType, checkName, t]);

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const stats = useMemo(() => ({
    total: bans.length,
    active: bans.filter(b => b.is_active).length,
    lifted: bans.filter(b => !b.is_active).length,
    permanent: bans.filter(b => b.is_active && !b.expires_at).length,
  }), [bans]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1 md:gap-2 flex-wrap">
        <Button size="sm" className="bg-red-600 hover:bg-red-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={() => setCreateDialogOpen(true)}>
          <Ban className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('management.ban.create', { defaultValue: 'Забанить' })}</span>
        </Button>

        <Button size="sm" variant="outline" onClick={() => { setCheckType('user'); setCheckName(''); setCheckResult(null); setCheckDialogOpen(true); }} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <Eye className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('management.ban.check', { defaultValue: 'Проверить' })}</span>
        </Button>

        <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/30">
          <Label className="text-[10px] cursor-pointer">
            {t('management.ban.activeOnly', { defaultValue: 'Только активные' })}
          </Label>
          <Switch checked={showActiveOnly} onCheckedChange={setShowActiveOnly} />
        </div>

        <div className="flex-1" />

        <Button size="sm" variant="outline" onClick={loadBans} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-2 md:gap-3 text-[10px] text-muted-foreground flex-wrap">
        <Badge variant="outline" className="text-[10px]">
          <Shield className="w-2.5 h-2.5 mr-1" />
          {t('management.ban.total', { count: stats.total, defaultValue: `Всего: ${stats.total}` })}
        </Badge>
        <span>•</span>
        <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
          {t('management.ban.activeCount', { count: stats.active, defaultValue: `Активных: ${stats.active}` })}
        </Badge>
        <span>•</span>
        <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
          {t('management.ban.liftedCount', { count: stats.lifted, defaultValue: `Снято: ${stats.lifted}` })}
        </Badge>
        {stats.permanent > 0 && (
          <>
            <span>•</span>
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
              {t('management.ban.permanentCount', { count: stats.permanent, defaultValue: `Бессрочных: ${stats.permanent}` })}
            </Badge>
          </>
        )}
      </div>

      {/* Mobile card view */}
      {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : bans.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('management.ban.noBans', { defaultValue: 'Нет банов' })}</div>
          ) : bans.map((ban) => (
            <Card key={`m-${ban.id}`} className="p-3">
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-7 h-7 rounded bg-red-500/10 flex items-center justify-center">
                  {ban.target_type === 'user' ? <User className="w-3.5 h-3.5 text-red-400" /> : <KeyRound className="w-3.5 h-3.5 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-sm font-medium truncate">{ban.target_name}</span>
                    <Badge variant="outline" className="text-[10px]">#{ban.id}</Badge>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {ban.target_type === 'user' ? <User className="w-2.5 h-2.5" /> : <KeyRound className="w-2.5 h-2.5" />}
                      {ban.target_type}
                    </Badge>
                    {ban.is_active ? (
                      <Badge variant="default" className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30">
                        {t('management.ban.active', { defaultValue: 'Активен' })}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('management.ban.lifted', { defaultValue: 'Снят' })}
                      </Badge>
                    )}
                  </div>
                  {ban.reason && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5" title={ban.reason}>{ban.reason}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {t('management.ban.bannedBy', { defaultValue: 'Кем' })}: {ban.banned_by || '—'}
                  </div>
                  {ban.banned_by_ip && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{ban.banned_by_ip}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{t('management.ban.createdAt', { defaultValue: 'Создан' })}: {formatDate(ban.created_at)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {t('management.ban.expiresAt', { defaultValue: 'Истекает' })}: {ban.expires_at ? <span className="text-amber-400">{formatDate(ban.expires_at)}</span> : <Badge variant="outline" className="text-[9px] text-red-400 border-red-400/30">∞</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                {ban.is_active && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setUnbanTarget(ban); setUnbanReason(''); setUnbanDialogOpen(true); }} title={t('management.ban.unban', { defaultValue: 'Снять бан' })}>
                    <Unlock className="w-4 h-4 text-emerald-400" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteBan(ban.id)} title={t('common.delete')}>
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Desktop table */}
      {!isMobile && (
      <Card className="overflow-hidden">
        <div
          className="overflow-auto max-h-[calc(100vh-22rem)] overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="min-w-max">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 bg-background z-10">
                  <TableHead className="w-12 text-[10px]">#</TableHead>
                  <TableHead className="text-[10px] w-20">{t('management.ban.type', { defaultValue: 'Тип' })}</TableHead>
                  <TableHead className="text-[10px] min-w-[140px]">{t('management.ban.target', { defaultValue: 'Цель' })}</TableHead>
                  <TableHead className="text-[10px] min-w-[180px]">{t('management.ban.reason', { defaultValue: 'Причина' })}</TableHead>
                  <TableHead className="text-[10px] min-w-[120px]">{t('management.ban.bannedBy', { defaultValue: 'Кем' })}</TableHead>
                  <TableHead className="text-[10px] min-w-[140px]">{t('management.ban.createdAt', { defaultValue: 'Создан' })}</TableHead>
                  <TableHead className="text-[10px] min-w-[140px]">{t('management.ban.expiresAt', { defaultValue: 'Истекает' })}</TableHead>
                  <TableHead className="text-[10px] w-20">{t('common.status')}</TableHead>
                  <TableHead className="text-[10px] w-32">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : bans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      {t('management.ban.noBans', { defaultValue: 'Нет банов' })}
                    </TableCell>
                  </TableRow>
                ) : (
                  bans.map((ban, i) => (
                    <TableRow key={ban.id} className="group">
                      <TableCell className="text-xs text-muted-foreground">{ban.id}</TableCell>
                      <TableCell>
                        {ban.target_type === 'user' ? (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <User className="w-2.5 h-2.5" />
                            user
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <KeyRound className="w-2.5 h-2.5" />
                            key
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs font-medium">{ban.target_name}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ban.reason ? (
                          <span className="truncate max-w-[200px] block" title={ban.reason}>{ban.reason}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{ban.banned_by || '—'}</div>
                        {ban.banned_by_ip && (
                          <div className="text-[9px] text-muted-foreground/60 font-mono">{ban.banned_by_ip}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(ban.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {ban.expires_at ? (
                          <span className="text-amber-400">{formatDate(ban.expires_at)}</span>
                        ) : (
                          <Badge variant="outline" className="text-[9px] text-red-400 border-red-400/30">
                            <Clock className="w-2 h-2 mr-0.5" />
                            ∞
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {ban.is_active ? (
                          <Badge variant="default" className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30">
                            <Shield className="w-2.5 h-2.5 mr-0.5" />
                            {t('management.ban.active', { defaultValue: 'Активен' })}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                            {t('management.ban.lifted', { defaultValue: 'Снят' })}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          {ban.is_active && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setUnbanTarget(ban);
                                setUnbanReason('');
                                setUnbanDialogOpen(true);
                              }}
                              title={t('management.ban.unban', { defaultValue: 'Снять бан' })}
                            >
                              <Unlock className="w-3 h-3 text-emerald-400" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => deleteBan(ban.id)}
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
      )}

      {/* Create ban dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Ban className="w-4 h-4 text-red-400" />
              {t('management.ban.createTitle', { defaultValue: 'Создать бан' })}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.ban.createTitle', { defaultValue: 'Создать бан' })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.type', { defaultValue: 'Тип цели' })}</Label>
              <Select value={newBan.target_type} onValueChange={(v) => setNewBan(p => ({ ...p, target_type: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="key">key (API key prefix)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.target', { defaultValue: 'Имя цели' })} *</Label>
              <Input
                value={newBan.target_name}
                onChange={(e) => setNewBan(p => ({ ...p, target_name: e.target.value }))}
                className="h-8 text-sm font-mono"
                placeholder={newBan.target_type === 'user' ? 'username' : 'key_prefix'}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.reason', { defaultValue: 'Причина' })}</Label>
              <Textarea
                value={newBan.reason}
                onChange={(e) => setNewBan(p => ({ ...p, reason: e.target.value }))}
                className="text-sm min-h-[60px]"
                placeholder={t('management.ban.reasonPlaceholder', { defaultValue: 'Например: подозрительная активность' })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.duration', { defaultValue: 'Длительность (минуты, 0 = бессрочно)' })}</Label>
              <Input
                type="number"
                value={newBan.duration_minutes}
                onChange={(e) => setNewBan(p => ({ ...p, duration_minutes: parseInt(e.target.value) || 0 }))}
                className="h-8 text-sm"
                min={0}
                placeholder="0"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('management.ban.durationHint', { defaultValue: '0 = бессрочный бан. 1440 = 24 часа. 60 = 1 час.' })}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-300/80">
                {t('management.ban.warning', { defaultValue: 'Внимание: заблокированный пользователь/ключ не сможет обращаться к API (403 Forbidden). Static API key (bootstrap admin) не может быть забанен.' })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createBan} disabled={creating || !newBan.target_name.trim()} className="bg-red-600 hover:bg-red-700">
              {creating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ban className="w-4 h-4 mr-1" />}
              {t('management.ban.create', { defaultValue: 'Забанить' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unban dialog */}
      <Dialog open={unbanDialogOpen} onOpenChange={setUnbanDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Unlock className="w-4 h-4 text-emerald-400" />
              {t('management.ban.unbanTitle', { defaultValue: 'Снять бан' })}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.ban.unbanTitle', { defaultValue: 'Снять бан' })}</DialogDescription>
          </DialogHeader>
          {unbanTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-mono">#{unbanTarget.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('management.ban.target', { defaultValue: 'Цель' })}:</span>
                  <span className="font-mono">{unbanTarget.target_type}/{unbanTarget.target_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('management.ban.reason', { defaultValue: 'Причина' })}:</span>
                  <span>{unbanTarget.reason || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('management.ban.createdAt', { defaultValue: 'Создан' })}:</span>
                  <span>{formatDate(unbanTarget.created_at)}</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('management.ban.liftedReason', { defaultValue: 'Причина снятия' })}</Label>
                <Textarea
                  value={unbanReason}
                  onChange={(e) => setUnbanReason(e.target.value)}
                  className="text-sm min-h-[60px]"
                  placeholder={t('management.ban.liftedReasonPlaceholder', { defaultValue: 'Например: расследование завершено' })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnbanDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={liftBan} disabled={unbanning || !unbanTarget} className="bg-emerald-600 hover:bg-emerald-700">
              {unbanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Unlock className="w-4 h-4 mr-1" />}
              {t('management.ban.unban', { defaultValue: 'Снять бан' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check dialog */}
      <Dialog open={checkDialogOpen} onOpenChange={setCheckDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye className="w-4 h-4 text-blue-400" />
              {t('management.ban.checkTitle', { defaultValue: 'Проверить статус бана' })}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.ban.checkTitle', { defaultValue: 'Проверить статус бана' })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.type', { defaultValue: 'Тип' })}</Label>
              <Select value={checkType} onValueChange={setCheckType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="key">key</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.ban.target', { defaultValue: 'Имя' })}</Label>
              <Input
                value={checkName}
                onChange={(e) => setCheckName(e.target.value)}
                className="h-8 text-sm font-mono"
                placeholder="username или key_prefix"
                onKeyDown={(e) => { if (e.key === 'Enter') checkBan(); }}
              />
            </div>
            <Button onClick={checkBan} disabled={checking || !checkName.trim()} size="sm" className="w-full">
              {checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
              {t('management.ban.check', { defaultValue: 'Проверить' })}
            </Button>

            {checkResult && (
              <div className={`rounded-lg border px-3 py-2 space-y-1 text-xs ${
                checkResult.banned
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
              }`}>
                <div className="flex items-center gap-2">
                  {checkResult.banned ? (
                    <>
                      <Shield className="w-4 h-4 text-red-400" />
                      <span className="font-semibold text-red-400">
                        {t('management.ban.isBanned', { defaultValue: 'ЗАБАНЕН' })}
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-emerald-400">
                        {t('management.ban.notBanned', { defaultValue: 'Не забанен' })}
                      </span>
                    </>
                  )}
                </div>
                {checkResult.ban && (
                  <div className="mt-1 space-y-0.5 text-muted-foreground">
                    <div>#{checkResult.ban.id} · {checkResult.ban.reason || '—'}</div>
                    <div>{t('management.ban.bannedBy', { defaultValue: 'Кем' })}: {checkResult.ban.banned_by || '—'}</div>
                    <div>{t('management.ban.createdAt', { defaultValue: 'Создан' })}: {formatDate(checkResult.ban.created_at)}</div>
                    {checkResult.ban.expires_at && (
                      <div>{t('management.ban.expiresAt', { defaultValue: 'Истекает' })}: {formatDate(checkResult.ban.expires_at)}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
