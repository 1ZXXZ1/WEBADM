'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import {
  parseDnsZones, parseDnsRecords, parseDnsServerInfo,
  extractOutputText, unwrapResponse, safeToastMessage,
  type DNSZoneInfo, type DNSRecordInfo, type DnsServerInfo,
} from '@/lib/parsers';
import {
  Globe, Plus, Trash2, RefreshCw, Loader2, List, FilePlus,
  Server, Info, ChevronRight, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

export default function DNSPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [dnsServer, setDnsServer] = useState<string>('127.0.0.1');
  const [zones, setZones] = useState<DNSZoneInfo[]>([]);
  const [records, setRecords] = useState<DNSRecordInfo[]>([]);
  const [serverInfo, setServerInfo] = useState<DnsServerInfo | null>(null);
  const [zoneDetail, setZoneDetail] = useState<Record<string, string | string[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [createZoneOpen, setCreateZoneOpen] = useState(false);
  const [createRecordOpen, setCreateRecordOpen] = useState(false);
  const [deleteZoneOpen, setDeleteZoneOpen] = useState(false);
  const [deleteRecordOpen, setDeleteRecordOpen] = useState(false);
  const [deleteRecordData, setDeleteRecordData] = useState<DNSRecordInfo | null>(null);
  const [newZone, setNewZone] = useState({ zone: '', dns_directory_partition: 'domain' });
  const [newRecord, setNewRecord] = useState({ name: '', record_type: 'A', data: '' });

  // Column customizer for records table
  const defaultColumns: ColumnDef[] = [
    { key: 'name', label: t('dns.recordName'), visible: true },
    { key: 'type', label: t('dns.recordType'), visible: true },
    { key: 'data', label: t('dns.recordData'), visible: true },
    { key: 'ttl', label: t('dns.ttl'), visible: true },
    { key: 'actions', label: '', visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('dns', defaultColumns);

  const recordDataKeys = useMemo(() => {
    return extractAllKeys(records as unknown as Record<string, unknown>[]);
  }, [records]);

  const visibleColCount = useMemo(() => colConfig.filter(c => c.visible).length, [colConfig]);

  // Auto-detect DNS server IP from /health endpoint
  const detectDnsServer = useCallback(async () => {
    try {
      const response = await api.get('/health');
      const data = response.data;
      const serverIp = data?.data?.server_ip || data?.server_ip || data?.data?.ip || data?.ip;
      if (serverIp && typeof serverIp === 'string') {
        setDnsServer(serverIp);
        return serverIp;
      }
    } catch {
      // Use default 127.0.0.1
    }
    return '127.0.0.1';
  }, []);

  const loadZones = useCallback(async () => {
    setLoading(true);
    try {
      const server = await detectDnsServer();
      const response = await api.get(`/dns/zones?server=${encodeURIComponent(server)}`);
      const data = response.data;
      const outputText = extractOutputText(data);

      if (outputText) {
        const parsed = parseDnsZones(outputText);
        if (parsed.length > 0) {
          setZones(parsed);
        } else {
          // Fallback: parse as simple line-separated zone names
          const lines = outputText.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.includes(':') && !l.startsWith('N zone') && !l.startsWith('0 '));
          if (lines.length > 0) {
            setZones(lines.map((name: string) => ({ name })));
          } else {
            setZones([]);
          }
        }
      } else if (Array.isArray(data)) {
        setZones(data.map((z: Record<string, string> | string) => {
          if (typeof z === 'string') return { name: z };
          return {
            name: z.name || z.zone || z.pszZoneName || String(Object.values(z)[0]),
            ...z,
          };
        }));
      } else if (data?.data && Array.isArray(data.data)) {
        setZones(data.data.map((z: Record<string, string> | string) => {
          if (typeof z === 'string') return { name: z };
          return {
            name: z.name || z.zone || z.pszZoneName || String(Object.values(z)[0]),
            ...z,
          };
        }));
      } else if (data?.zones && Array.isArray(data.zones)) {
        setZones(data.zones.map((z: string | Record<string, string>) => {
          if (typeof z === 'string') return { name: z };
          return { name: z.name || z.zone || z.pszZoneName || String(Object.values(z)[0]), ...z };
        }));
      } else if (data?.result && Array.isArray(data.result)) {
        setZones(data.result.map((z: string | Record<string, string>) => {
          if (typeof z === 'string') return { name: z };
          return { name: z.name || z.zone || z.pszZoneName || String(Object.values(z)[0]), ...z };
        }));
      } else {
        setZones([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedZones')));
    } finally {
      setLoading(false);
    }
  }, [t, detectDnsServer]);

  const loadServerInfo = useCallback(async () => {
    try {
      const response = await api.get(`/dns/serverinfo?server=${encodeURIComponent(dnsServer)}`);
      const data = response.data;
      const outputText = extractOutputText(data);

      if (outputText) {
        const parsed = parseDnsServerInfo(outputText);
        setServerInfo(parsed);
        // Auto-detect server IP from server info
        if (parsed.ipFromServer) {
          setDnsServer(parsed.ipFromServer);
        }
      } else {
        const unwrapped = unwrapResponse(data) as Record<string, unknown>;
        setServerInfo(unwrapped as DnsServerInfo);
      }
    } catch {
      // Server info is optional
    }
  }, [dnsServer]);

  const loadRecords = useCallback(async (zone: string) => {
    setSelectedZone(zone);
    setZoneDetail(null);
    try {
      // Try rorecords first (read-only, works without write permissions)
      let response;
      try {
        response = await api.get(`/dns/zones/${encodeURIComponent(zone)}/rorecords?server=${encodeURIComponent(dnsServer)}`);
      } catch {
        response = await api.get(`/dns/zones/${encodeURIComponent(zone)}/records?server=${encodeURIComponent(dnsServer)}`);
      }
      const data = response.data;
      const outputText = extractOutputText(data);

      if (outputText) {
        const parsed = parseDnsRecords(outputText);
        setRecords(parsed.length > 0 ? parsed : []);
      } else if (Array.isArray(data)) {
        setRecords(data as DNSRecordInfo[]);
      } else if (data?.data && Array.isArray(data.data)) {
        setRecords(data.data as DNSRecordInfo[]);
      } else if (data?.records && Array.isArray(data.records)) {
        setRecords(data.records as DNSRecordInfo[]);
      } else {
        setRecords([]);
      }

      // Also load zone details
      try {
        const zoneRes = await api.get(`/dns/zones/${encodeURIComponent(zone)}?server=${encodeURIComponent(dnsServer)}`);
        const zoneData = zoneRes.data;
        const zoneOutputText = extractOutputText(zoneData);
        if (zoneOutputText) {
          const { parseKeyValueBlock } = await import('@/lib/parsers');
          setZoneDetail(parseKeyValueBlock(zoneOutputText));
        } else {
          const unwrapped = unwrapResponse(zoneData) as Record<string, unknown>;
          setZoneDetail(unwrapped as Record<string, string | string[]>);
        }
      } catch {
        // Zone details are optional
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedRecords')));
      setRecords([]);
    }
  }, [t, dnsServer]);

  useEffect(() => {
    loadZones();
    loadServerInfo();
  }, [loadZones, loadServerInfo]);

  const createZone = useCallback(async () => {
    try {
      await api.post('/dns/zones', { ...newZone, server: dnsServer });
      toast.success(`${t('dns.zoneCreated')}: ${newZone.zone}`);
      setCreateZoneOpen(false);
      loadZones();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedCreateZone')));
    }
  }, [newZone, loadZones, t, dnsServer]);

  const createRecord = useCallback(async () => {
    if (!selectedZone) return;
    try {
      await api.post(`/dns/zones/${encodeURIComponent(selectedZone)}/records`, { ...newRecord, server: dnsServer });
      toast.success(`${t('dns.recordCreated')}: ${newRecord.name}`);
      setCreateRecordOpen(false);
      loadRecords(selectedZone);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedCreateRecord')));
    }
  }, [selectedZone, newRecord, loadRecords, t, dnsServer]);

  const deleteZone = useCallback(async (zoneName: string) => {
    try {
      await api.delete(`/dns/zones/${encodeURIComponent(zoneName)}?server=${encodeURIComponent(dnsServer)}`);
      toast.success(`${t('dns.zoneDeleted')}: ${zoneName}`);
      setDeleteZoneOpen(false);
      if (selectedZone === zoneName) {
        setSelectedZone(null);
        setRecords([]);
        setZoneDetail(null);
      }
      loadZones();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedDeleteZone')));
    }
  }, [selectedZone, loadZones, t, dnsServer]);

  const deleteRecord = useCallback(async () => {
    if (!selectedZone || !deleteRecordData) return;
    try {
      await api.delete(`/dns/zones/${encodeURIComponent(selectedZone)}/records?server=${encodeURIComponent(dnsServer)}`, {
        data: {
          name: deleteRecordData.name,
          record_type: deleteRecordData.type,
          data: deleteRecordData.data,
        },
      });
      toast.success(`${t('dns.recordDeleted')}: ${deleteRecordData.name}`);
      setDeleteRecordOpen(false);
      setDeleteRecordData(null);
      loadRecords(selectedZone);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('dns.failedDeleteRecord')));
    }
  }, [selectedZone, deleteRecordData, loadRecords, t, dnsServer]);

  // Get the zone type badge color
  const getZoneTypeColor = (type?: string) => {
    if (!type) return 'outline';
    if (type.includes('PRIMARY')) return 'default';
    if (type.includes('SECONDARY')) return 'secondary';
    return 'outline';
  };

  return (
    <RequirePermission permission="dns.zonelist">
      <div className="space-y-4">
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="dns.zonecreate">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={() => setCreateZoneOpen(true)}>
              <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
              <span className="hidden sm:inline">{t('dns.createZone')}</span>
            </Button>
          </RequirePermission>
          <div className="flex-1" />
          <ColumnCustomizer
            entityType="dns"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={recordDataKeys}
          />
          <Button variant="outline" size="sm" onClick={() => { loadZones(); loadServerInfo(); }} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        <Tabs defaultValue="zones" className="w-full">
          <TabsList>
            <TabsTrigger value="zones" className="text-xs">
              <Globe className="w-3 h-3 mr-1" />
              {t('dns.zones')} ({zones.length})
            </TabsTrigger>
            <TabsTrigger value="server" className="text-xs">
              <Server className="w-3 h-3 mr-1" />
              {t('dns.serverInfo')}
            </TabsTrigger>
          </TabsList>

          {/* ── Zones Tab ── */}
          <TabsContent value="zones">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-2">
              {/* Zones list */}
              <Card className="lg:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    {t('dns.zones')}
                  </CardTitle>
                </CardHeader>
                <ScrollArea className="max-h-[calc(100vh-20rem)]">
                  <CardContent className="pt-0">
                    {loading ? (
                      <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
                    ) : zones.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">{t('common.noData')}</p>
                    ) : (
                      <div className="space-y-1">
                        {zones.map((zone, i) => (
                          <div
                            key={i}
                            role="button"
                            tabIndex={0}
                            onClick={() => loadRecords(zone.name)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadRecords(zone.name); } }}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors group cursor-pointer ${
                              selectedZone === zone.name ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-accent'
                            }`}
                          >
                            <Globe className="w-3 h-3 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="truncate block">{zone.name}</span>
                              {zone.zoneType && (
                                <span className="text-[10px] text-muted-foreground">{zone.zoneType.replace('DNS_ZONE_TYPE_', '')}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <RequirePermission permission="dns.zonedelete">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  onClick={(e) => { e.stopPropagation(); setSelectedZone(zone.name); setDeleteZoneOpen(true); }}
                                >
                                  <Trash2 className="w-3 h-3 text-red-400" />
                                </Button>
                              </RequirePermission>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>

              {/* Records + Zone Detail */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <List className="w-4 h-4" />
                      {t('dns.records')}
                      {selectedZone && <Badge variant="outline" className="text-xs">{selectedZone}</Badge>}
                    </CardTitle>
                    <RequirePermission permission="dns.recordcreate">
                      <Button size="sm" variant="outline" onClick={() => setCreateRecordOpen(true)} disabled={!selectedZone} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                        <FilePlus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                        <span className="hidden sm:inline">{t('dns.createRecord')}</span>
                      </Button>
                    </RequirePermission>
                  </div>
                </CardHeader>
                <ScrollArea className="max-h-[calc(100vh-20rem)]">
                  <CardContent className="pt-0">
                    {/* Zone details (key:value) */}
                    {zoneDetail && selectedZone && (
                      <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border/50">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                          <Info className="w-3 h-3" />
                          {t('dns.zoneDetails')}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                          {Object.entries(zoneDetail).map(([key, value]) => {
                            if (key === 'status' || key === 'message' || key.startsWith('psz') || 
                                key.startsWith('dw') || key.startsWith('aip') || key.startsWith('f') ||
                                key.startsWith('c') || key === 'Version') return null;
                            return (
                              <div key={key} className="flex justify-between text-xs py-0.5">
                                <span className="text-muted-foreground font-mono truncate">{key}</span>
                                <span className="text-right truncate max-w-[60%] ml-2">
                                  {Array.isArray(value) ? value.join(', ') : String(value)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Mobile card view for records */}
                    {isMobile && (
                      <div className="space-y-2 p-2 max-h-[50vh] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {loading ? (
                          <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
                        ) : records.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            {selectedZone ? t('dns.noRecords') : t('dns.selectZone')}
                          </div>
                        ) : (
                          records.map((record, i) => {
                            // Show ALL visible columns from ColumnCustomizer as metadata in the card,
                            // except actions (handled separately). This includes custom columns
                            // the user added. name/type/data/ttl are already shown as built-in fields.
                            const extraCols = visibleColumns.filter(c =>
                              c.key !== 'actions' &&
                              c.key !== 'name' && c.key !== 'type' &&
                              c.key !== 'data' && c.key !== 'ttl' // already shown as built-in fields
                            );
                            return (
                            <Card key={`m-${record.name}-${record.type}-${i}`} className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{record.name}</span>
                                    <Badge variant="outline" className="text-[10px] flex-shrink-0">{record.type}</Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{record.data}</div>
                                  {record.ttl && <div className="text-[10px] text-muted-foreground mt-0.5">TTL: {record.ttl}</div>}
                                  {/* Extra visible columns from ColumnCustomizer.
                                      Custom columns appear here as "key: value" rows. */}
                                  {extraCols.length > 0 && (
                                    <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                                      {extraCols.map(col => {
                                        const val = record[col.key as keyof typeof record];
                                        if (val === null || val === undefined || val === '') return null;
                                        const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
                                        return (
                                          <div key={col.key} className="flex items-start gap-1 text-[10px]">
                                            <span className="font-mono text-muted-foreground/70 flex-shrink-0">{col.label}:</span>
                                            <span className="font-mono text-muted-foreground truncate">{displayVal}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeleteRecordData(record); setDeleteRecordOpen(true); }} title={t('common.delete')}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                              </div>
                            </Card>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* Desktop table view */}
                    {!isMobile && (
                      records.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          {selectedZone ? t('dns.noRecords') : t('dns.selectZone')}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {visibleColumns.map(col => {
                                  if (col.key === 'actions') {
                                    return <TableHead key={col.key} className="w-16"></TableHead>;
                                  }
                                  const label = col.removable ? col.label : (
                                    col.key === 'name' ? t('dns.recordName') :
                                    col.key === 'type' ? t('dns.recordType') :
                                    col.key === 'data' ? t('dns.recordData') :
                                    col.key === 'ttl' ? t('dns.ttl') :
                                    col.label
                                  );
                                  return (
                                    <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined }} className="text-xs font-mono relative">
                                      {label}
                                      <ResizeHandle onResize={(d) => setColumnWidth(col.key, (getColumnWidth(col.key) || 150) + d)} />
                                    </TableHead>
                                  );
                                })}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {records.map((rec, i) => (
                                <TableRow key={i} className="group">
                                  {visibleColumns.map(col => {
                                    if (col.key === 'actions') {
                                      return (
                                        <TableCell key={col.key}>
                                          <RequirePermission permission="dns.recorddelete">
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                              onClick={() => { setDeleteRecordData(rec); setDeleteRecordOpen(true); }}
                                            >
                                              <Trash2 className="w-3 h-3 text-red-400" />
                                            </Button>
                                          </RequirePermission>
                                        </TableCell>
                                      );
                                    }
                                    if (col.key === 'name') {
                                      return <TableCell key={col.key} className="text-sm font-mono">{rec.name}</TableCell>;
                                    }
                                    if (col.key === 'type') {
                                      return (
                                        <TableCell key={col.key}>
                                          <Badge variant="outline" className="text-xs font-mono">{rec.type}</Badge>
                                        </TableCell>
                                      );
                                    }
                                    if (col.key === 'data') {
                                      return <TableCell key={col.key} className="text-sm font-mono max-w-xs truncate" title={rec.data}>{rec.data}</TableCell>;
                                    }
                                    if (col.key === 'ttl') {
                                      return <TableCell key={col.key} className="text-xs text-muted-foreground">{rec.ttl || '—'}</TableCell>;
                                    }
                                    // Generic extra column
                                    const value = (rec as unknown as Record<string, unknown>)[col.key];
                                    return (
                                      <TableCell key={col.key} className="text-xs font-mono">
                                        {value != null ? String(value) : '—'}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                              {records.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={visibleColCount} className="text-center text-muted-foreground py-8">
                                    {t('dns.noRecords')}
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>
          </TabsContent>

          {/* ── Server Info Tab ── */}
          <TabsContent value="server">
            <Card className="mt-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-500" />
                  {t('dns.serverInfo')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!serverInfo ? (
                  <p className="text-sm text-muted-foreground py-4">{t('common.noData')}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Key info cards */}
                    <div className="space-y-4">
                      {/* Server Name & Domain */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {serverInfo.serverName && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <p className="text-[10px] text-muted-foreground uppercase mb-1">{t('dns.serverName')}</p>
                            <p className="text-sm font-medium font-mono truncate">{serverInfo.serverName}</p>
                          </div>
                        )}
                        {serverInfo.domainName && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <p className="text-[10px] text-muted-foreground uppercase mb-1">{t('dns.domainName')}</p>
                            <p className="text-sm font-medium font-mono truncate">{serverInfo.domainName}</p>
                          </div>
                        )}
                        {serverInfo.forestName && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <p className="text-[10px] text-muted-foreground uppercase mb-1">{t('dns.forestName')}</p>
                            <p className="text-sm font-medium font-mono truncate">{serverInfo.forestName}</p>
                          </div>
                        )}
                        {serverInfo.ipFromServer && (
                          <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <p className="text-[10px] text-muted-foreground uppercase mb-1">{t('dns.ipAddress')}</p>
                            <p className="text-sm font-medium font-mono">{serverInfo.ipFromServer}</p>
                          </div>
                        )}
                      </div>

                      {/* Server Addresses */}
                      {serverInfo.serverAddrs && serverInfo.serverAddrs.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-2">{t('dns.serverAddresses')}</p>
                          <div className="flex flex-wrap gap-1">
                            {serverInfo.serverAddrs.map((addr, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-mono">
                                <MapPin className="w-2.5 h-2.5 mr-1" />
                                {addr}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Listen Addresses */}
                      {serverInfo.listenAddrs && serverInfo.listenAddrs.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-2">{t('dns.listenAddresses')}</p>
                          <div className="flex flex-wrap gap-1">
                            {serverInfo.listenAddrs.map((addr, i) => (
                              <Badge key={i} variant="secondary" className="text-xs font-mono">{addr}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Full details table */}
                    <ScrollArea className="max-h-[400px]">
                      <div className="space-y-1">
                        {Object.entries(serverInfo).map(([key, value]) => {
                          if (['status', 'message', 'serverAddrs', 'listenAddrs', 'ipFromServer',
                               'serverName', 'domainName', 'forestName', 'pszServerName',
                               'pszDomainName', 'pszForestName', 'aipServerAddrs', 'aipListenAddrs',
                               'fReadOnly', 'dwVersion'].includes(key)) return null;
                          if (typeof value === 'object' && value !== null) return null;
                          return (
                            <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-x-2 gap-y-0.5 text-xs py-1 border-b border-border/30">
                              <span className="text-muted-foreground font-mono truncate flex-shrink-0 sm:max-w-[40%]">{key}</span>
                              <span className="font-mono break-words min-w-0 flex-1 overflow-hidden">{String(value || '—')}</span>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Zone Dialog */}
        <Dialog open={createZoneOpen} onOpenChange={setCreateZoneOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dns.createZone')}</DialogTitle><DialogDescription className="sr-only">{t('dns.createZone')}</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('dns.zoneName')} *</Label>
                <Input value={newZone.zone} onChange={(e) => setNewZone(p => ({ ...p, zone: e.target.value }))} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('dns.partition')}</Label>
                <Select value={newZone.dns_directory_partition} onValueChange={(v) => setNewZone(p => ({ ...p, dns_directory_partition: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domain">Domain</SelectItem>
                    <SelectItem value="forest">Forest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createZone} disabled={!newZone.zone} className="w-full">{t('dns.createZone')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Create Record Dialog */}
        <Dialog open={createRecordOpen} onOpenChange={setCreateRecordOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dns.createRecord')}</DialogTitle><DialogDescription className="sr-only">{t('dns.createRecord')}</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('dns.recordName')} *</Label>
                <Input value={newRecord.name} onChange={(e) => setNewRecord(p => ({ ...p, name: e.target.value }))} className="h-8" placeholder="www" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('dns.recordType')}</Label>
                <Select value={newRecord.record_type} onValueChange={(v) => setNewRecord(p => ({ ...p, record_type: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SRV', 'TXT'].map(rt => (
                      <SelectItem key={rt} value={rt}>{rt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('dns.recordData')} *</Label>
                <Input value={newRecord.data} onChange={(e) => setNewRecord(p => ({ ...p, data: e.target.value }))} className="h-8" placeholder="192.168.1.1" />
              </div>
              <Button onClick={createRecord} disabled={!newRecord.name || !newRecord.data} className="w-full">{t('dns.createRecord')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Zone Dialog */}
        <Dialog open={deleteZoneOpen} onOpenChange={setDeleteZoneOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dns.deleteZone')}</DialogTitle><DialogDescription className="sr-only">{t('dns.deleteZone')}</DialogDescription></DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t('dns.confirmDeleteZone')}: <strong>{selectedZone}</strong>?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteZoneOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={() => selectedZone && deleteZone(selectedZone)}>{t('common.delete')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Record Dialog */}
        <Dialog open={deleteRecordOpen} onOpenChange={setDeleteRecordOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{t('dns.deleteRecord')}</DialogTitle><DialogDescription className="sr-only">{t('dns.deleteRecord')}</DialogDescription></DialogHeader>
          {deleteRecordData && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('dns.confirmDeleteRecord')}: <strong>{deleteRecordData.name} ({deleteRecordData.type})</strong>?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setDeleteRecordOpen(false); setDeleteRecordData(null); }}>{t('common.cancel')}</Button>
                <Button variant="destructive" onClick={deleteRecord}>{t('common.delete')}</Button>
              </div>
            </>
          )}
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
