'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import { FolderPlus, Trash2, UserPlus, UserMinus, Users, Search, RefreshCw, Loader2, Eye, Shield, PenLine, FolderInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';
import { tryDecodeLdapValue, decodeLdapObject, safeToastMessage } from '@/lib/parsers';

interface GroupLdapObject {
  dn?: string;
  cn?: string;
  sAMAccountName?: string;
  description?: string | string[];
  member?: string | string[];
  memberOf?: string | string[];
  objectClass?: string | string[];
  groupType?: string | number;
  [key: string]: unknown;
}

/**
 * Decode a member entry that could be a string, base64 string, or an object.
 * Handles LDAP member objects like {dn: "Q049...", cn: "Q049..."} or plain strings.
 */
function decodeMemberEntry(m: unknown): string {
  if (typeof m === 'string') {
    // Try to decode base64-encoded LDAP values (e.g. Q0490KHQtdGA0LPQtdC5... → CN=Александр...)
    const decoded = tryDecodeLdapValue(m);
    return decoded;
  }
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const obj = m as Record<string, unknown>;
    // Try to find a readable name from the object
    const cn = typeof obj.cn === 'string' ? tryDecodeLdapValue(obj.cn) : '';
    const name = typeof obj.name === 'string' ? tryDecodeLdapValue(obj.name) : '';
    const username = typeof obj.username === 'string' ? tryDecodeLdapValue(obj.username) : '';
    const displayName = typeof obj.displayName === 'string' ? tryDecodeLdapValue(obj.displayName) : '';
    const dn = typeof obj.dn === 'string' ? tryDecodeLdapValue(obj.dn) : '';
    const sAMAccountName = typeof obj.sAMAccountName === 'string' ? tryDecodeLdapValue(obj.sAMAccountName) : '';
    // Prefer the most readable name
    return sAMAccountName || cn || displayName || name || username || dn || String(Object.values(obj)[0] || '');
  }
  return String(m);
}

/**
 * Extract a short display name from a DN or member string.
 * "CN=almaz,OU=Users,DC=almaz,DC=local" → "almaz"
 * "CN=S-1-5-11,CN=ForeignSecurityPrincipals,DC=almaz,DC=local" → "S-1-5-11"
 * "almaz" → "almaz" (non-DN strings pass through)
 *
 * Note: SIDs are shown as-is (not resolved to well-known names) because
 * the user wants to see the actual identifier, not a generic label.
 */
function shortMemberName(member: string): string {
  if (!member) return '';
  // Check if it looks like a DN (starts with CN=, OU=, DC=)
  if (/^(CN|OU|DC)=/i.test(member)) {
    const firstPart = member.split(',')[0];
    return firstPart.replace(/^(CN|OU|DC)=/i, '');
  }
  return member;
}

/**
 * Parse member list from various API response formats.
 * Handles: string array, object array, text output, {members: [...]}, etc.
 */
function parseMemberList(data: unknown): string[] {
  if (!data) return [];
  // Text output
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const outputText = d.output || (d.data && typeof d.data === 'object' ? (d.data as Record<string, unknown>).output : undefined);
    if (typeof outputText === 'string') {
      return outputText.split('\n').filter(Boolean).map((l: string) => tryDecodeLdapValue(l.trim()));
    }
  }
  // Array of members
  if (Array.isArray(data)) {
    return data.map(m => decodeMemberEntry(m));
  }
  // {members: [...]}
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.members)) {
      return d.members.map(m => decodeMemberEntry(m));
    }
    if (Array.isArray(d.data)) {
      return d.data.map((m: unknown) => decodeMemberEntry(m));
    }
  }
  return [];
}

export default function GroupsPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [groups, setGroups] = useState<GroupLdapObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupLdapObject | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newGroup, setNewGroup] = useState({
    groupname: '', description: '', group_scope: 'Global', group_type: 'Security',
  });
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [addMembersInput, setAddMembersInput] = useState('');

  // Edit group dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editAddMembersInput, setEditAddMembersInput] = useState('');
  const [editCurrentMembers, setEditCurrentMembers] = useState<string[]>([]);
  const [editNewParentDn, setEditNewParentDn] = useState('');

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'sAMAccountName', label: t('groups.groupname'), visible: true },
    { key: 'description', label: t('common.description'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('groups', defaultColumns);

  const groupDataKeys = useMemo(() => {
    return extractAllKeys(groups as unknown as Record<string, unknown>[]);
  }, [groups]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      // Try /groups/full first (returns full LDAP objects)
      let response;
      try {
        response = await api.get('/groups/full');
      } catch {
        // Fallback to old endpoint
        response = await api.get('/groups/');
      }
      const data = response.data;

      // Handle {status: "ok", groups: [...]} format
      if (data?.groups && Array.isArray(data.groups)) {
        setGroups(data.groups);
      } else if (Array.isArray(data)) {
        setGroups(data);
      } else if (data?.data && Array.isArray(data.data)) {
        setGroups(data.data);
      } else if (data?.result && Array.isArray(data.result)) {
        setGroups(data.result);
      } else if (data?.output || data?.data?.output) {
        // Old text format — fallback to name-only list
        const outputText = data?.output || data?.data?.output;
        const lines = String(outputText).split('\n').filter((l: string) => l.trim());
        setGroups(lines.map((line: string) => ({ sAMAccountName: line.trim(), cn: line.trim() })));
      } else {
        setGroups([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedLoad')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const showMembers = useCallback(async (groupname: string) => {
    setSelectedGroup(groupname);
    setMembersDialogOpen(true);
    setMembers([]);
    try {
      const response = await api.get(`/groups/${encodeURIComponent(groupname)}/members`);
      const data = response.data;
      setMembers(parseMemberList(data));
    } catch {
      toast.error(safeToastMessage(undefined, t('groups.failedMembers')));
    }
  }, [t]);

  const showGroupDetails = useCallback((groupname: string) => {
    setSelectedGroup(groupname);
    setDetailsDialogOpen(true);
    // Find the group from already-loaded data by sAMAccountName or cn
    const found = groups.find(g =>
      g.sAMAccountName === groupname || g.cn === groupname
    );
    if (found) {
      setGroupDetail(decodeLdapObject(found as Record<string, unknown>) as GroupLdapObject);
    } else {
      setGroupDetail(null);
    }
  }, [groups]);

  const createGroup = useCallback(async () => {
    try {
      await api.post('/groups/', newGroup);
      toast.success(`${t('groups.groupCreated')}: ${newGroup.groupname}`);
      setCreateDialogOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedCreate')));
    }
  }, [newGroup, t]);

  const addMembers = useCallback(async () => {
    if (!selectedGroup || !addMembersInput) return;
    try {
      const memberList = addMembersInput.split(',').map(m => m.trim()).filter(Boolean);
      await api.post(`/groups/${encodeURIComponent(selectedGroup)}/members`, {
        members: memberList,
      });
      toast.success(`${t('groups.membersAdded')}: ${selectedGroup}`);
      setAddMembersInput('');
      showMembers(selectedGroup);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedAddMembers')));
    }
  }, [selectedGroup, addMembersInput, showMembers, t]);

  // Open edit dialog for a group
  const openEditDialog = useCallback(async (groupname: string) => {
    setEditGroupName(groupname);
    setEditAddMembersInput('');
    setEditNewParentDn('');
    setEditCurrentMembers([]);
    setEditDialogOpen(true);

    // Load current members
    try {
      const response = await api.get(`/groups/${encodeURIComponent(groupname)}/members`);
      const data = response.data;
      setEditCurrentMembers(parseMemberList(data));
    } catch {
      // Silently fail — members will be empty
    }
  }, []);

  // Edit group: add members
  const handleEditAddMembers = useCallback(async () => {
    if (!editGroupName || !editAddMembersInput) return;
    setEditLoading(true);
    try {
      const memberList = editAddMembersInput.split(',').map(m => m.trim()).filter(Boolean);
      await api.post(`/groups/${encodeURIComponent(editGroupName)}/members`, {
        members: memberList,
      });
      toast.success(t('groups.membersAdded'));
      setEditAddMembersInput('');
      // Refresh member list
      try {
        const response = await api.get(`/groups/${encodeURIComponent(editGroupName)}/members`);
        const data = response.data;
        setEditCurrentMembers(parseMemberList(data));
      } catch { /* ignore */ }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedAddMembers')));
    } finally { setEditLoading(false); }
  }, [editGroupName, editAddMembersInput, t]);

  // Edit group: remove a member
  const handleEditRemoveMember = useCallback(async (member: string) => {
    if (!editGroupName) return;
    setEditLoading(true);
    try {
      await api.delete(`/groups/${encodeURIComponent(editGroupName)}/members`, {
        data: { members: [member] },
      });
      toast.success(t('groups.memberRemoved'));
      setEditCurrentMembers(prev => prev.filter(m => m !== member));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedRemoveMember')));
    } finally { setEditLoading(false); }
  }, [editGroupName, t]);

  // Edit group: move
  const handleEditMove = useCallback(async () => {
    if (!editGroupName || !editNewParentDn) return;
    setEditLoading(true);
    try {
      await api.post(`/groups/${encodeURIComponent(editGroupName)}/move`, {
        new_parent_dn: editNewParentDn,
      });
      toast.success(t('groups.groupMoved'));
      setEditNewParentDn('');
      setEditDialogOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('groups.failedMove')));
    } finally { setEditLoading(false); }
  }, [editGroupName, editNewParentDn, loadGroups, t]);

  const filteredGroups = groups.filter(g => {
    if (!searchQuery) return true;
    const name = g.sAMAccountName || g.cn || '';
    const desc = Array.isArray(g.description) ? g.description.join(' ') : (g.description || '');
    return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           desc.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Get display name for a group
  const getGroupName = (g: GroupLdapObject): string => {
    return g.sAMAccountName || g.cn || '';
  };

  // Get description for a group
  const getGroupDesc = (g: GroupLdapObject): string => {
    if (Array.isArray(g.description)) return g.description.join(', ');
    return g.description || '';
  };

  const visibleColCount = colConfig.filter(c => c.visible).length;

  return (
    <RequirePermission permission="group.list">
      <div className="space-y-4">
        {/* Toolbar - compact on mobile, full on desktop */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="group.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <FolderPlus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('groups.createGroup')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('groups.createGroup')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('groups.createGroup')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('groups.groupname')} *</Label>
                    <Input value={newGroup.groupname} onChange={(e) => setNewGroup(p => ({ ...p, groupname: e.target.value }))} className="h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('common.description')}</Label>
                    <Input value={newGroup.description} onChange={(e) => setNewGroup(p => ({ ...p, description: e.target.value }))} className="h-8" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('groups.groupScope')}</Label>
                      <Select value={newGroup.group_scope} onValueChange={(v) => setNewGroup(p => ({ ...p, group_scope: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DomainLocal">Domain Local</SelectItem>
                          <SelectItem value="Global">Global</SelectItem>
                          <SelectItem value="Universal">Universal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('groups.groupType')}</Label>
                      <Select value={newGroup.group_type} onValueChange={(v) => setNewGroup(p => ({ ...p, group_type: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Security">Security</SelectItem>
                          <SelectItem value="Distribution">Distribution</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={createGroup} disabled={!newGroup.groupname} className="w-full">{t('groups.createGroup')}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <div className="flex-1" />

          <ColumnCustomizer
            entityType="groups"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={groupDataKeys}
          />

          <Button variant="outline" size="sm" onClick={loadGroups} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
            <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>

        {/* Full-width search row — single field, works on all breakpoints.
            Use type="text" (not "search") to avoid native browser clear
            button overlapping our custom one. */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('groups.searchGroups')}
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

        {/* Mobile card view — shown when isMobile (checks short screen side,
            so it works in ⟳ rotate mode too, not just narrow viewport).
            Uses max-height + overflow-y-auto so cards scroll independently
            of the page — works in both portrait and ⟳ landscape modes. */}
        {isMobile && (
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t('common.noData')}
            </div>
          ) : (
            filteredGroups.map((group, i) => {
              const apiName = group.sAMAccountName || group.cn || '';
              const displayName = group.cn || group.sAMAccountName || '';
              const desc = getGroupDesc(group);
              const memberCount = Array.isArray(group.member) ? group.member.length : (group.member ? 1 : 0);
              // Show ALL visible columns from ColumnCustomizer as metadata in the card,
              // except # and actions (handled separately). This includes custom columns
              // the user added (e.g. member, whenCreated, etc.).
              const extraCols = visibleColumns.filter(c =>
                c.key !== '#' && c.key !== 'actions' &&
                c.key !== 'cn' && c.key !== 'sAMAccountName' // already shown as displayName
              );
              return (
                <Card key={`m-${apiName}-${i}`} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{displayName}</span>
                      {desc && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {desc}
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                        <Users className="w-3 h-3" />
                        <span>{memberCount} {t('groups.members')}</span>
                      </div>
                      {/* Extra visible columns from ColumnCustomizer.
                          Custom columns appear here as "key: value" rows. */}
                      {extraCols.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {extraCols.map(col => {
                            const val = group[col.key as keyof typeof group];
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
                  {/* Action buttons - always visible on mobile (no hover) */}
                  <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                    <RequirePermission permission="group.list">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showGroupDetails(apiName)} title={t('common.show')}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="group.listmembers">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(apiName)} title={t('common.edit')}>
                        <PenLine className="w-4 h-4 text-blue-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="group.listmembers">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showMembers(apiName)} title={t('groups.members')}>
                        <Users className="w-4 h-4 text-purple-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="group.delete">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
                        if (!confirm(`${t('groups.confirmDelete')}: ${apiName}?`)) return;
                        try { await api.delete(`/groups/${encodeURIComponent(apiName)}`); toast.success(`${t('groups.groupDeleted')}: ${apiName}`); loadGroups(); }
                        catch (err: unknown) { const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string }; toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error'))); }
                      }} title={t('common.delete')}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </RequirePermission>
                  </div>
                </Card>
              );
            })
          )}
        </div>
        )}

        {/* Desktop table — shown when NOT mobile (desktop / wide tablet). */}
        {!isMobile && (
        <Card className="overflow-hidden">
          <ScrollArea className="h-[calc(100vh-14rem)]">
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
                      return <TableHead key={col.key} className="w-40">{t('common.actions')}</TableHead>;
                    }
                    const label = col.removable ? col.label : (
                      col.key === 'sAMAccountName' ? t('groups.groupname') :
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
                {loading ? (
                  <TableRow><TableCell colSpan={visibleColCount} className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                ) : filteredGroups.length === 0 ? (
                  <TableRow><TableCell colSpan={visibleColCount} className="text-center py-8 text-muted-foreground">{t('common.noData')}</TableCell></TableRow>
                ) : (
                  filteredGroups.map((group, i) => {
                    const name = getGroupName(group);
                    const desc = getGroupDesc(group);
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
                                  <RequirePermission permission="group.list">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showGroupDetails(name)} title={t('common.show')}>
                                      <Eye className="w-3 h-3" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="group.listmembers">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(name)} title={t('common.edit')}>
                                      <PenLine className="w-3 h-3 text-blue-400" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="group.listmembers">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showMembers(name)} title={t('groups.members')}>
                                      <Users className="w-3 h-3" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="group.delete">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => {
                                      if (!confirm(`${t('groups.confirmDelete')}: ${name}?`)) return;
                                      try { await api.delete(`/groups/${encodeURIComponent(name)}`); toast.success(`${t('groups.groupDeleted')}: ${name}`); }
                                      catch (err: unknown) { const error = err as { response?: { data?: { detail?: string; message?: string } } }; toast.error(safeToastMessage(error?.response?.data?.detail || error?.message, t('common.error'))); }
                                    }}>
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </Button>
                                  </RequirePermission>
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.key === 'sAMAccountName') {
                            return (
                              <TableCell key={col.key}>
                                <div className="flex items-center gap-2">
                                  <Shield className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                  <span className="font-medium truncate max-w-[200px]" title={name}>{name}</span>
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.key === 'description') {
                            return (
                              <TableCell key={col.key} className="text-sm text-muted-foreground">
                                <span className="truncate max-w-[300px] block" title={desc}>{desc}</span>
                              </TableCell>
                            );
                          }
                          // Generic extra column
                          const value = group[col.key];
                          return (
                            <TableCell key={col.key} className="text-xs">
                              <span className="truncate max-w-[150px] block">
                                {value !== undefined ? (Array.isArray(value) ? (value as unknown[]).join(', ') : String(value)) : ''}
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
          </ScrollArea>
        </Card>
        )}

        {/* Members dialog */}
        <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {t('groups.members')}: {selectedGroup}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('groups.members')}: {selectedGroup}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <RequirePermission permission="group.addmembers">
                <div className="flex gap-2">
                  <Input
                    value={addMembersInput}
                    onChange={(e) => setAddMembersInput(e.target.value)}
                    placeholder="user1, user2, user3"
                    className="h-8 text-sm"
                  />
                  <Button size="sm" onClick={addMembers}>
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </RequirePermission>
              <ScrollArea className="max-h-64">
                <div className="space-y-1">
                  {members.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('common.noData')}</p>
                  ) : (
                    members.map((member, i) => {
                      const shortName = shortMemberName(member);
                      return (
                        <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-accent text-sm">
                          <span className="truncate" title={member}>{shortName}</span>
                          <RequirePermission permission="group.removemembers">
                            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={async () => {
                              try {
                                await api.delete(`/groups/${encodeURIComponent(selectedGroup || '')}/members`, { data: { members: [member] } });
                                toast.success(`${shortName} ${t('groups.memberRemoved')}`);
                                if (selectedGroup) showMembers(selectedGroup);
                              } catch { toast.error(safeToastMessage(undefined, t('groups.failedRemoveMember'))); }
                            }}>
                              <UserMinus className="w-3 h-3 text-red-400" />
                            </Button>
                          </RequirePermission>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>

        {/* Group Details dialog */}
        <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                {selectedGroup}
              </DialogTitle>
              <DialogDescription className="sr-only">{selectedGroup}</DialogDescription>
            </DialogHeader>
            {groupDetail ? (
              <ScrollArea className="max-h-[65vh]">
                <AttributeViewer
                  entityType="groups"
                  data={groupDetail as Record<string, unknown>}
                  keyInfoKeys={['cn', 'sAMAccountName', 'description', 'groupType', 'status']}
                  showCustomize={true}
                />
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground py-4">{t('common.noData')}</p>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Group Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-blue-400" />
                {t('groups.editGroup')}: {editGroupName}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('groups.editGroup')}: {editGroupName}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <Tabs defaultValue="members" className="w-full">
                <TabsList className="grid w-full grid-cols-1 md:grid-cols-2">
                  <TabsTrigger value="members">{t('groups.members')}</TabsTrigger>
                  <TabsTrigger value="move">{t('groups.moveGroup')}</TabsTrigger>
                </TabsList>

                {/* Members Tab */}
                <TabsContent value="members" className="space-y-3 mt-3">
                  <div className="flex gap-2">
                    <Input
                      value={editAddMembersInput}
                      onChange={(e) => setEditAddMembersInput(e.target.value)}
                      placeholder="user1, user2, user3"
                      className="h-8 text-sm"
                    />
                    <Button size="sm" onClick={handleEditAddMembers} disabled={!editAddMembersInput || editLoading}>
                      {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    </Button>
                  </div>
                  <ScrollArea className="max-h-48">
                    <div className="space-y-1">
                      {editCurrentMembers.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">{t('common.noData')}</p>
                      ) : (
                        editCurrentMembers.map((member, i) => {
                          const shortName = shortMemberName(member);
                          return (
                          <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-accent text-sm">
                            <span className="truncate" title={member}>{shortName}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 flex-shrink-0"
                              onClick={() => handleEditRemoveMember(member)}
                              disabled={editLoading}
                            >
                              <UserMinus className="w-3 h-3 text-red-400" />
                            </Button>
                          </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Move Tab */}
                <TabsContent value="move" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('groups.newParentDN')} *</Label>
                    <Input
                      value={editNewParentDn}
                      onChange={(e) => setEditNewParentDn(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                      placeholder="OU=Groups,DC=example,DC=com"
                    />
                  </div>
                  <Button
                    onClick={handleEditMove}
                    disabled={!editNewParentDn || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FolderInput className="w-4 h-4 mr-1" />}
                    {t('groups.moveGroup')}
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
