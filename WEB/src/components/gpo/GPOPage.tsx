'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import { parseGpoList, extractOutputText, safeToastMessage } from '@/lib/parsers';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import { FileText, Trash2, Eye, Search, RefreshCw, Plus, Loader2, PenLine, Link2, Unlink, Archive, ShieldCheck, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface GpoEntry {
  gpo_id: string;
  displayname: string;
  dn?: string;
  cn?: string;
  displayName?: string;
  gPCFileSysPath?: string;
  versionNumber?: string | number;
  flags?: string | number;
  objectClass?: string | string[];
  status?: string;
  distinguishedName?: string;
  [key: string]: unknown;
}

export default function GPOPage() {
  const { t } = useTranslation();
  // useIsMobile checks the SHORT side of the screen, so it returns true
  // both in narrow portrait AND in forced-landscape rotate mode.
  const isMobile = useIsMobile();
  // effectiveLandscape: true when device is in landscape (natural or forced).
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [gpos, setGpos] = useState<GpoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGpo, setSelectedGpo] = useState<string | null>(null);
  const [gpoDetails, setGpoDetails] = useState<GpoEntry | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newGpoName, setNewGpoName] = useState('');

  // Edit GPO dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editGpoId, setEditGpoId] = useState('');
  const [editGpoName, setEditGpoName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editContainerDn, setEditContainerDn] = useState('');
  const [editTargetDir, setEditTargetDir] = useState('');
  const [editBlockInheritance, setEditBlockInheritance] = useState(false);

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'displayName', label: t('gpo.displayName'), visible: true },
    { key: 'cn', label: t('gpo.gpoId'), visible: true },
    { key: 'versionNumber', label: t('gpo.version'), visible: true },
    { key: 'status', label: t('common.status'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('gpo', defaultColumns);

  const gpoDataKeys = useMemo(() => {
    return extractAllKeys(gpos as unknown as Record<string, unknown>[]);
  }, [gpos]);

  /**
   * Normalize a raw GPO object (from any API format) into a GpoEntry.
   * Ensures gpo_id and displayname are always populated.
   */
  const normalizeGpoEntry = (gpo: Record<string, unknown>): GpoEntry => {
    const cn = typeof gpo.cn === 'string' ? gpo.cn : '';
    const displayName = typeof gpo.displayName === 'string' ? gpo.displayName : '';
    const gpoId = cn || (typeof gpo.gpo_id === 'string' ? gpo.gpo_id : '') || (typeof gpo.GPO === 'string' ? gpo.GPO : '');
    const displayname = displayName || (typeof gpo.displayname === 'string' ? gpo.displayname : '') || (typeof gpo['display name'] === 'string' ? gpo['display name'] : '') || cn || gpoId;

    return {
      gpo_id: gpoId,
      displayname,
      ...gpo,
      // Ensure our normalized fields take precedence if the raw data was missing them
      ...(cn ? { cn } : {}),
      ...(displayName ? { displayName } : {}),
    };
  };

  const loadGpos = useCallback(async () => {
    setLoading(true);
    try {
      let gpoList: GpoEntry[] = [];

      // Strategy 1: Try /gpo/listall first (dedicated endpoint)
      try {
        const response = await api.get('/gpo/listall');
        const data = response.data;
        gpoList = parseGpoResponse(data);
      } catch {
        // fallback to next strategy
      }

      // Strategy 2: Try /gpo/ endpoint
      if (gpoList.length === 0) {
        try {
          const response = await api.get('/gpo/');
          const data = response.data;
          gpoList = parseGpoResponse(data);
        } catch {
          // fallback to next strategy
        }
      }

      // Strategy 3: Try /dashboard/full as fallback (returns pre-fetched LDAP objects)
      if (gpoList.length === 0) {
        try {
          const response = await api.get('/dashboard/full');
          const data = response.data;
          if (data?.gpos && Array.isArray(data.gpos)) {
            gpoList = data.gpos.map((gpo: Record<string, unknown>) => normalizeGpoEntry(gpo));
          }
        } catch {
          // fallback
        }
      }

      setGpos(gpoList);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Parse GPO data from various API response formats into GpoEntry[].
   * Handles all known response shapes from the Samba AD API.
   */
  const parseGpoResponse = (data: unknown): GpoEntry[] => {
    if (!data) return [];

    const d = data as Record<string, unknown>;

    // Handle {status: "ok", gpos: [...full LDAP objects...]}
    if (d.gpos && Array.isArray(d.gpos)) {
      return d.gpos.map((gpo: Record<string, unknown>) => normalizeGpoEntry(gpo));
    }

    // Handle array directly
    if (Array.isArray(d)) {
      return d.map((gpo: unknown) => {
        if (typeof gpo === 'string') {
          return { gpo_id: gpo, displayname: gpo };
        }
        if (typeof gpo === 'object' && gpo !== null) {
          return normalizeGpoEntry(gpo as Record<string, unknown>);
        }
        return { gpo_id: String(gpo), displayname: String(gpo) };
      });
    }

    // Try extracting samba-tool text output from various wrappers
    const outputText = extractOutputText(data);
    if (outputText) {
      const parsed = parseGpoList(outputText);
      if (parsed.length > 0) {
        return parsed.map(gpo => ({
          gpo_id: gpo.gpoId,
          displayname: gpo.displayname,
          dn: gpo.dn,
          gPCFileSysPath: gpo.path,
          versionNumber: gpo.version,
          flags: gpo.flags,
        }));
      }
    }

    // Handle data.data format
    if (d.data) {
      if (typeof d.data === 'object' && !Array.isArray(d.data)) {
        const inner = d.data as Record<string, unknown>;
        // Check if data.data has output (samba-tool text)
        if (typeof inner.output === 'string') {
          const parsed = parseGpoList(inner.output);
          if (parsed.length > 0) {
            return parsed.map(gpo => ({
              gpo_id: gpo.gpoId,
              displayname: gpo.displayname,
              dn: gpo.dn,
              gPCFileSysPath: gpo.path,
              versionNumber: gpo.version,
              flags: gpo.flags,
            }));
          }
        }
        // Check if data.data.gpos is an array (nested {data:{gpos:[...]}})
        if (inner.gpos && Array.isArray(inner.gpos)) {
          return inner.gpos.map((gpo: Record<string, unknown>) => normalizeGpoEntry(gpo));
        }
        // Check if data.data.items is an array
        if (inner.items && Array.isArray(inner.items)) {
          return inner.items.map((gpo: Record<string, unknown>) => normalizeGpoEntry(gpo));
        }
        // Object with GUID keys — skip known non-GPO keys
        const skipKeys = new Set(['output', 'status', 'message', 'gpos', 'items', 'data', 'count', 'total', 'error']);
        const entries: GpoEntry[] = [];
        for (const [guid, gpoData] of Object.entries(inner)) {
          if (skipKeys.has(guid)) continue;
          if (typeof gpoData === 'object' && gpoData !== null) {
            entries.push(normalizeGpoEntry({ ...gpoData as Record<string, unknown>, cn: guid }));
          } else {
            entries.push({ gpo_id: guid, displayname: String(gpoData) });
          }
        }
        return entries;
      } else if (Array.isArray(d.data)) {
        return parseGpoResponse(d.data);
      }
    }

    // Handle data.items
    if (d.items && Array.isArray(d.items)) {
      return parseGpoResponse(d.items);
    }

    // Handle data.result
    if (d.result) {
      if (Array.isArray(d.result)) {
        return parseGpoResponse(d.result);
      } else if (typeof d.result === 'object') {
        const result = d.result as Record<string, unknown>;
        // Try output text first
        if (typeof result.output === 'string') {
          const parsed = parseGpoList(result.output);
          if (parsed.length > 0) {
            return parsed.map(gpo => ({
              gpo_id: gpo.gpoId,
              displayname: gpo.displayname,
              dn: gpo.dn,
              gPCFileSysPath: gpo.path,
              versionNumber: gpo.version,
              flags: gpo.flags,
            }));
          }
        }
        // Check if result.gpos is an array
        if (result.gpos && Array.isArray(result.gpos)) {
          return result.gpos.map((gpo: Record<string, unknown>) => normalizeGpoEntry(gpo));
        }
        // Result could be an object with GUID keys — skip known non-GPO keys
        const skipKeys = new Set(['output', 'status', 'message', 'gpos', 'items', 'data', 'count', 'total', 'error']);
        const entries: GpoEntry[] = [];
        for (const [guid, gpoData] of Object.entries(result)) {
          if (skipKeys.has(guid)) continue;
          if (typeof gpoData === 'object' && gpoData !== null) {
            entries.push(normalizeGpoEntry({ ...gpoData as Record<string, unknown>, cn: guid }));
          } else {
            entries.push({ gpo_id: guid, displayname: String(gpoData) });
          }
        }
        return entries;
      }
    }

    return [];
  };

  useEffect(() => { loadGpos(); }, [loadGpos]);

  const showGpo = useCallback(async (gpoId: string) => {
    setSelectedGpo(gpoId);
    setDetailsDialogOpen(true);
    setDetailsLoading(true);
    setGpoDetails(null);

    // First try to find from already-loaded data by gpo_id, cn, or displayName
    const found = gpos.find(g => g.gpo_id === gpoId || g.cn === gpoId || g.displayName === gpoId);

    // Try to fetch full details from API
    try {
      const response = await api.get(`/gpo/${encodeURIComponent(gpoId)}`);
      const data = response.data;
      const outputText = extractOutputText(data);

      if (outputText) {
        // Parse samba-tool text output into a GpoEntry with all attributes
        const parsed = parseGpoList(outputText);
        if (parsed.length > 0) {
          const p = parsed[0];
          setGpoDetails({
            ...found,
            gpo_id: p.gpoId || gpoId,
            displayname: p.displayname || found?.displayname || '',
            dn: p.dn || found?.dn,
            gPCFileSysPath: p.path || found?.gPCFileSysPath,
            versionNumber: p.version !== undefined ? p.version : found?.versionNumber,
            flags: p.flags || found?.flags,
          } as GpoEntry);
          setDetailsLoading(false);
          return;
        }
      }

      // Try to unwrap structured data
      const unwrapped = data?.data ?? data?.result ?? data;
      if (typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)) {
        const merged = { ...found, ...unwrapped as Record<string, unknown> } as GpoEntry;
        // Ensure gpo_id and displayname are populated
        if (!merged.gpo_id) merged.gpo_id = gpoId;
        if (!merged.displayname) merged.displayname = merged.displayName || merged.cn || gpoId;
        setGpoDetails(merged);
        setDetailsLoading(false);
        return;
      }
    } catch {
      // API fetch failed — use local data
    }

    // Fallback to local data
    setGpoDetails(found || null);
    setDetailsLoading(false);
  }, [gpos]);

  const createGpo = useCallback(async () => {
    try {
      await api.post('/gpo/', { displayname: newGpoName });
      toast.success(`${t('gpo.gpoCreated')}: ${newGpoName}`);
      setCreateDialogOpen(false);
      setNewGpoName('');
      loadGpos();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedCreate')));
    }
  }, [newGpoName, loadGpos]);

  const deleteGpo = useCallback(async (gpoId: string) => {
    if (!confirm(`${t('gpo.confirmDelete')}: ${gpoId}?`)) return;
    try {
      const response = await api.delete(`/gpo/${encodeURIComponent(gpoId)}`);
      const data = response.data;
      if (data?.task_id) {
        toast.success(`${t('gpo.gpoDeleted')} (task: ${data.task_id})`);
      } else {
        toast.success(`${t('gpo.gpoDeleted')}: ${gpoId}`);
      }
      loadGpos();
      if (selectedGpo === gpoId) setSelectedGpo(null);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedDelete')));
    }
  }, [loadGpos, selectedGpo]);

  // Open edit dialog for a GPO
  const openEditDialog = useCallback((gpoId: string, gpoDisplayName: string) => {
    setEditGpoId(gpoId);
    setEditGpoName(gpoDisplayName);
    setEditContainerDn('');
    setEditTargetDir('');
    setEditBlockInheritance(false);
    setEditDialogOpen(true);
  }, []);

  // Edit GPO: link to container
  const handleLinkGpo = useCallback(async () => {
    if (!editGpoId || !editContainerDn) return;
    setEditLoading(true);
    try {
      await api.post(`/gpo/${encodeURIComponent(editGpoId)}/link`, {
        container_dn: editContainerDn,
      });
      toast.success(t('gpo.gpoLinked'));
      setEditContainerDn('');
      loadGpos();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedLink')));
    } finally { setEditLoading(false); }
  }, [editGpoId, editContainerDn, loadGpos, t]);

  // Edit GPO: unlink from container
  const handleUnlinkGpo = useCallback(async () => {
    if (!editGpoId || !editContainerDn) return;
    setEditLoading(true);
    try {
      await api.post(`/gpo/${encodeURIComponent(editGpoId)}/unlink`, {
        container_dn: editContainerDn,
      });
      toast.success(t('gpo.gpoUnlinked'));
      setEditContainerDn('');
      loadGpos();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedUnlink')));
    } finally { setEditLoading(false); }
  }, [editGpoId, editContainerDn, loadGpos, t]);

  // Edit GPO: backup
  const handleBackupGpo = useCallback(async () => {
    if (!editGpoId || !editTargetDir) return;
    setEditLoading(true);
    try {
      await api.post(`/gpo/${encodeURIComponent(editGpoId)}/backup`, {
        target_dir: editTargetDir,
      });
      toast.success(t('gpo.gpoBackedUp'));
      setEditTargetDir('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedBackup')));
    } finally { setEditLoading(false); }
  }, [editGpoId, editTargetDir, t]);

  // Edit GPO: set inheritance
  const handleSetInheritance = useCallback(async () => {
    if (!editGpoId) return;
    setEditLoading(true);
    try {
      await api.post(`/gpo/${encodeURIComponent(editGpoId)}/inherit`, {
        block: editBlockInheritance,
      });
      toast.success(t('gpo.inheritanceSet'));
      loadGpos();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('gpo.failedInherit')));
    } finally { setEditLoading(false); }
  }, [editGpoId, editBlockInheritance, loadGpos, t]);

  const filteredGpos = gpos.filter(g =>
    !searchQuery ||
    g.displayname.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.gpo_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Build the attributes object for AttributeViewer, keeping ALL fields
  const buildDetailsData = (gpo: GpoEntry): Record<string, unknown> => {
    // Include ALL fields for the AttributeViewer
    const { ...rest } = gpo;
    return { ...rest } as Record<string, unknown>;
  };

  const visibleColCount = colConfig.filter(c => c.visible).length;

  return (
    <RequirePermission permission="gpo.list">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="gpo.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('gpo.createGPO')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('gpo.createGPO')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('gpo.createGPO')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('gpo.displayName')} *</Label>
                    <Input
                      value={newGpoName}
                      onChange={(e) => setNewGpoName(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="My Group Policy"
                    />
                  </div>
                  <Button onClick={createGpo} disabled={!newGpoName} className="w-full">
                    {t('gpo.createGPO')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <div className="flex-1" />

          <ColumnCustomizer
            entityType="gpo"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={gpoDataKeys}
          />

          <Button variant="outline" size="sm" onClick={loadGpos} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        {/* Full-width search row - single field, works on all breakpoints.
            Use type="text" (not "search") to avoid native browser clear
            button overlapping our custom one. */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('gpo.searchGPOs')}
            className="h-10 md:h-9 text-sm pl-10 pr-10 w-full bg-background"
            autoComplete="off"
            type="text"
            inputMode="search"
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 z-10 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
              onClick={() => setSearchQuery('')}
              title="Очистить"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          )}
        </div>

        {/* Mobile card view - shown when isMobile (checks short screen side,
            so it works in rotate mode too, not just narrow viewport).
            Uses max-height + overflow-y-auto so cards scroll independently
            of the page - works in both portrait and landscape modes. */}
        {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : filteredGpos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
          ) : (
            filteredGpos.map((gpo, i) => {
              const apiName = gpo.gpo_id || gpo.cn || '';
              const displayName = gpo.displayname || gpo.displayName || gpo.cn || gpo.gpo_id || '';
              // Show ALL visible columns from ColumnCustomizer as metadata in the card,
              // except # and actions (handled separately). This includes custom columns
              // the user added (e.g. gPCFileSysPath, versionNumber, etc.).
              const extraCols = visibleColumns.filter(c =>
                c.key !== '#' && c.key !== 'actions' &&
                c.key !== 'displayname' && c.key !== 'displayName' &&
                c.key !== 'cn' && c.key !== 'gpo_id' // already shown as displayName/apiName
              );
              return (
                <Card key={`m-${apiName}-${i}`} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-purple-500/10 flex items-center justify-center">
                      <FileText className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{displayName}</span>
                      {gpo.gpo_id && <div className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">{gpo.gpo_id}</div>}
                      {gpo.versionNumber !== undefined && gpo.versionNumber !== null && gpo.versionNumber !== '' && <div className="text-xs text-muted-foreground mt-0.5">v{String(gpo.versionNumber)}</div>}
                      {/* Extra visible columns from ColumnCustomizer.
                          Custom columns appear here as "key: value" rows. */}
                      {extraCols.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {extraCols.map(col => {
                            const val = gpo[col.key as keyof typeof gpo];
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showGpo(apiName)} title={t('common.show')}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(apiName, displayName)} title={t('common.edit')}><PenLine className="w-4 h-4 text-blue-400" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteGpo(apiName)} title={t('common.delete')}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
        )}

        {/* Desktop table - shown when NOT mobile (desktop / wide tablet). */}
        {!isMobile && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <ScrollArea className="h-[calc(100vh-14rem)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map(col => {
                      if (col.key === '#') {
                        return (
                          <TableHead key={col.key} className="w-12 relative">
                            #
                            <ResizeHandle onResize={(d) => setColumnWidth('#', (getColumnWidth('#') || 48) + d)} />
                          </TableHead>
                        );
                      }
                      if (col.key === 'actions') {
                        return <TableHead key={col.key} className="w-40">{t('common.actions')}</TableHead>;
                      }
                      const label = col.removable ? col.label : (
                        col.key === 'displayName' ? t('gpo.displayName') :
                        col.key === 'cn' ? t('gpo.gpoId') :
                        col.key === 'versionNumber' ? t('gpo.version') :
                        col.key === 'status' ? t('common.status') :
                        col.label
                      );
                      const minWidth = col.key === 'cn' ? '300px' : undefined;
                      return (
                        <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined, minWidth }} className="text-xs font-mono relative">
                          {label}
                          <ResizeHandle onResize={(d) => setColumnWidth(col.key, (getColumnWidth(col.key) || 150) + d)} />
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : filteredGpos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={visibleColCount} className="text-center py-8 text-muted-foreground">
                        {t('common.noData')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredGpos.map((gpo, i) => (
                      <TableRow key={gpo.gpo_id || i} className="group">
                        {visibleColumns.map(col => {
                          if (col.key === '#') {
                            return <TableCell key={col.key} className="text-xs text-muted-foreground">{i + 1}</TableCell>;
                          }
                          if (col.key === 'actions') {
                            return (
                              <TableCell key={col.key}>
                                <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                  <RequirePermission permission="gpo.list">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showGpo(gpo.gpo_id || gpo.cn || '')}>
                                      <Eye className="w-3 h-3" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="gpo.list">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(gpo.gpo_id || gpo.cn || '', gpo.displayname || gpo.displayName || '')} title={t('common.edit')}>
                                      <PenLine className="w-3 h-3 text-blue-400" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="gpo.delete">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteGpo(gpo.gpo_id || gpo.cn || '')}>
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </Button>
                                  </RequirePermission>
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.key === 'displayName') {
                            return (
                              <TableCell key={col.key}>
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                  <span className="font-medium truncate max-w-[250px]" title={gpo.displayName || gpo.displayname}>
                                    {gpo.displayName || gpo.displayname || '—'}
                                  </span>
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.key === 'cn') {
                            return (
                              <TableCell key={col.key}>
                                <Badge variant="outline" className="font-mono text-xs whitespace-nowrap" title={gpo.gpo_id || gpo.cn}>
                                  {gpo.gpo_id || gpo.cn || '—'}
                                </Badge>
                              </TableCell>
                            );
                          }
                          if (col.key === 'versionNumber') {
                            return (
                              <TableCell key={col.key}>
                                <span className="text-xs font-mono">{gpo.versionNumber !== undefined && gpo.versionNumber !== null ? String(gpo.versionNumber) : '—'}</span>
                              </TableCell>
                            );
                          }
                          if (col.key === 'status') {
                            return (
                              <TableCell key={col.key}>
                                {gpo.status ? (
                                  <Badge variant={gpo.status === 'ok' ? 'default' : 'destructive'} className="text-[10px]">
                                    {gpo.status}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          }
                          // Generic extra column
                          return (
                            <TableCell key={col.key} className="text-xs font-mono max-w-[200px] truncate">
                              {gpo[col.key] !== undefined && gpo[col.key] !== null ? String(gpo[col.key]) : '—'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </Card>
        )}

        {/* GPO Details Dialog - uses AttributeViewer */}
        <Dialog open={detailsDialogOpen} onOpenChange={(open) => { setDetailsDialogOpen(open); if (!open) { setSelectedGpo(null); setGpoDetails(null); } }}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                {gpoDetails?.displayName || gpoDetails?.displayname || selectedGpo || ''}
              </DialogTitle>
              <DialogDescription className="sr-only">{gpoDetails?.displayName || gpoDetails?.displayname || selectedGpo || ''}</DialogDescription>
            </DialogHeader>
            {detailsLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : gpoDetails ? (
              <ScrollArea className="max-h-[65vh]">
                <AttributeViewer
                  entityType="gpo"
                  data={buildDetailsData(gpoDetails)}
                  keyInfoKeys={['displayName', 'displayname', 'cn', 'gPCFileSysPath', 'versionNumber', 'flags', 'dn', 'distinguishedName', 'gPCFunctionalityVersion', 'status']}
                  showCustomize={true}
                />
              </ScrollArea>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit GPO Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-blue-400" />
                {t('gpo.editGPO')}: {editGpoName || editGpoId}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('gpo.editGPO')}: {editGpoName || editGpoId}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <Tabs defaultValue="link" className="w-full">
                {/* Vertical list of options — one per row, icon + label.
                    Same pattern as UsersPage edit dialog. */}
                <TabsList className="flex flex-col w-full h-auto gap-0.5 p-0 bg-transparent">
                  <TabsTrigger value="link" className="w-full justify-start text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap">
                    <Link2 className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{t('gpo.linkGpo')}</span>
                  </TabsTrigger>
                  <TabsTrigger value="unlink" className="w-full justify-start text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap">
                    <Unlink className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{t('gpo.unlinkGpo')}</span>
                  </TabsTrigger>
                  <TabsTrigger value="backup" className="w-full justify-start text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap">
                    <Download className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{t('gpo.backupGpo')}</span>
                  </TabsTrigger>
                  <TabsTrigger value="inherit" className="w-full justify-start text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap">
                    <ShieldCheck className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2 flex-shrink-0" />
                    <span className="truncate">{t('gpo.inheritance')}</span>
                  </TabsTrigger>
                </TabsList>

                {/* Link Tab */}
                <TabsContent value="link" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('gpo.containerDn')} *</Label>
                    <Input
                      value={editContainerDn}
                      onChange={(e) => setEditContainerDn(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                      placeholder="OU=Computers,DC=example,DC=com"
                    />
                  </div>
                  <Button
                    onClick={handleLinkGpo}
                    disabled={!editContainerDn || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}
                    {t('gpo.linkGpo')}
                  </Button>
                </TabsContent>

                {/* Unlink Tab */}
                <TabsContent value="unlink" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('gpo.containerDn')} *</Label>
                    <Input
                      value={editContainerDn}
                      onChange={(e) => setEditContainerDn(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                      placeholder="OU=Computers,DC=example,DC=com"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    onClick={handleUnlinkGpo}
                    disabled={!editContainerDn || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Unlink className="w-4 h-4 mr-1" />}
                    {t('gpo.unlinkGpo')}
                  </Button>
                </TabsContent>

                {/* Backup Tab */}
                <TabsContent value="backup" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('gpo.targetDir')} *</Label>
                    <Input
                      value={editTargetDir}
                      onChange={(e) => setEditTargetDir(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                      placeholder="/var/backups/gpo"
                    />
                  </div>
                  <Button
                    onClick={handleBackupGpo}
                    disabled={!editTargetDir || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Archive className="w-4 h-4 mr-1" />}
                    {t('gpo.backupGpo')}
                  </Button>
                </TabsContent>

                {/* Inheritance Tab */}
                <TabsContent value="inherit" className="space-y-3 mt-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={editBlockInheritance} onCheckedChange={setEditBlockInheritance} />
                    <Label className="text-xs">{t('gpo.blockInheritance')}</Label>
                  </div>
                  <Button
                    onClick={handleSetInheritance}
                    disabled={editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                    {t('gpo.setInheritance')}
                  </Button>
                </TabsContent>
              </Tabs>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
