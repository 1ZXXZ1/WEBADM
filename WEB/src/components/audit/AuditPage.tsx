'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import { ScrollText, Search, RefreshCw, Loader2, User, Clock, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import ColumnCustomizer, { useColumnConfig, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';

export default function AuditPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterAction, setFilterAction] = useState('');
  const [filterEndpoint, setFilterEndpoint] = useState('');

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'timestamp', label: t('audit.timestamp'), visible: true },
    { key: 'user_id', label: t('audit.user'), visible: true },
    { key: 'action', label: t('audit.action'), visible: true },
    { key: 'endpoint', label: t('audit.endpoint'), visible: true },
    { key: 'ip_address', label: t('audit.ipAddress'), visible: true },
  ];

  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('audit', defaultColumns);

  const visibleColCount = colConfig.filter(c => c.visible).length;

  const logDataKeys = useMemo(() => {
    const keySet = new Set<string>();
    logs.forEach(l => Object.keys(l).forEach(k => keySet.add(k)));
    return [...keySet].sort();
  }, [logs]);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { limit: 100 };
      if (filterAction) params.action = filterAction;
      if (filterEndpoint) params.endpoint = filterEndpoint;
      const response = await api.get('/mgmt/audit', { params });
      const data = response.data;
      setLogs(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(safeToastMessage(error.response?.data?.message || error?.message, t('audit.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterEndpoint]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  return (
    <RequirePermission permission="mgmt.audit.view">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder={t('audit.filterByAction')}
            className="h-8 text-sm max-w-xs"
          />
          <Input
            value={filterEndpoint}
            onChange={(e) => setFilterEndpoint(e.target.value)}
            placeholder={t('audit.filterByEndpoint')}
            className="h-8 text-sm max-w-xs"
          />
          <ColumnCustomizer
            entityType="audit"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={logDataKeys}
          />
          <Button variant="outline" size="sm" onClick={loadAudit} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>

        <Card className="overflow-hidden">
          <ScrollArea className="h-[calc(100vh-14rem)]">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {isColumnVisible('#') && <TableHead className="w-12 relative">
                    #
                    <ResizeHandle onResize={(d) => setColumnWidth('#', (getColumnWidth('#') || 48) + d)} />
                  </TableHead>}
                  {isColumnVisible('timestamp') && <TableHead style={{ width: getColumnWidth('timestamp') || undefined }} className="relative">
                    {t('audit.timestamp')}
                    <ResizeHandle onResize={(d) => setColumnWidth('timestamp', (getColumnWidth('timestamp') || 150) + d)} />
                  </TableHead>}
                  {isColumnVisible('user_id') && <TableHead style={{ width: getColumnWidth('user_id') || undefined }} className="relative">
                    {t('audit.user')}
                    <ResizeHandle onResize={(d) => setColumnWidth('user_id', (getColumnWidth('user_id') || 150) + d)} />
                  </TableHead>}
                  {isColumnVisible('action') && <TableHead style={{ width: getColumnWidth('action') || undefined }} className="relative">
                    {t('audit.action')}
                    <ResizeHandle onResize={(d) => setColumnWidth('action', (getColumnWidth('action') || 150) + d)} />
                  </TableHead>}
                  {isColumnVisible('endpoint') && <TableHead style={{ width: getColumnWidth('endpoint') || undefined }} className="relative">
                    {t('audit.endpoint')}
                    <ResizeHandle onResize={(d) => setColumnWidth('endpoint', (getColumnWidth('endpoint') || 150) + d)} />
                  </TableHead>}
                  {isColumnVisible('ip_address') && <TableHead style={{ width: getColumnWidth('ip_address') || undefined }} className="relative">
                    {t('audit.ipAddress')}
                    <ResizeHandle onResize={(d) => setColumnWidth('ip_address', (getColumnWidth('ip_address') || 150) + d)} />
                  </TableHead>}
                  {extraVisibleColumns.map(col => (
                    <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined }} className="relative">
                      {col.label}
                      <ResizeHandle onResize={(d) => setColumnWidth(col.key, (getColumnWidth(col.key) || 150) + d)} />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={visibleColCount} className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : logs.length === 0 ? (
                  <TableRow><TableCell colSpan={visibleColCount} className="text-center py-8 text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
                ) : (
                  logs.map((log, i) => (
                    <TableRow key={i}>
                      {isColumnVisible('#') && <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>}
                      {isColumnVisible('timestamp') && (
                        <TableCell className="text-xs font-mono">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            {String(log.timestamp || log.created_at || '')}
                          </div>
                        </TableCell>
                      )}
                      {isColumnVisible('user_id') && (
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {String(log.user_id || log.username || '')}
                          </div>
                        </TableCell>
                      )}
                      {isColumnVisible('action') && (
                        <TableCell className="text-sm font-mono">{String(log.action || '')}</TableCell>
                      )}
                      {isColumnVisible('endpoint') && (
                        <TableCell className="text-xs font-mono">
                          <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            {String(log.endpoint || '')}
                          </div>
                        </TableCell>
                      )}
                      {isColumnVisible('ip_address') && (
                        <TableCell className="text-xs font-mono">{String(log.ip_address || '')}</TableCell>
                      )}
                      {extraVisibleColumns.map(col => (
                        <TableCell key={col.key} className="text-xs font-mono">
                          {String(log[col.key] ?? '')}
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
    </RequirePermission>
  );
}
