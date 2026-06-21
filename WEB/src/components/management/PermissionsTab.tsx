'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Loader2, Lock, Search, Plus, Minus, Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import {
  mgmtPermissionsApi, mgmtRolesApi, getErrorMessage,
  type PermissionsByCategory, type MgmtRole,
} from '@/lib/api-mgmt';
import ScrollableTable from './ScrollableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface PermissionsTabProps {
  roles: MgmtRole[];
  loading: boolean;
  onReload: () => void;
}

export default function PermissionsTab({ roles, loading, onReload }: PermissionsTabProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  const [catalog, setCatalog] = useState<PermissionsByCategory>({});
  const [total, setTotal] = useState(0);
  const [permLoading, setPermLoading] = useState(false);

  // Selected role for assign/revoke
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [roleLoading, setRoleLoading] = useState(false);

  // Selection for assign/revoke
  const [toAssign, setToAssign] = useState<Set<string>>(new Set());
  const [toRevoke, setToRevoke] = useState<Set<string>>(new Set());

  // Search
  const [search, setSearch] = useState('');

  const loadCatalog = useCallback(async () => {
    setPermLoading(true);
    try {
      const { categories, total } = await mgmtPermissionsApi.list();
      setCatalog(categories);
      setTotal(total);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadPermissions')));
    } finally {
      setPermLoading(false);
    }
  }, [t]);

  const loadRolePerms = useCallback(async (roleName: string) => {
    if (!roleName) {
      setRolePerms(new Set());
      return;
    }
    setRoleLoading(true);
    try {
      const r = await mgmtRolesApi.get(roleName);
      setRolePerms(new Set(r.permissions));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadRoleDetails')));
    } finally {
      setRoleLoading(false);
    }
  }, [t]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    setToAssign(new Set());
    setToRevoke(new Set());
    loadRolePerms(selectedRole);
  }, [selectedRole, loadRolePerms]);

  // Filtered permissions by search
  const filteredCatalog = useMemo(() => {
    if (!search.trim()) return catalog;
    const q = search.trim().toLowerCase();
    const out: PermissionsByCategory = {};
    for (const [cat, perms] of Object.entries(catalog)) {
      const filtered = perms.filter(p => p.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [catalog, search]);

  // ── Actions ─────────────────────────────────────────────────────────
  const toggleAssign = (perm: string) => {
    if (rolePerms.has(perm)) return; // already assigned
    setToAssign(prev => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return next;
    });
    setToRevoke(prev => { const n = new Set(prev); n.delete(perm); return n; });
  };

  const toggleRevoke = (perm: string) => {
    if (!rolePerms.has(perm)) return; // not assigned
    setToRevoke(prev => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return next;
    });
    setToAssign(prev => { const n = new Set(prev); n.delete(perm); return n; });
  };

  const handleAssign = useCallback(async () => {
    if (!selectedRole || toAssign.size === 0) return;
    try {
      await mgmtPermissionsApi.assign(selectedRole, [...toAssign]);
      toast.success(t('management.perms_assigned', { role: selectedRole }));
      setToAssign(new Set());
      await loadRolePerms(selectedRole);
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.perms_failed_assign')));
    }
  }, [selectedRole, toAssign, loadRolePerms, onReload, t]);

  const handleRevoke = useCallback(async () => {
    if (!selectedRole || toRevoke.size === 0) return;
    try {
      await mgmtPermissionsApi.revoke(selectedRole, [...toRevoke]);
      toast.success(t('management.perms_revoked', { role: selectedRole }));
      setToRevoke(new Set());
      await loadRolePerms(selectedRole);
      onReload();
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.perms_failed_revoke')));
    }
  }, [selectedRole, toRevoke, loadRolePerms, onReload, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 md:gap-2">
        <Label className="text-xs">{t('management.perms_select_role')}:</Label>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="h-8 md:h-9 w-full sm:w-64 text-xs">
            <SelectValue placeholder={t('management.perms_select_role')} />
          </SelectTrigger>
          <SelectContent>
            {roles.map(r => (
              <SelectItem key={r.name} value={r.name}>
                <span className="flex items-center gap-2">
                  <Shield className="w-3 h-3" />
                  {r.name}
                  {!r.is_active ? <Badge variant="secondary" className="text-[10px]">{t('management.roles_inactive')}</Badge> : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="text-xs text-muted-foreground">
          {t('management.perms_total', { count: total })}
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => { loadCatalog(); onReload(); }} disabled={loading || permLoading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading || permLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>
      </div>

      {selectedRole && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex-1 min-w-[120px]">
              <div className="text-xs text-muted-foreground">{t('management.perms_already_assigned')}</div>
              <div className="text-2xl font-bold text-emerald-500">{rolePerms.size}</div>
            </div>
            <div className="flex-1 min-w-[120px]">
              <div className="text-xs text-muted-foreground">{t('management.perms_assign')}</div>
              <div className="text-2xl font-bold text-blue-500">{toAssign.size}</div>
            </div>
            <div className="flex-1 min-w-[120px]">
              <div className="text-xs text-muted-foreground">{t('management.perms_revoke')}</div>
              <div className="text-2xl font-bold text-red-500">{toRevoke.size}</div>
            </div>
            <Button size="sm" onClick={handleAssign} disabled={toAssign.size === 0} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('management.perms_assign')}</span>
            </Button>
            <Button size="sm" variant="destructive" onClick={handleRevoke} disabled={toRevoke.size === 0} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <Minus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('management.perms_revoke')}</span>
            </Button>
          </div>
        </Card>
      )}

      {!selectedRole ? (
        <Card>
          <div className="py-12 text-center text-muted-foreground">
            <Lock className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{t('management.perms_select_role')}</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-1 md:gap-2">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('management.perms_search')}
                className="h-8 md:h-9 text-sm pl-7"
              />
            </div>
          </div>

          <ScrollableTable maxHeight="calc(100vh-26rem)">
            <div className="space-y-3 p-1">
              {permLoading ? (
                <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
              ) : Object.keys(filteredCatalog).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('common.noData')}</p>
              ) : (
                Object.entries(filteredCatalog).map(([cat, perms]) => (
                  <Card key={cat} className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs font-mono font-semibold">{cat}</span>
                      <Badge variant="outline" className="text-[10px]">{perms.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                      {perms.map(perm => {
                        const assigned = rolePerms.has(perm);
                        const willAssign = toAssign.has(perm);
                        const willRevoke = toRevoke.has(perm);
                        let cls = 'border-border text-muted-foreground hover:border-emerald-500/30';
                        if (assigned && !willRevoke) {
                          cls = 'border-emerald-500 bg-emerald-500/10 text-emerald-600';
                        } else if (willRevoke) {
                          cls = 'border-red-500 bg-red-500/10 text-red-600 line-through';
                        } else if (willAssign) {
                          cls = 'border-blue-500 bg-blue-500/10 text-blue-600';
                        }
                        return (
                          <label
                            key={perm}
                            className={`flex items-center gap-1.5 text-[11px] font-mono px-1.5 py-1 rounded border cursor-pointer transition-colors ${cls}`}
                          >
                            <Checkbox
                              checked={assigned ? !willRevoke : willAssign}
                              onCheckedChange={() => assigned ? toggleRevoke(perm) : toggleAssign(perm)}
                              className="h-3 w-3"
                            />
                            <span className="truncate" title={perm}>{perm}</span>
                          </label>
                        );
                      })}
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollableTable>
        </>
      )}
    </div>
  );
}
