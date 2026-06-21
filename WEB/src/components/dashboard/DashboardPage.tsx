'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import {
  Server, Activity, Cpu, HardDrive, Clock, CheckCircle2, AlertTriangle,
  Users, Shield, Monitor, FolderTree, Globe, Crown,
  Phone, FileText, Database, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface OverviewData {
  status: string;
  timestamp: string;
  domain: {
    dns_domain: string;
    realm: string;
    netbios: string;
    dc_hostname: string;
    forest_level: string;
    domain_level: string;
    server_time: string;
  };
  fsmo_roles: {
    schema_master: string;
    domain_naming_master: string;
    infrastructure_master: string;
    rid_master: string;
    pdc_emulator: string;
  };
  objects: {
    users: number;
    groups: number;
    computers: number;
    ous: number;
    contacts: number;
    gpos: number;
  };
  server_status: {
    role: string;
    cpu_percent: number;
    memory_percent: number;
    memory_total_mb: number | null;
    memory_available_mb: number | null;
    disk_percent: number;
    disk_free_gb: number | null;
    uptime_seconds: number;
    uptime_human: string | null;
    load_1min: number | null;
    samba_processes: number | null;
    samdb_size_mb: number;
    replication_status: string;
  };
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/dashboard/overview');
      const data = res.data;
      // The API may return { status: "ok", ... } or wrap the data
      if (data?.domain && data?.objects && data?.server_status) {
        setOverview(data as OverviewData);
      } else if (data?.data?.domain) {
        setOverview(data.data as OverviewData);
      }
    } catch { /* silently fail */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // FSMO role short names
  const fsmoRoleLabels: Record<string, string> = {
    schema_master: 'Schema Master',
    infrastructure_master: 'Infrastructure Master',
    rid_master: 'RID Master',
    pdc_emulator: 'PDC Emulator',
    domain_naming_master: 'Naming Master',
  };

  // Format uptime seconds
  const formatUptime = (seconds: number): string => {
    if (!seconds && seconds !== 0) return 'N/A';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  const ss = overview?.server_status;
  const dom = overview?.domain;
  const obj = overview?.objects;
  const fsmo = overview?.fsmo_roles;

  const statusCards = [
    { title: t('dashboard.serverStatus'), value: overview?.status === 'ok' ? 'Online' : 'Unknown', icon: CheckCircle2, color: 'text-emerald-500' },
    { title: t('dashboard.serverRole'), value: ss?.role || 'N/A', icon: Server, color: 'text-blue-500' },
    { title: t('dashboard.cpuUsage'), value: ss?.cpu_percent != null ? `${ss.cpu_percent}%` : 'N/A', icon: Cpu, color: 'text-orange-500' },
    { title: t('dashboard.memory'), value: ss?.memory_percent != null ? `${ss.memory_percent}%` : 'N/A', icon: HardDrive, color: 'text-cyan-500' },
    { title: t('dashboard.uptime'), value: ss?.uptime_seconds != null ? formatUptime(ss.uptime_seconds) : 'N/A', icon: Clock, color: 'text-yellow-500' },
    { title: t('dashboard.diskUsage'), value: ss?.disk_percent != null ? `${ss.disk_percent}%` : 'N/A', icon: HardDrive, color: 'text-rose-500' },
    { title: t('dashboard.replicationStatus'), value: ss?.replication_status || 'N/A', icon: ss?.replication_status === 'ok' ? CheckCircle2 : AlertTriangle, color: ss?.replication_status === 'ok' ? 'text-emerald-500' : 'text-red-500' },
    { title: t('dashboard.samDbSize'), value: ss?.samdb_size_mb != null ? `${ss.samdb_size_mb} MB` : 'N/A', icon: Database, color: 'text-violet-500' },
  ];

  const adCounts = [
    { label: t('nav.users'), value: obj?.users ?? '—', icon: Users, color: 'text-blue-500' },
    { label: t('nav.groups'), value: obj?.groups ?? '—', icon: Shield, color: 'text-purple-500' },
    { label: t('nav.computers'), value: obj?.computers ?? '—', icon: Monitor, color: 'text-orange-500' },
    { label: t('nav.ou'), value: obj?.ous ?? '—', icon: FolderTree, color: 'text-amber-500' },
    { label: 'Contacts', value: obj?.contacts ?? '—', icon: Phone, color: 'text-violet-500' },
    { label: 'GPO', value: obj?.gpos ?? '—', icon: FileText, color: 'text-amber-500' },
  ];

  // Extract short hostname from FSMO DN
  const extractShortName = (dn: string): string => {
    if (!dn) return '—';
    const match = dn.match(/CN=([^,]+),CN=Servers/i) || dn.match(/CN=([^,]+)/);
    return match ? match[1] : dn;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
          <p className="text-muted-foreground text-sm">Samba AD DC Management Panel</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCards.map((card) => (
          <Card key={card.title}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${card.color}`}>
                  <card.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{card.title}</p>
                  <p className="text-lg font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : card.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* AD Object Counts */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              {t('dashboard.adObjects')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {adCounts.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                  </div>
                  <Badge variant="outline" className="text-sm font-semibold">{String(item.value)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Domain Info & Level */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              {t('dashboard.domainInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                [t('dashboard.domain'), dom?.dns_domain],
                [t('dashboard.realm'), dom?.realm],
                [t('dashboard.netbios'), dom?.netbios],
                [t('dashboard.dcServer'), dom?.dc_hostname],
                [t('dashboard.forestLevel'), dom?.forest_level],
                [t('dashboard.domainLevel'), dom?.domain_level],
              ].map(([label, val]) => (
                <div key={String(label)} className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground truncate">{String(label)}</span>
                  <Badge variant="outline" className="ml-2 truncate max-w-[200px]">{String(val || 'N/A')}</Badge>
                </div>
              ))}
              {dom?.server_time && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground truncate">{t('dashboard.serverTime')}</span>
                  <Badge variant="outline" className="ml-2 truncate max-w-[200px]">{dom.server_time}</Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* FSMO Roles Summary */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-500" />
              {t('domain.fsmoRoles')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-4 text-center">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : !fsmo || Object.keys(fsmo).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">{t('common.noData')}</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(fsmo).map(([key, value]) => {
                  const label = fsmoRoleLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                  const ownerDn = String(value || '—');
                  const shortName = ownerDn !== '—' ? extractShortName(ownerDn) : '—';

                  return (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground truncate">{label}</span>
                      <Badge variant="outline" className="text-[10px] max-w-[150px] truncate font-mono" title={ownerDn}>
                        {shortName}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
