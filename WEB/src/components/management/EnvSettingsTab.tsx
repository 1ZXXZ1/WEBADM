'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { getErrorMessage } from '@/lib/api';
import {
  FileText, RefreshCw, Loader2, Eye, EyeOff, Plus, Trash2,
  Power, PowerOff, Search, Download, Upload, Save, X, KeyRound, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface EnvItem {
  key: string;
  value: string;
  masked: boolean;
  sensitive: boolean;
  comment: string | null;
}

interface EnvListResponse {
  status: string;
  env_file: string;
  env_file_exists: boolean;
  count: number;
  items: EnvItem[];
}

interface EnvSchemaField {
  field: string;
  env_names: string[];
  default: unknown;
  description: string;
  sensitive: boolean;
}

interface EnvSchemaResponse {
  status: string;
  count: number;
  fields: EnvSchemaField[];
}

/**
 * ENV Settings tab — manage the backend .env file via the CFG API.
 * Docs: /api/v1/cfg (see cfg-api.md v2.1)
 */
export default function EnvSettingsTab() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  const [items, setItems] = useState<EnvItem[]>([]);
  const [schema, setSchema] = useState<EnvSchemaField[]>([]);
  const [envFile, setEnvFile] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [search, setSearch] = useState('');
  const [onlySensitive, setOnlySensitive] = useState(false);

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editComment, setEditComment] = useState('');
  const [editIsNew, setEditIsNew] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newComment, setNewComment] = useState('');

  // Bulk dialog
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const loadEnv = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<EnvListResponse>('/cfg', { params: { reveal } });
      const data = res.data;
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      setEnvFile(data?.env_file || '');
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, [reveal, t]);

  const loadSchema = useCallback(async () => {
    try {
      const res = await api.get<EnvSchemaResponse>('/cfg/schema');
      const data = res.data;
      setSchema(Array.isArray(data?.fields) ? data.fields : []);
    } catch {
      // Schema is optional; ignore errors silently
    }
  }, []);

  useEffect(() => {
    loadEnv();
    loadSchema();
  }, [loadEnv, loadSchema]);

  // Reload when reveal toggles
  useEffect(() => {
    loadEnv();
  }, [reveal, loadEnv]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (onlySensitive && !it.sensitive) return false;
      if (!q) return true;
      return it.key.toLowerCase().includes(q) || (it.comment || '').toLowerCase().includes(q) || it.value.toLowerCase().includes(q);
    });
  }, [items, search, onlySensitive]);

  const schemaMap = useMemo(() => {
    const m = new Map<string, EnvSchemaField>();
    for (const f of schema) {
      for (const n of f.env_names || []) m.set(n, f);
    }
    return m;
  }, [schema]);

  const openEdit = useCallback((item: EnvItem) => {
    setEditKey(item.key);
    setEditValue(item.value);
    setEditComment(item.comment || '');
    setEditIsNew(false);
    setEditDialogOpen(true);
  }, []);

  const openCreate = useCallback(() => {
    setNewKey('');
    setNewValue('');
    setNewComment('');
    setCreateDialogOpen(true);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editKey.trim()) return;
    setEditSaving(true);
    try {
      await api.put(`/cfg/${encodeURIComponent(editKey)}`, {
        value: editValue,
        comment: editComment || undefined,
      });
      toast.success(t('management.env.saved', { key: editKey }));
      setEditDialogOpen(false);
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedSave')));
    } finally {
      setEditSaving(false);
    }
  }, [editKey, editValue, editComment, loadEnv, t]);

  const createNew = useCallback(async () => {
    const key = newKey.trim();
    if (!key) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      toast.error(t('management.env.invalidKey'));
      return;
    }
    try {
      await api.put(`/cfg/${encodeURIComponent(key)}`, {
        value: newValue,
        comment: newComment || undefined,
      });
      toast.success(t('management.env.created', { key }));
      setCreateDialogOpen(false);
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedCreate')));
    }
  }, [newKey, newValue, newComment, loadEnv, t]);

  const deleteVar = useCallback(async (key: string) => {
    if (!confirm(t('management.env.confirmDelete', { key }))) return;
    try {
      await api.delete(`/cfg/${encodeURIComponent(key)}`);
      toast.success(t('management.env.deleted', { key }));
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedDelete')));
    }
  }, [loadEnv, t]);

  const disableVar = useCallback(async (key: string, asFalse: boolean) => {
    try {
      await api.post(`/cfg/${encodeURIComponent(key)}/disable`, null, { params: { as_false: asFalse } });
      toast.success(t('management.env.disabled', { key }));
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedDisable')));
    }
  }, [loadEnv, t]);

  const enableVar = useCallback(async (key: string) => {
    try {
      await api.post(`/cfg/${encodeURIComponent(key)}/enable`);
      toast.success(t('management.env.enabled', { key }));
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedEnable')));
    }
  }, [loadEnv, t]);

  const reloadCfg = useCallback(async () => {
    try {
      await api.post('/cfg/reload');
      toast.success(t('management.env.reloaded'));
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedReload')));
    }
  }, [loadEnv, t]);

  // Persist local .env to /etc/webadc/.env (global env file)
  // New endpoint: POST /api/v1/cfg/persist?sync_runtime=true
  // Returns { status, global_env_file, synced_count, synced_keys, error }
  const [persisting, setPersisting] = useState(false);
  const persistEnv = useCallback(async () => {
    setPersisting(true);
    try {
      const res = await api.post('/cfg/persist', null, { params: { sync_runtime: true } });
      const data = res.data;
      const syncedCount = data?.synced_count ?? 0;
      const globalFile = data?.global_env_file || '/etc/webadc/.env';
      if (data?.error) {
        toast.warning(t('management.env.persistPartial', {
          count: syncedCount,
          file: globalFile,
          error: data.error,
          defaultValue: `Синхронизировано ${syncedCount} ключей в ${globalFile}, но есть ошибки: ${data.error}`,
        }));
      } else {
        toast.success(t('management.env.persisted', {
          count: syncedCount,
          file: globalFile,
          defaultValue: `Синхронизировано ${syncedCount} ключей в ${globalFile}`,
        }));
      }
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedPersist', { defaultValue: 'Не удалось синхронизировать .env' })));
    } finally {
      setPersisting(false);
    }
  }, [t]);

  const downloadRaw = useCallback(async () => {
    try {
      const res = await api.get('/cfg/raw', { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.env';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('management.env.downloaded'));
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedDownload')));
    }
  }, [t]);

  const openBulk = useCallback(() => {
    // Pre-fill with current items as KEY=value
    const text = items.map(it => `${it.key}=${it.value}`).join('\n');
    setBulkText(text);
    setBulkDialogOpen(true);
  }, [items]);

  const saveBulk = useCallback(async () => {
    // Parse bulk text into { KEY: value, ... }
    const lines = bulkText.split('\n');
    const obj: Record<string, string> = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!k) continue;
      obj[k] = v;
    }
    if (Object.keys(obj).length === 0) {
      toast.error(t('management.env.bulkEmpty'));
      return;
    }
    setBulkSaving(true);
    try {
      const res = await api.post('/cfg/bulk', { items: obj, reload: true });
      const updated = (res.data as { updated?: number })?.updated ?? Object.keys(obj).length;
      toast.success(t('management.env.bulkSaved', { count: updated }));
      setBulkDialogOpen(false);
      loadEnv();
    } catch (err: unknown) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.env.failedBulk')));
    } finally {
      setBulkSaving(false);
    }
  }, [bulkText, loadEnv, t]);

  const isDisabled = useCallback((item: EnvItem) => {
    return item.value === '' || item.value === 'false';
  }, []);

  const renderItemValue = (item: EnvItem) => {
    if (item.masked && !reveal) {
      return (
        <span className="font-mono text-xs text-amber-400/80 flex items-center gap-1">
          <KeyRound className="w-3 h-3" />
          {item.value}
        </span>
      );
    }
    if (item.value === '') {
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">{t('management.env.empty')}</Badge>;
    }
    if (item.value === 'false') {
      return <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">false</Badge>;
    }
    if (item.value === 'true') {
      return <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">true</Badge>;
    }
    return <span className="font-mono text-xs truncate max-w-[300px] block" title={item.value}>{item.value}</span>;
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1 md:gap-2 flex-wrap">
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('management.env.create')}</span>
        </Button>

        <Button size="sm" variant="outline" onClick={openBulk} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <Upload className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
          <span className="hidden sm:inline">{t('management.env.bulk')}</span>
        </Button>

        <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/30">
          <Label className="text-[10px] flex items-center gap-1 cursor-pointer">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">{t('management.env.onlySensitive')}</span>
          </Label>
          <Switch checked={onlySensitive} onCheckedChange={setOnlySensitive} />
        </div>

        <div className="flex items-center gap-1 px-2 py-1 rounded border bg-muted/30">
          <Label className="text-[10px] flex items-center gap-1 cursor-pointer">
            {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span className="hidden sm:inline">{t('management.env.reveal')}</span>
          </Label>
          <Switch checked={reveal} onCheckedChange={setReveal} />
        </div>

        <div className="flex-1" />

        <Button size="sm" variant="outline" onClick={downloadRaw} title={t('management.env.downloadRaw')} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <Download className="w-3.5 h-3.5 md:mr-1" />
          <span className="hidden sm:inline">{t('management.env.download')}</span>
        </Button>

        <Button
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm"
          onClick={persistEnv}
          disabled={persisting}
          title={t('management.env.persistHint', { defaultValue: 'Синхронизировать локальный .env в /etc/webadc/.env (global env file) + применить в runtime' })}
        >
          {persisting ? <Loader2 className="w-3.5 h-3.5 md:mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 md:mr-1" />}
          <span className="hidden sm:inline">{t('management.env.persist', { defaultValue: 'Сохранить в /etc/webadc/.env' })}</span>
        </Button>

        <Button size="sm" variant="outline" onClick={reloadCfg} title={t('management.env.reloadHint')} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className="w-3.5 h-3.5 md:mr-1" />
          <span className="hidden sm:inline">{t('management.env.reload')}</span>
        </Button>

        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('management.env.search')}
            className="h-8 md:h-9 text-xs pl-7 pr-7 w-full"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title={t('common.cancel')}
              aria-label={t('common.cancel')}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <Button size="sm" variant="outline" onClick={loadEnv} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
          <RefreshCw className={`w-3.5 h-3.5 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('common.refresh')}</span>
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          <FileText className="w-2.5 h-2.5 mr-1" />
          {envFile || '/etc/webadc/.env'}
        </Badge>
        <span>{t('management.env.totalItems', { count: items.length })}</span>
        <span>•</span>
        <span>{t('management.env.sensitiveCount', { count: items.filter(i => i.sensitive).length })}</span>
        <span>•</span>
        <span>{t('management.env.disabledCount', { count: items.filter(i => isDisabled(i)).length })}</span>
        {schema.length > 0 && (
          <>
            <span>•</span>
            <span>{t('management.env.schemaCount', { count: schema.length })}</span>
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
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : filteredItems.map((item, i) => {
            const disabled = isDisabled(item);
            const schemaInfo = schemaMap.get(item.key);
            return (
              <Card key={`m-${item.key}`} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-7 h-7 rounded bg-muted flex items-center justify-center">
                    {item.sensitive ? (
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs font-medium truncate">{item.key}</span>
                      <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                      {disabled ? (
                        <Badge variant="secondary" className="text-[10px]">{t('common.disabled')}</Badge>
                      ) : (
                        <Badge variant="default" className="text-[10px]">{t('common.active')}</Badge>
                      )}
                    </div>
                    {schemaInfo?.description && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5" title={schemaInfo.description}>
                        {schemaInfo.description}
                      </div>
                    )}
                    <div className="mt-1">
                      {renderItemValue(item)}
                    </div>
                    {item.comment && (
                      <div className="text-xs text-muted-foreground italic truncate mt-0.5" title={item.comment}>{item.comment}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)} title={t('common.edit')}>
                    <FileText className="w-4 h-4 text-blue-400" />
                  </Button>
                  {disabled ? (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => enableVar(item.key)} title={t('management.env.enable')}>
                      <Power className="w-4 h-4 text-emerald-400" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => disableVar(item.key, item.value === 'true' || item.value === 'false')} title={t('management.env.disable')}>
                      <PowerOff className="w-4 h-4 text-amber-400" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteVar(item.key)} title={t('common.delete')}>
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Desktop table */}
      {!isMobile && (
      <Card className="overflow-hidden">
        <div
          className="overflow-auto max-h-[calc(100vh-22rem)] overscroll-contain"
          style={{ scrollBehavior: 'auto', WebkitOverflowScrolling: 'touch' }}
          onWheel={(e) => { /* allow native wheel scrolling */ e.stopPropagation(); }}
        >
          <div className="min-w-max">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 bg-background z-10">
                  <TableHead className="w-12 text-[10px]">#</TableHead>
                  <TableHead className="text-[10px] min-w-[180px]">{t('management.env.key')}</TableHead>
                  <TableHead className="text-[10px] min-w-[200px]">{t('management.env.value')}</TableHead>
                  <TableHead className="text-[10px] min-w-[180px]">{t('management.env.comment')}</TableHead>
                  <TableHead className="text-[10px] w-20">{t('common.status')}</TableHead>
                  <TableHead className="text-[10px] w-32">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t('common.noData')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item, i) => {
                    const disabled = isDisabled(item);
                    const schemaInfo = schemaMap.get(item.key);
                    return (
                      <TableRow key={item.key} className="group">
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.sensitive ? (
                              <KeyRound className="w-3 h-3 text-amber-400 flex-shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400/70 flex-shrink-0" />
                            )}
                            <span className="font-mono text-xs font-medium">{item.key}</span>
                          </div>
                          {schemaInfo?.description && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 ml-5 truncate max-w-[300px]" title={schemaInfo.description}>
                              {schemaInfo.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{renderItemValue(item)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.comment ? (
                            <span className="italic truncate max-w-[200px] block" title={item.comment}>{item.comment}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {disabled ? (
                            <Badge variant="secondary" className="text-[10px]">{t('common.disabled')}</Badge>
                          ) : (
                            <Badge variant="default" className="text-[10px]">{t('common.active')}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)} title={t('common.edit')}>
                              <FileText className="w-3 h-3 text-blue-400" />
                            </Button>
                            {disabled ? (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => enableVar(item.key)} title={t('management.env.enable')}>
                                <Power className="w-3 h-3 text-emerald-400" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => disableVar(item.key, item.value === 'true' || item.value === 'false')} title={t('management.env.disable')}>
                                <PowerOff className="w-3 h-3 text-amber-400" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteVar(item.key)} title={t('common.delete')}>
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] flex flex-col gap-4 p-0 overflow-hidden">
          <DialogHeader className="px-4 md:px-6 pt-6 pb-3 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4" />
              {t('management.env.editTitle')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.env.editTitle')}</DialogDescription>
          </DialogHeader>
          <div
            className="flex-1 min-h-0 overflow-auto px-4 md:px-6 py-4 space-y-3"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <Label className="text-xs">{t('management.env.key')}</Label>
              <Input value={editKey} disabled className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.env.value')}</Label>
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="text-sm font-mono w-full resize-none"
                style={{ minHeight: '120px', maxHeight: '40vh' }}
                placeholder={t('management.env.valuePlaceholder')}
              />
              <p className="text-[10px] text-muted-foreground">{t('management.env.valueHint')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('common.description')}</Label>
              <Input
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                className="h-8 text-sm"
                placeholder={t('management.env.commentPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter className="px-4 md:px-6 py-4 border-t bg-background flex-shrink-0">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveEdit} disabled={editSaving || !editKey.trim()}>
              {editSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] flex flex-col gap-4 p-0 overflow-hidden">
          <DialogHeader className="px-4 md:px-6 pt-6 pb-3 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" />
              {t('management.env.createTitle')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.env.createTitle')}</DialogDescription>
          </DialogHeader>
          <div
            className="flex-1 min-h-0 overflow-auto px-4 md:px-6 py-4 space-y-3"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <Label className="text-xs">{t('management.env.key')} *</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="h-8 text-sm font-mono"
                placeholder="SAMBA_MY_NEW_VAR"
              />
              <p className="text-[10px] text-muted-foreground">{t('management.env.keyHint')}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('management.env.value')}</Label>
              <Textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="text-sm font-mono w-full resize-none"
                style={{ minHeight: '120px', maxHeight: '40vh' }}
                placeholder={t('management.env.valuePlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('common.description')}</Label>
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="h-8 text-sm"
                placeholder={t('management.env.commentPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter className="px-4 md:px-6 py-4 border-t bg-background flex-shrink-0">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createNew} disabled={!newKey.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk edit dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] flex flex-col gap-4 p-0 overflow-hidden">
          <DialogHeader className="px-4 md:px-6 pt-6 pb-3 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Upload className="w-4 h-4" />
              {t('management.env.bulkTitle')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('management.env.bulkTitle')}</DialogDescription>
          </DialogHeader>
          <div
            className="flex-1 min-h-0 overflow-auto px-4 md:px-6 py-4 space-y-3"
            style={{ WebkitOverflowScrolling: 'touch' }}
            onWheel={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-muted-foreground flex-shrink-0">{t('management.env.bulkHint')}</p>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="text-xs font-mono w-full resize-none"
              style={{ minHeight: '50vh', maxHeight: '60vh' }}
              placeholder={'SAMBA_API_PORT=9000\nSAMBA_LOG_LEVEL=DEBUG\nWEB_ENABLED=true'}
            />
          </div>
          <DialogFooter className="px-4 md:px-6 py-4 border-t bg-background flex-shrink-0">
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveBulk} disabled={bulkSaving}>
              {bulkSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
