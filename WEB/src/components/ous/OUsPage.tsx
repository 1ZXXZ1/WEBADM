'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import {
  FolderTree, Trash2, Eye, Search, RefreshCw, Plus, Loader2,
  ChevronRight, ChevronDown, FolderInput, PenLine, Users, Monitor, Shield,
  Phone, Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

interface OUTreeNode {
  name: string;
  dn?: string;
  description?: string;
  children?: OUTreeNode[];
  childCount?: number;
}

export default function OUsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [ous, setOus] = useState<Record<string, string>[]>([]);
  const [ouTree, setOuTree] = useState<OUTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOU, setSelectedOU] = useState<string | null>(null);
  const [ouDetails, setOuDetails] = useState<Record<string, unknown> | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [renameOUName, setRenameOUName] = useState<string>('');
  const [moveOUName, setMoveOUName] = useState<string>('');
  const [ouStats, setOuStats] = useState<Record<string, unknown> | null>(null);
  const [ouObjects, setOuObjects] = useState<Record<string, string>[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [newOU, setNewOU] = useState({ ouname: '', description: '' });

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'ouname', label: t('ous.ouName'), visible: true },
    { key: 'description', label: t('common.description'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('ous', defaultColumns);

  const ouDataKeys = useMemo(() => {
    return extractAllKeys(ous as unknown as Record<string, unknown>[]);
  }, [ous]);

  const loadOUs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/ous/');
      const data = response.data;
      let ouList: Record<string, string>[] = [];

      if (Array.isArray(data)) {
        ouList = data;
      } else if (data?.data && Array.isArray(data.data)) {
        ouList = data.data;
      } else if (data?.ous && Array.isArray(data.ous)) {
        ouList = data.ous;
      } else if (data?.items && Array.isArray(data.items)) {
        ouList = data.items;
      } else if (data?.output) {
        const lines = String(data.output).split('\n').filter((l: string) => l.trim());
        ouList = lines.map((line: string) => ({ ouname: line.trim() }));
      } else if (data?.data?.output) {
        const lines = String(data.data.output).split('\n').filter((l: string) => l.trim());
        ouList = lines.map((line: string) => ({ ouname: line.trim() }));
      } else if (data?.result) {
        if (Array.isArray(data.result)) {
          ouList = data.result;
        } else if (data.result?.output) {
          const lines = String(data.result.output).split('\n').filter((l: string) => l.trim());
          ouList = lines.map((line: string) => ({ ouname: line.trim() }));
        } else if (data.result?.items && Array.isArray(data.result.items)) {
          ouList = data.result.items;
        }
      }

      setOus(ouList);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('ous.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOUTree = useCallback(async () => {
    try {
      const response = await api.get('/ous/tree');
      const data = response.data;
      let treeData: OUTreeNode[] = [];

      if (Array.isArray(data)) {
        treeData = data;
      } else if (data?.data && Array.isArray(data.data)) {
        treeData = data.data;
      } else if (data?.tree && Array.isArray(data.tree)) {
        treeData = data.tree;
      } else if (data?.output) {
        // Parse text output into simple flat tree
        const lines = String(data.output).split('\n').filter((l: string) => l.trim());
        treeData = lines.map((line: string) => ({ name: line.trim() }));
      } else if (data?.data?.output) {
        const lines = String(data.data.output).split('\n').filter((l: string) => l.trim());
        treeData = lines.map((line: string) => ({ name: line.trim() }));
      }

      setOuTree(treeData);
    } catch {
      // Silently fail - tree is supplementary
    }
  }, []);

  useEffect(() => {
    loadOUs();
    loadOUTree();
  }, [loadOUs, loadOUTree]);

  const showOU = useCallback(async (ouName: string) => {
    setSelectedOU(ouName);
    setOuDetails(null);
    setOuStats(null);
    setOuObjects([]);
    setDetailDialogOpen(true);
    try {
      // The API expects the FULL DN (e.g. "OU=almaz,DC=almaz,DC=local"),
      // not just the OU name. If ouName doesn't look like a DN, convert it.
      const dn = ouName.includes('=') ? ouName : `OU=${ouName}`;
      const encodedDn = encodeURIComponent(dn);
      // Extract the OU name from the DN for /search endpoint
      const ouShortName = dn.replace(/^OU=/i, '').split(',')[0];

      // The /ous/{dn} endpoint returns HTML (SPA fallback) — NOT JSON.
      // Use /search?search={name} to get OU details, and /tree for children.
      // /stats and /tree endpoints DO work with DN.
      const [searchRes, treeRes] = await Promise.allSettled([
        api.get(`/ous/search?search=${encodeURIComponent(ouShortName)}&offset=0&limit=100`),
        api.get(`/ous/${encodedDn}/tree`),
      ]);

      // Stats — uses DN, works
      api.get(`/ous/${encodedDn}/stats`).then((statsRes) => {
        const sd = statsRes.data;
        setOuStats(sd.data || sd.result || sd);
      }).catch(() => { /* stats may fail */ });

      // Build details from search result (find the matching OU by DN)
      if (searchRes.status === 'fulfilled') {
        const data = searchRes.value.data;
        const items = data?.items || data?.data || [];
        if (Array.isArray(items)) {
          // Find the OU matching our DN
          const matched = items.find((item: Record<string, unknown>) =>
            item.dn === dn || item.distinguishedName === dn
          ) || items[0];
          if (matched) {
            const filtered = Object.fromEntries(
              Object.entries(matched).filter(([k]) => k !== 'status' && k !== 'message')
            );
            setOuDetails(filtered);
          }
        }
      }

      // Build child objects from tree endpoint
      if (treeRes.status === 'fulfilled') {
        const data = treeRes.value.data;
        const tree = data?.tree || data?.data?.tree;
        if (tree && tree.children && Array.isArray(tree.children)) {
          setOuObjects(tree.children.map((child: Record<string, unknown>) => ({
            name: String(child.name || ''),
            dn: String(child.dn || ''),
            type: 'OU',
            childCount: Number(child.object_count || 0),
          })));
        }
      }

    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, 'Failed to load OU details'));
    }
  }, []);

  const createOU = useCallback(async () => {
    try {
      const body: Record<string, string> = { ouname: newOU.ouname };
      if (newOU.description) body.description = newOU.description;
      await api.post('/ous/', body);
      toast.success(t('ous.ouCreated'));
      setCreateDialogOpen(false);
      setNewOU({ ouname: '', description: '' });
      loadOUs();
      loadOUTree();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('ous.failedCreate')));
    }
  }, [newOU, loadOUs, loadOUTree]);

  const deleteOU = useCallback(async (ouName: string) => {
    if (!confirm(t('ous.confirmDelete', { name: ouName }))) return;
    try {
      await api.delete(`/ous/${encodeURIComponent(ouName)}`);
      toast.success(t('ous.ouDeleted'));
      loadOUs();
      loadOUTree();
      if (selectedOU === ouName) { setSelectedOU(null); setDetailDialogOpen(false); }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('ous.failedDelete')));
    }
  }, [loadOUs, loadOUTree, selectedOU]);

  const moveOU = useCallback(async () => {
    if (!moveOUName || !moveTarget) return;
    try {
      await api.post(`/ous/${encodeURIComponent(moveOUName)}/move`, { new_parent_dn: moveTarget });
      toast.success(`OU moved to ${moveTarget}`);
      setMoveDialogOpen(false);
      setMoveTarget('');
      setMoveOUName('');
      loadOUs();
      loadOUTree();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('ous.failedMove')));
    }
  }, [selectedOU, moveTarget, loadOUs, loadOUTree]);

  const renameOU = useCallback(async () => {
    if (!renameOUName || !renameValue) return;
    try {
      await api.post(`/ous/${encodeURIComponent(renameOUName)}/rename`, { new_name: renameValue });
      toast.success(`OU renamed to ${renameValue}`);
      setRenameDialogOpen(false);
      setRenameValue('');
      setRenameOUName('');
      loadOUs();
      loadOUTree();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('ous.failedRename')));
    }
  }, [selectedOU, renameValue, loadOUs, loadOUTree]);

  const toggleNode = useCallback((name: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const filteredOUs = ous.filter(ou =>
    !searchQuery || Object.values(ou).some(v => String(v).toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const renderTreeNode = (node: OUTreeNode, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.name);
    const isSelected = selectedOU === node.name;

    return (
      <div key={node.name}>
        <button
          onClick={() => {
            toggleNode(node.name);
            showOU(node.dn || node.name);
          }}
          className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2 rounded-md text-sm transition-colors ${
            isSelected ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-accent'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />
          ) : (
            <span className="w-3" />
          )}
          <FolderTree className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
          {node.childCount !== undefined && (
            <Badge variant="outline" className="text-[10px] ml-auto px-1">{node.childCount}</Badge>
          )}
        </button>
        {hasChildren && isExpanded && node.children!.map(child => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  // Get object type icon
  const getObjectIcon = (obj: Record<string, string>) => {
    const type = String(obj.type || obj.objectClass || '').toLowerCase();
    const dn = String(obj.dn || obj.name || '').toLowerCase();
    if (type.includes('user') || dn.includes('cn=users') || dn.includes(',cn=users,')) return <Users className="w-3 h-3 text-blue-400" />;
    if (type.includes('computer') || dn.includes('cn=computers')) return <Monitor className="w-3 h-3 text-orange-400" />;
    if (type.includes('group') || dn.includes('cn=groups')) return <Shield className="w-3 h-3 text-purple-400" />;
    if (type.includes('contact')) return <FolderTree className="w-3 h-3 text-violet-400" />;
    return <FolderTree className="w-3 h-3 text-amber-400" />;
  };

  return (
    <RequirePermission permission="ou.list">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="ou.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('ous.createOU')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('ous.createOU')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('ous.ouName')} *</Label>
                    <Input value={newOU.ouname} onChange={(e) => setNewOU(p => ({ ...p, ouname: e.target.value }))} className="h-8 text-sm" placeholder="Organizational Unit" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('common.description')}</Label>
                    <Input value={newOU.description} onChange={(e) => setNewOU(p => ({ ...p, description: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <Button onClick={createOU} disabled={!newOU.ouname} className="w-full">
                    {t('ous.createOU')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <ColumnCustomizer
            entityType="ous"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={ouDataKeys}
          />

          <Button variant="outline" size="sm" onClick={() => { loadOUs(); loadOUTree(); }} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        {/* Full-width search row */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('ous.searchOUs')} className="h-10 md:h-9 text-sm pl-10 pr-10 w-full bg-background" autoComplete="off" type="text" inputMode="search" />
          {searchQuery && (
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 z-10 flex items-center justify-center text-muted-foreground hover:text-foreground rounded" onClick={() => setSearchQuery('')} title="Очистить">
              <span className="text-lg leading-none">×</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* OU Tree View */}
          {ouTree.length > 0 && (
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-amber-400" />
                  {t('ous.treeView')}
                </CardTitle>
              </CardHeader>
              <ScrollArea className="max-h-[calc(100vh-16rem)]">
                <CardContent className="pt-0">
                  <div className="space-y-0.5">
                    {ouTree.map(node => renderTreeNode(node))}
                  </div>
                </CardContent>
              </ScrollArea>
            </Card>
          )}

          {/* OUs List */}
          <Card className={ouTree.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FolderTree className="w-4 h-4" />
                  {t('ous.organizationalUnits')}
                </CardTitle>
                <Badge variant="outline" className="text-xs">{filteredOUs.length}</Badge>
              </div>
            </CardHeader>
            <ScrollArea className="max-h-[calc(100vh-16rem)]">
              <CardContent className="pt-0">
                {isMobile && (
                  <div className="space-y-2 p-2 max-h-[60vh] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {loading ? (
                      <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
                    ) : filteredOUs.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">{t('common.noData')}</div>
                    ) : (
                      filteredOUs.map((ou, i) => {
                        const apiName = ou.dn || ou.ouname || ou.name || ou.cn || String(Object.values(ou)[0] || '');
                        const displayName = ou.ouname || ou.name || ou.cn || String(Object.values(ou)[0] || '');
                        const description = ou.description || '';
                        // Show ALL visible columns from ColumnCustomizer as metadata in the card,
                        // except # and actions (handled separately). This includes custom columns
                        // the user added (e.g. distinguishedName, whenCreated, etc.).
                        const extraCols = visibleColumns.filter(c =>
                          c.key !== '#' && c.key !== 'actions' &&
                          c.key !== 'ouname' && c.key !== 'name' &&
                          c.key !== 'cn' // already shown as displayName
                        );
                        return (
                          <Card key={`m-${apiName}-${i}`} className="p-3">
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center">
                                <FolderTree className="w-4 h-4 text-amber-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-sm truncate block">{displayName}</span>
                                {description && <div className="text-xs text-muted-foreground truncate mt-0.5">{Array.isArray(description) ? description[0] : description}</div>}
                                {ou.childCount !== undefined && <div className="text-xs text-muted-foreground mt-0.5">{ou.childCount} children</div>}
                                {/* Extra visible columns from ColumnCustomizer.
                                    Custom columns appear here as "key: value" rows. */}
                                {extraCols.length > 0 && (
                                  <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                                    {extraCols.map(col => {
                                      const val = ou[col.key as keyof typeof ou];
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
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showOU(apiName)} title={t('common.show')}><Eye className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setMoveOUName(apiName); setMoveTarget(''); setMoveDialogOpen(true); }} title={t('common.move')}><FolderInput className="w-4 h-4 text-blue-400" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setRenameOUName(apiName); setRenameValue(apiName); setRenameDialogOpen(true); }} title={t('common.rename')}><PenLine className="w-4 h-4 text-blue-400" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteOU(apiName)} title={t('common.delete')}><Trash2 className="w-4 h-4 text-red-400" /></Button>
                            </div>
                          </Card>
                        );
                      })
                    )}
                  </div>
                )}
                {!isMobile && (
                  loading ? (
                    <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
                  ) : (
                    <div className="overflow-x-auto">
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
                              return <TableHead key={col.key} className="w-44">{t('common.actions')}</TableHead>;
                            }
                            const label = col.removable ? col.label : (
                              col.key === 'ouname' ? t('ous.ouName') :
                              col.key === 'description' ? t('common.description') :
                              col.label
                            );
                            return (
                              <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined }} className="text-xs relative">
                                {label}
                                <ResizeHandle onResize={(d) => setColumnWidth(col.key, (getColumnWidth(col.key) || 150) + d)} />
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOUs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={colConfig.filter(c => c.visible).length} className="text-center py-8 text-muted-foreground">
                              {t('common.noData')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredOUs.map((ou, i) => {
                            const name = ou.ouname || ou.name || ou.cn || String(Object.values(ou)[0] || '');
                            const dn = ou.dn || name; // Use DN for API calls, fall back to name
                            const description = ou.description || '';
                            return (
                              <TableRow key={i} className="group">
                                {visibleColumns.map(col => {
                                  if (col.key === '#') {
                                    return <TableCell key={col.key} className="text-xs text-muted-foreground">{i + 1}</TableCell>;
                                  }
                                  if (col.key === 'actions') {
                                    return (
                                      <TableCell key={col.key}>
                                        <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                          <RequirePermission permission="ou.list">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showOU(dn)}>
                                              <Eye className="w-3 h-3" />
                                            </Button>
                                          </RequirePermission>
                                          <RequirePermission permission="ou.list">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setRenameOUName(name); setRenameValue(name); setRenameDialogOpen(true); }}>
                                              <PenLine className="w-3 h-3" />
                                            </Button>
                                          </RequirePermission>
                                          <RequirePermission permission="ou.list">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setMoveOUName(name); setMoveTarget(''); setMoveDialogOpen(true); }}>
                                              <FolderInput className="w-3 h-3" />
                                            </Button>
                                          </RequirePermission>
                                          <RequirePermission permission="ou.delete">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteOU(name)}>
                                              <Trash2 className="w-3 h-3 text-red-400" />
                                            </Button>
                                          </RequirePermission>
                                        </div>
                                      </TableCell>
                                    );
                                  }
                                  if (col.key === 'ouname') {
                                    return (
                                      <TableCell key={col.key}>
                                        <div className="flex items-center gap-2">
                                          <FolderTree className="w-4 h-4 text-amber-400" />
                                          <span className="font-medium">{name}</span>
                                        </div>
                                      </TableCell>
                                    );
                                  }
                                  if (col.key === 'description') {
                                    return <TableCell key={col.key} className="text-sm text-muted-foreground max-w-[250px] truncate">{description}</TableCell>;
                                  }
                                  // Generic extra column
                                  const value = ou[col.key];
                                  return (
                                    <TableCell key={col.key} className="text-xs">
                                      <span className="truncate max-w-[150px] block">
                                        {value !== undefined ? String(value) : ''}
                                      </span>
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })
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

        {/* OU Details Dialog */}
        <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setSelectedOU(null); }}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-amber-400" />
                {selectedOU}
              </DialogTitle>
              <DialogDescription className="sr-only">{selectedOU}</DialogDescription>
            </DialogHeader>
              <ScrollArea className="max-h-[65vh]">
                <div className="space-y-4">
                  {/* Statistics summary — show clean stats from /stats endpoint
                      as a nice grid of cards, NOT dumped into AttributeViewer.
                      API returns: user_count, group_count, computer_count,
                      contact_count, ou_count, total_objects */}
                  {ouStats && (() => {
                    const stats = ouStats as Record<string, unknown>;
                    const userCount = Number(stats.user_count ?? 0);
                    const groupCount = Number(stats.group_count ?? 0);
                    const computerCount = Number(stats.computer_count ?? 0);
                    const contactCount = Number(stats.contact_count ?? 0);
                    const ouCount = Number(stats.ou_count ?? 0);
                    const totalCount = Number(stats.total_objects ?? 0);
                    const statCards = [
                      { label: t('nav.users', 'Пользователи'), value: userCount, icon: Users, color: 'text-blue-400 bg-blue-500/10' },
                      { label: t('nav.groups', 'Группы'), value: groupCount, icon: Shield, color: 'text-emerald-400 bg-emerald-500/10' },
                      { label: t('nav.computers', 'Компьютеры'), value: computerCount, icon: Monitor, color: 'text-cyan-400 bg-cyan-500/10' },
                      { label: t('nav.contacts', 'Контакты'), value: contactCount, icon: Phone, color: 'text-orange-400 bg-orange-500/10' },
                      { label: t('nav.ou', 'Подразделения'), value: ouCount, icon: FolderTree, color: 'text-amber-400 bg-amber-500/10' },
                      { label: t('common.total', 'Всего'), value: totalCount, icon: Database, color: 'text-purple-400 bg-purple-500/10' },
                    ];
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {statCards.map((s) => {
                          const Icon = s.icon;
                          return (
                            <div key={s.label} className="flex items-center gap-2 p-2 rounded-lg border border-border/50">
                              <div className={`p-1.5 rounded-md ${s.color} flex-shrink-0`}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-lg font-bold leading-none">{s.value}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{s.label}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* OU attributes — only meaningful fields, NOT raw stats */}
                  {ouDetails && (
                    <AttributeViewer
                      entityType="ous"
                      data={ouDetails}
                      keyInfoKeys={['dn', 'ou', 'name', 'cn', 'description', 'distinguishedName', 'whenCreated', 'whenChanged']}
                      showCustomize={true}
                    />
                  )}

                  {/* Child Objects still shown separately */}
                  {ouObjects.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        {t('ous.childObjects')} ({ouObjects.length})
                      </h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {ouObjects.map((obj, idx) => {
                          const objName = obj.name || obj.cn || obj.dn || String(Object.values(obj)[0] || '');
                          return (
                            <div key={idx} className="flex items-center gap-2 text-sm py-1 border-b border-border/30">
                              {getObjectIcon(obj)}
                              <span className="truncate">{objName}</span>
                              {obj.type && <Badge variant="outline" className="text-[10px] ml-auto px-1">{obj.type}</Badge>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!ouDetails && !ouStats && ouObjects.length === 0 && (
                    <div className="py-8 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>

        {/* Move OU Dialog */}
        <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('ous.moveOU')}: {moveOUName}</DialogTitle>
              <DialogDescription className="sr-only">{t('ous.moveOU')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('ous.newParentDN')} *</Label>
                <Input value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="h-8 text-sm" placeholder="OU=Parent,DC=example,DC=com" />
              </div>
              <Button onClick={moveOU} disabled={!moveTarget} className="w-full">{t('ous.moveOU')}</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rename OU Dialog */}
        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('ous.renameOU')}: {renameOUName}</DialogTitle>
              <DialogDescription className="sr-only">{t('ous.renameOU')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('ous.newName')} *</Label>
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 text-sm" />
              </div>
              <Button onClick={renameOU} disabled={!renameValue} className="w-full">{t('ous.renameOU')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
