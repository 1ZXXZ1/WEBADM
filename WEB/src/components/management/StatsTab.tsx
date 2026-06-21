'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Loader2, Users, KeyRound, Shield, FileText, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ScrollableTable from './ScrollableTable';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { mgmtStatsApi, getErrorMessage, type MgmtStats } from '@/lib/api-mgmt';
import { isActive } from './mgmt-utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

export default function StatsTab() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [stats, setStats] = useState<MgmtStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmtStatsApi.get();
      setStats(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.stats_failed_load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) {
    return <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  }

  if (!stats) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t('common.noData')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 md:gap-2 flex-wrap">
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>
      </div>

      {/* Top KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title={t('management.stats_users')}
          icon={<Users className="w-4 h-4 text-blue-400" />}
          total={stats.users.total}
          active={stats.users.active}
          totalLabel={t('management.stats_users_total')}
          activeLabel={t('management.stats_users_active')}
        />
        <KpiCard
          title={t('management.stats_api_keys')}
          icon={<KeyRound className="w-4 h-4 text-emerald-400" />}
          total={stats.api_keys.total}
          active={stats.api_keys.active}
          totalLabel={t('management.stats_keys_total')}
          activeLabel={t('management.stats_keys_active')}
          extra={
            <div className="text-xs text-amber-500 mt-1">
              {t('management.stats_keys_expiring')}: <b>{stats.api_keys.soon_to_expire_7d}</b>
            </div>
          }
        />
        <KpiCard
          title={t('management.stats_roles')}
          icon={<Shield className="w-4 h-4 text-purple-400" />}
          total={stats.roles.total}
          active={stats.roles.active}
          totalLabel={t('management.stats_roles_total')}
          activeLabel={t('management.stats_roles_active')}
        />
        <KpiCard
          title={t('management.stats_audit_log')}
          icon={<FileText className="w-4 h-4 text-orange-400" />}
          total={stats.audit_log.total}
          totalLabel={t('management.stats_audit_total')}
        />
      </div>

      {/* Auth stats */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <LogIn className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('management.stats_auth')}</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-muted">
            <div className="text-xs text-muted-foreground">{t('management.stats_auth_success')}</div>
            <div className="text-2xl font-bold text-emerald-500">{stats.auth.successful_logins_24h}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted">
            <div className="text-xs text-muted-foreground">{t('management.stats_auth_failed')}</div>
            <div className="text-2xl font-bold text-red-500">{stats.auth.failed_logins_24h}</div>
          </div>
        </div>
      </Card>

      {/* Roles breakdown */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">{t('management.stats_roles_breakdown')}</h3>
        </div>
        <ScrollableTable maxHeight="24rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('management.stats_role_name')}</TableHead>
                <TableHead>{t('management.stats_role_status')}</TableHead>
                <TableHead className="text-right">{t('management.stats_role_users')}</TableHead>
                <TableHead className="text-right">{t('management.stats_role_keys')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.roles_breakdown.map((r) => {
                const a = isActive(r.is_active);
                return (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant={a ? 'default' : 'secondary'} className="text-xs">
                        {a ? t('management.roles_active') : t('management.roles_inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.users}</TableCell>
                    <TableCell className="text-right font-mono">{r.keys}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────
function KpiCard({
  title, icon, total, active, totalLabel, activeLabel, extra,
}: {
  title: string;
  icon: React.ReactNode;
  total: number;
  active?: number;
  totalLabel: string;
  activeLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="text-3xl font-bold mb-1">{total}</div>
      <div className="text-xs text-muted-foreground">{totalLabel}</div>
      {active !== undefined && activeLabel && (
        <div className="text-xs text-emerald-500 mt-1">
          {activeLabel}: <b>{active}</b>
        </div>
      )}
      {extra}
    </Card>
  );
}
