'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Loader2, ChevronLeft, ChevronRight, Search, Download,
  FileText, FileJson, FileSpreadsheet, Info, Filter, X, PanelRightOpen, PanelRightClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { mgmtAuditApi, getErrorMessage, type MgmtAuditEntry } from '@/lib/api-mgmt';
import { fmtDate, fmtDetails } from './mgmt-utils';
import { exportRows, type ExportFormat } from './export-helpers';
import ScrollableTable from './ScrollableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

// ── Sidebar filter state ────────────────────────────────────────────────
interface SidebarFilters {
  methods: Set<string>;          // GET, POST, PUT, PATCH, DELETE
  statusGroups: Set<string>;     // 2xx, 3xx, 4xx, 5xx
  authMethods: Set<string>;      // api_key, jwt, etc.
  users: Set<string>;            // username filter
}

const STATUS_GROUPS = ['2xx', '3xx', '4xx', '5xx'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const STATUS_GROUP_COLORS: Record<string, string> = {
  '2xx': 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10',
  '3xx': 'text-blue-500 border-blue-500/40 bg-blue-500/10',
  '4xx': 'text-amber-500 border-amber-500/40 bg-amber-500/10',
  '5xx': 'text-red-500 border-red-500/40 bg-red-500/10',
};

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
  POST: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  PUT: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  PATCH: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  DELETE: 'text-red-400 border-red-500/40 bg-red-500/10',
};

export default function AuditTab() {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [entries, setEntries] = useState<MgmtAuditEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Sidebar open/close
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sidebar filters (applied client-side on top of server response)
  const [filters, setFilters] = useState<SidebarFilters>({
    methods: new Set(),
    statusGroups: new Set(),
    authMethods: new Set(),
    users: new Set(),
  });

  // Row click — show details dialog
  const [selectedEntry, setSelectedEntry] = useState<MgmtAuditEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof mgmtAuditApi.list>[0] = { offset, limit };
      if (actionFilter.trim()) params.action = actionFilter.trim();
      if (search.trim()) params.search = search.trim();
      const res = await mgmtAuditApi.list(params);
      setEntries(res.entries);
      setCount(res.count);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.audit_failed_load')));
    } finally {
      setLoading(false);
    }
  }, [offset, limit, actionFilter, search, t]);

  useEffect(() => { load(); }, [load]);

  // ── Compute available filter values from loaded entries ──────────────
  // Sidebar shows all methods/auth-methods/users present in the current
  // page so the user can pick relevant chips.
  const availableAuthMethods = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => { if (e.auth_method) set.add(e.auth_method); });
    return [...set].sort();
  }, [entries]);

  const availableUsers = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => { if (e.username) set.add(e.username); });
    return [...set].sort();
  }, [entries]);

  // Method/status counts for sidebar chips
  const methodCounts = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach(e => { m[e.method] = (m[e.method] || 0) + 1; });
    return m;
  }, [entries]);

  const statusGroupCounts = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach(e => {
      const grp = `${Math.floor(e.status_code / 100)}xx`;
      m[grp] = (m[grp] || 0) + 1;
    });
    return m;
  }, [entries]);

  // Apply sidebar filters client-side
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (filters.methods.size > 0 && !filters.methods.has(e.method)) return false;
      if (filters.statusGroups.size > 0) {
        const grp = `${Math.floor(e.status_code / 100)}xx`;
        if (!filters.statusGroups.has(grp)) return false;
      }
      if (filters.authMethods.size > 0 && !filters.authMethods.has(e.auth_method)) return false;
      if (filters.users.size > 0 && !filters.users.has(e.username || '')) return false;
      return true;
    });
  }, [entries, filters]);

  const activeFilterCount =
    filters.methods.size + filters.statusGroups.size +
    filters.authMethods.size + filters.users.size;

  // Toggle a filter chip
  const toggleFilter = useCallback((
    key: keyof SidebarFilters,
    value: string,
  ) => {
    setFilters(prev => {
      const next = { ...prev, [key]: new Set(prev[key]) };
      if (next[key].has(value)) next[key].delete(value);
      else next[key].add(value);
      return next;
    });
  });

  const clearFilters = useCallback(() => {
    setFilters({
      methods: new Set(),
      statusGroups: new Set(),
      authMethods: new Set(),
      users: new Set(),
    });
  }, []);

  const handleExport = useCallback((format: ExportFormat) => {
    // Export the FILTERED entries (after sidebar) so what you see is what you get
    const exportData = filteredEntries.length > 0 ? filteredEntries : entries;
    if (!exportData.length) {
      toast.info(t('management.audit_no_data'));
      return;
    }
    try {
      const rows = exportData.map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        username: e.username ?? '',
        user_id: e.user_id ?? '',
        api_key_id: e.api_key_id ?? '',
        method: e.method,
        endpoint: e.endpoint,
        action: e.action,
        status_code: e.status_code,
        duration_ms: e.duration_ms,
        ip_address: e.ip_address ?? '',
        auth_method: e.auth_method,
        event_type: e.event_type,
        user_agent: e.user_agent ?? '',
        details: fmtDetails(e.details),
      }));
      const columns = [
        { key: 'id', label: t('management.audit_id') },
        { key: 'timestamp', label: t('management.audit_timestamp') },
        { key: 'username', label: t('management.audit_user') },
        { key: 'user_id', label: 'user_id' },
        { key: 'api_key_id', label: 'api_key_id' },
        { key: 'method', label: t('management.audit_method') },
        { key: 'endpoint', label: t('management.audit_endpoint') },
        { key: 'action', label: t('management.audit_action') },
        { key: 'status_code', label: t('management.audit_status_code') },
        { key: 'duration_ms', label: t('management.audit_duration') },
        { key: 'ip_address', label: t('management.audit_ip') },
        { key: 'auth_method', label: t('management.audit_auth_method') },
        { key: 'event_type', label: t('management.audit_event_type') },
        { key: 'user_agent', label: t('management.audit_user_agent') },
        { key: 'details', label: t('management.audit_details') },
      ];
      exportRows(`audit-${Date.now()}`, rows, columns, format);
      const msgKey =
        format === 'csv' ? 'management.audit_exported_csv' :
        format === 'json' ? 'management.audit_exported_json' :
        'management.audit_exported_xlsx';
      toast.success(t(msgKey, { count: entries.length }));
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.audit_failed_export')));
    }
  }, [entries, t]);

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(count / limit));

  const goPrev = () => setOffset(Math.max(0, offset - limit));
  const goNext = () => setOffset(offset + limit);

  const statusColor = (code: number): string => {
    if (code >= 200 && code < 300) return 'text-emerald-500';
    if (code >= 300 && code < 400) return 'text-blue-500';
    if (code >= 400 && code < 500) return 'text-amber-500';
    if (code >= 500) return 'text-red-500';
    return '';
  };

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* ── Sidebar (filters) ────────────────────────────────────────── */}
      {sidebarOpen && (
        <Card className="w-full md:w-64 flex-shrink-0 p-3 space-y-4 md:max-h-[calc(100vh-12rem)] overflow-y-auto md:self-start md:sticky md:top-0 max-h-[35vh]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t('management.audit_sidebar_title', { defaultValue: 'Фильтры' })}</h3>
              {activeFilterCount > 0 && (
                <Badge variant="default" className="text-[10px] h-4 px-1.5">{activeFilterCount}</Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSidebarOpen(false)} title={t('management.audit_hide_sidebar', { defaultValue: 'Скрыть боковую панель' })}>
              <PanelRightClose className="w-4 h-4" />
            </Button>
          </div>

          {activeFilterCount > 0 && (
            <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={clearFilters}>
              <X className="w-3 h-3 mr-1" />
              {t('management.audit_clear_filters', { defaultValue: 'Очистить фильтры' })}
            </Button>
          )}

          {/* HTTP methods */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              {t('management.audit_method', { defaultValue: 'Метод' })}
            </Label>
            <div className="flex flex-wrap gap-1">
              {HTTP_METHODS.map(m => {
                const active = filters.methods.has(m);
                const cnt = methodCounts[m] || 0;
                if (cnt === 0 && !active) return null;
                return (
                  <button
                    key={m}
                    onClick={() => toggleFilter('methods', m)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      active
                        ? METHOD_COLORS[m] + ' ring-1 ring-current'
                        : 'border-border text-muted-foreground hover:border-foreground/30'
                    }`}
                    title={`${m} (${cnt})`}
                  >
                    {m} <span className="opacity-60">({cnt})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status code groups */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              {t('management.audit_status_code', { defaultValue: 'Статус' })}
            </Label>
            <div className="flex flex-wrap gap-1">
              {STATUS_GROUPS.map(g => {
                const active = filters.statusGroups.has(g);
                const cnt = statusGroupCounts[g] || 0;
                if (cnt === 0 && !active) return null;
                return (
                  <button
                    key={g}
                    onClick={() => toggleFilter('statusGroups', g)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      active
                        ? STATUS_GROUP_COLORS[g] + ' ring-1 ring-current'
                        : 'border-border text-muted-foreground hover:border-foreground/30'
                    }`}
                    title={`${g} (${cnt})`}
                  >
                    {g} <span className="opacity-60">({cnt})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Auth method */}
          {availableAuthMethods.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                {t('management.audit_auth_method', { defaultValue: 'Метод аутентиф.' })}
              </Label>
              <div className="flex flex-wrap gap-1">
                {availableAuthMethods.map(am => {
                  const active = filters.authMethods.has(am);
                  return (
                    <button
                      key={am}
                      onClick={() => toggleFilter('authMethods', am)}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        active
                          ? 'border-purple-500 bg-purple-500/10 text-purple-500 ring-1 ring-current'
                          : 'border-border text-muted-foreground hover:border-foreground/30'
                      }`}
                    >
                      {am}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Users */}
          {availableUsers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                {t('management.audit_user', { defaultValue: 'Пользователь' })}
              </Label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {availableUsers.map(u => {
                  const active = filters.users.has(u);
                  return (
                    <label
                      key={u}
                      className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded"
                    >
                      <Checkbox
                        checked={active}
                        onCheckedChange={() => toggleFilter('users', u)}
                        className="h-3 w-3"
                      />
                      <span className="truncate font-mono">{u}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Result count */}
          <div className="pt-2 border-t text-[10px] text-muted-foreground">
            {t('management.audit_showing_filtered', {
              defaultValue: 'Показано: {{shown}} из {{loaded}}',
              shown: filteredEntries.length,
              loaded: entries.length,
            })}
          </div>
        </Card>
      )}

      {/* ── Main content (toolbar + table + pagination) ─────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 md:gap-2">
          {!sidebarOpen && (
            <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)} title={t('management.audit_show_sidebar', { defaultValue: 'Показать фильтры' })} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
              <PanelRightOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <Filter className="w-3 h-3 md:mr-1" />
              {activeFilterCount > 0 && (
                <Badge variant="default" className="text-[10px] h-4 px-1.5 ml-1">{activeFilterCount}</Badge>
              )}
            </Button>
          )}
          <Input
            placeholder={t('management.audit_search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); load(); } }}
            className="h-8 md:h-9 w-full sm:max-w-xs text-sm"
          />
          <Input
            placeholder={t('management.audit_filter_action')}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setOffset(0); load(); } }}
            className="h-8 md:h-9 w-full sm:w-48 text-sm"
          />
          <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setOffset(0); }}>
            <SelectTrigger className="h-8 md:h-9 w-full sm:w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 200, 500].map(n => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => { setOffset(0); load(); }} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <Search className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
            <span className="hidden sm:inline">{t('common.filter')}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>

          <div className="flex-1" />

          {/* Export dropdown — CSV / JSON / XLSX (always visible, even when no entries) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                <Download className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                <span className="hidden sm:inline">{t('common.export')}</span>
                <ChevronRight className="w-3 h-3 ml-1 rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileText className="w-3 h-3 mr-2" />
                {t('common.export_csv')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <FileJson className="w-3 h-3 mr-2" />
                {t('common.export_json')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                <FileSpreadsheet className="w-3 h-3 mr-2" />
                {t('common.export_xlsx')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Prominent hint banner — visible so the user knows the audit table is interactive */}
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            {t('management.audit_click_hint_big')}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{t('common.horizontal_scroll_hint')}</span>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{t('management.audit_export_hint')}</span>
        </div>

        {/* Mobile card view */}
        {isMobile && (
          <div className="space-y-2 max-h-[calc(100vh-22rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            {loading ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('management.audit_no_data')}</div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('management.audit_no_match', { defaultValue: 'Ничего не найдено по выбранным фильтрам. Сбросьте фильтры в боковой панели.' })}</div>
            ) : filteredEntries.map((e) => (
              <Card key={`m-${e.id}`} className="p-3" onClick={() => setSelectedEntry(e)} role="button">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-mono">{e.method}</Badge>
                      <span className={`text-xs font-bold ${statusColor(e.status_code)}`}>{e.status_code}</span>
                      <span className="text-[10px] text-muted-foreground">#{e.id}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{e.duration_ms}ms</span>
                    </div>
                    {e.username && (
                      <div className="font-medium text-sm truncate mt-0.5">{e.username}</div>
                    )}
                    <div className="text-xs font-mono truncate mt-0.5" title={e.endpoint}>{e.endpoint}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5" title={e.timestamp}>
                      {fmtDate(e.timestamp, locale)}
                    </div>
                    {e.ip_address && (
                      <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{e.ip_address}</div>
                    )}
                    {e.event_type && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{e.event_type}</div>
                    )}
                  </div>
                  <Info className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground mt-1" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Desktop table — horizontal + vertical scroll, click row for info */}
        {!isMobile && (
        <Card className="overflow-hidden p-0">
          <ScrollableTable maxHeight="calc(100vh-28rem)">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 sticky top-0 bg-card z-10">ID</TableHead>
                  <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_timestamp')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_user')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_method')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_endpoint')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_status_code')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10 text-right">{t('management.audit_duration')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_ip')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_auth_method')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_event_type')}</TableHead>
                <TableHead className="sticky top-0 bg-card z-10">{t('management.audit_user_agent')}</TableHead>
                <TableHead className="w-12 sticky top-0 bg-card z-10 text-center">{t('common.details')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    {t('management.audit_no_data')}
                  </TableCell>
                </TableRow>
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    {t('management.audit_no_match', { defaultValue: 'Ничего не найдено по выбранным фильтрам. Сбросьте фильтры в боковой панели.' })}
                  </TableCell>
                </TableRow>
              ) : filteredEntries.map((e) => (
                <TableRow
                  key={e.id}
                  className="mgmt-audit-row"
                  onClick={() => setSelectedEntry(e)}
                  title={t('management.audit_click_hint_big')}
                >
                  <TableCell className="text-xs text-muted-foreground">{e.id}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap" title={e.timestamp}>
                    {fmtDate(e.timestamp, locale)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.username ? (
                      <span className="font-medium">{e.username}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {e.user_id ? <span className="text-[10px] text-muted-foreground block">#{e.user_id}</span> : null}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${
                        e.method === 'GET' ? 'text-blue-400' :
                        e.method === 'POST' ? 'text-emerald-400' :
                        e.method === 'PUT' || e.method === 'PATCH' ? 'text-amber-400' :
                        e.method === 'DELETE' ? 'text-red-400' : ''
                      }`}
                    >
                      {e.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">{e.endpoint}</TableCell>
                  <TableCell className={`text-xs font-bold ${statusColor(e.status_code)}`}>
                    {e.status_code}
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground font-mono">{e.duration_ms}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">{e.ip_address || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{e.auth_method || '—'}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.event_type || '—'}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground max-w-xs truncate" title={e.user_agent ?? ''}>
                    {e.user_agent || '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Info className="mgmt-audit-info-icon w-3.5 h-3.5 inline-block" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>
        )}

      {/* Pagination */}
      <div className="flex items-center gap-1 md:gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={goPrev} disabled={offset === 0 || loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <ChevronLeft className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('management.audit_prev')}</span>
        </Button>
        <span className="text-xs md:text-sm text-muted-foreground">
          {t('management.audit_page', { page: currentPage, total: totalPages })}
        </span>
        <Button variant="outline" size="sm" onClick={goNext} disabled={offset + limit >= count || loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <span className="hidden sm:inline">{t('management.audit_next')}</span>
          <ChevronRight className="w-3.5 h-3.5 md:w-4 md:h-4 md:ml-1" />
        </Button>
        <div className="flex-1" />
        <span className="text-xs md:text-sm text-muted-foreground">
          {t('management.audit_total', { count })}
        </span>
      </div>

      {/* Row info dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="mgmt-resizable max-w-[95vw] md:max-w-[98vw] md:w-[900px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-4 h-4" />
              {t('management.audit_row_info')} #{selectedEntry?.id}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.audit_row_info')}</DialogDescription>
          </DialogHeader>
          <div className="text-[10px] text-muted-foreground italic mb-2">{t('management.users_keys_resize_hint')}</div>
          {selectedEntry && (
            <ScrollableTable maxHeight="calc(92vh - 200px)" className="border-0">
              <div className="space-y-2 p-1">
                <InfoRow label={t('management.audit_id')} value={String(selectedEntry.id)} />
                <InfoRow label={t('management.audit_timestamp')} value={fmtDate(selectedEntry.timestamp, locale)} />
                <InfoRow label={t('management.audit_user')} value={selectedEntry.username || '—'} />
                <InfoRow label="user_id" value={selectedEntry.user_id != null ? String(selectedEntry.user_id) : '—'} />
                <InfoRow label="api_key_id" value={selectedEntry.api_key_id != null ? String(selectedEntry.api_key_id) : '—'} />
                <InfoRow label={t('management.audit_method')} value={selectedEntry.method} />
                <InfoRow label={t('management.audit_endpoint')} value={selectedEntry.endpoint} mono />
                <InfoRow label={t('management.audit_action')} value={selectedEntry.action} mono />
                <InfoRow
                  label={t('management.audit_status_code')}
                  value={
                    <span className={`font-bold ${statusColor(selectedEntry.status_code)}`}>
                      {selectedEntry.status_code}
                    </span>
                  }
                />
                <InfoRow label={t('management.audit_duration')} value={`${selectedEntry.duration_ms} ms`} />
                <InfoRow label={t('management.audit_ip')} value={selectedEntry.ip_address || '—'} mono />
                <InfoRow label={t('management.audit_auth_method')} value={selectedEntry.auth_method || '—'} />
                <InfoRow label={t('management.audit_event_type')} value={selectedEntry.event_type || '—'} />
                <InfoRow label={t('management.audit_user_agent')} value={selectedEntry.user_agent || '—'} />
                <InfoRow
                  label={t('management.audit_details')}
                  value={
                    fmtDetails(selectedEntry.details) || (
                      <span className="text-muted-foreground">{t('management.audit_no_details')}</span>
                    )
                  }
                  mono
                  pre
                />
                <InfoRow
                  label={t('management.audit_request_body')}
                  value={
                    selectedEntry.request_body
                      ? <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted p-2 rounded">{selectedEntry.request_body}</pre>
                      : <span className="text-muted-foreground">—</span>
                  }
                />
              </div>
            </ScrollableTable>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedEntry(null)}>
              {t('management.audit_close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>{/* end main content */}
    </div>
  );
}

// ── InfoRow helper ─────────────────────────────────────────────────────
function InfoRow({
  label, value, mono, pre,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  pre?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 border-b border-border/40 last:border-0">
      <Label className="text-xs text-muted-foreground break-words">{label}</Label>
      <div className={`col-span-2 text-sm ${mono ? 'font-mono text-xs' : ''} ${pre ? '' : 'break-words'}`}>
        {value}
      </div>
    </div>
  );
}
