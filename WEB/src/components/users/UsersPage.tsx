'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import api from '@/lib/api';
import {
  parseUserDetail, extractOutputText, unwrapResponse,
  decodeLdapObject, safeToastMessage,
  type UserDetail,
} from '@/lib/parsers';
import AttributeViewer from '@/components/shared/AttributeViewer';
import ColumnCustomizer, { useColumnConfig, extractAllKeys, type ColumnDef } from '@/components/shared/ColumnCustomizer';
import { ResizeHandle } from '@/components/shared/ResizableTable';
import {
  UserPlus, Trash2, KeyRound, UserCheck, UserX,
  Search, RefreshCw, Eye, FolderInput, PenLine,
  CalendarClock, Loader2, Mail, User as UserIcon,
  Shield, Unlock, ShieldAlert,
  FilePenLine, ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

export default function UsersPage() {
  const { t } = useTranslation();
  // useIsMobile checks the SHORT side of the screen, so it returns true
  // even when a phone is rotated to landscape (e.g. Oppo Reno 11F in ⟳ mode:
  // viewport ~920×412, short side 412 < 768 → still mobile → show cards).
  const isMobile = useIsMobile();
  // effectiveLandscape: true when device is in landscape (natural or ⟳ forced).
  // Used to show icon-only tabs in Edit User dialog (text would overflow in
  // the narrow rotated viewport).
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetail | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit user dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  // Active edit tab — used to show the tab's text label centered in ⟳ mode
  // (where tabs are icon-only, the user needs to see what they selected).
  const [editActiveTab, setEditActiveTab] = useState('password');

  // Edit form fields
  const [editPassword, setEditPassword] = useState('');
  const [editMustChange, setEditMustChange] = useState(false);
  const [editExpiryDays, setEditExpiryDays] = useState('');
  const [editNewSamName, setEditNewSamName] = useState('');
  const [editNewParentDn, setEditNewParentDn] = useState('');
  const [editSensitiveOn, setEditSensitiveOn] = useState(false);

  // Create user form
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '', password: '',
    must_change_at_next_login: false, random_password: false,
    smartcard_required: false, use_username_as_cn: false,
    userou: '', surname: '', given_name: '', initials: '',
    profile_path: '', script_path: '', home_drive: '', home_directory: '',
    job_title: '', department: '', company: '', description: '',
    mail_address: '', internet_address: '', telephone_number: '',
    physical_delivery_office: '',
    rfc2307_from_nss: false, nis_domain: '',
    unix_home: '', uid: '', uid_number: 0, gid_number: 0,
    gecos: '', login_shell: '',
  });
  // Admin groups for "Make Admin" feature
  const [adminGroups, setAdminGroups] = useState({
    'Domain Admins': false,
    'Schema Admins': false,
    'Enterprise Admins': false,
    'Group Policy Creator Owners': false,
    'Administrators': false,
  });

  const defaultColumns: ColumnDef[] = [
    { key: '#', label: '#', visible: true, removable: false },
    { key: 'sAMAccountName', label: t('users.username'), visible: true },
    { key: 'sn', label: t('users.surname'), visible: true },
    { key: 'givenName', label: t('users.givenName'), visible: true },
    { key: 'mail', label: t('users.mail'), visible: true },
    { key: 'whenChanged', label: 'whenChanged', visible: true },
    { key: 'userAccountControl', label: t('common.status'), visible: true },
    { key: 'actions', label: t('common.actions'), visible: true, removable: false },
  ];
  const { columns: colConfig, setColumns: setColConfig, isColumnVisible, visibleColumns, extraVisibleColumns, getColumnWidth, setColumnWidth } = useColumnConfig('users', defaultColumns);

  // Compute all data keys from loaded users for the customizer
  const userDataKeys = useMemo(() => {
    // Use extractAllKeys to get ALL keys including nested objects,
    // not just top-level keys. This ensures ColumnCustomizer shows
    // all available fields from LDAP data.
    return extractAllKeys(users as unknown as Record<string, unknown>[]);
  }, [users]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Try /users/full first (returns full LDAP objects, like Groups and Computers)
      let response;
      try {
        response = await api.get('/users/full');
      } catch {
        // Fallback to old endpoint
        response = await api.get('/users/');
      }
      const data = response.data;
      const outputText = extractOutputText(data);

      let userList: UserDetail[] = [];

      if (Array.isArray(data)) {
        userList = data.map((u: Record<string, unknown>) => {
          const decoded = decodeLdapObject(u as Record<string, unknown>);
          // Extract nested "user" object if present
          const userObj = decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)
            ? decoded.user as Record<string, unknown> : decoded;
          return {
            username: String(userObj.sAMAccountName || userObj.username || userObj.name || userObj.cn || Object.values(userObj)[0] || ''),
            ...userObj,
          } as UserDetail;
        });
      } else if (data?.data && Array.isArray(data.data)) {
        userList = data.data.map((u: Record<string, unknown>) => {
          const decoded = decodeLdapObject(u as Record<string, unknown>);
          const userObj = decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)
            ? decoded.user as Record<string, unknown> : decoded;
          return {
            username: String(userObj.sAMAccountName || userObj.username || userObj.name || userObj.cn || Object.values(userObj)[0] || ''),
            ...userObj,
          } as UserDetail;
        });
      } else if (data?.users && Array.isArray(data.users)) {
        userList = data.users.map((u: Record<string, unknown>) => {
          const decoded = decodeLdapObject(u as Record<string, unknown>);
          const userObj = decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)
            ? decoded.user as Record<string, unknown> : decoded;
          return {
            username: String(userObj.sAMAccountName || userObj.username || userObj.name || userObj.cn || Object.values(userObj)[0] || ''),
            ...userObj,
          } as UserDetail;
        });
      } else if (outputText) {
        const lines = outputText.split('\n').filter((l: string) => l.trim());
        userList = lines.map((line: string) => {
          const parts = line.split(':');
          if (parts.length >= 3) {
            return { username: parts[0].trim(), sn: parts[1].trim(), givenName: parts[2].trim() };
          }
          return { username: line.trim() };
        });
      } else if (data?.result && typeof data.result === 'object') {
        const result = data.result;
        if (Array.isArray(result)) {
          userList = result.map((u: Record<string, unknown>) => {
            const decoded = decodeLdapObject(u as Record<string, unknown>);
            const userObj = decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)
              ? decoded.user as Record<string, unknown> : decoded;
            return {
              username: String(userObj.sAMAccountName || userObj.username || userObj.name || userObj.cn || Object.values(userObj)[0] || ''),
              ...userObj,
            } as UserDetail;
          });
        } else if (result.output) {
          const lines = String(result.output).split('\n').filter((l: string) => l.trim());
          userList = lines.map((line: string) => ({ username: line.trim() }));
        }
      }

      setUsers(userList);

      if (userList.length > 0 && userList.length <= 200) {
        loadUserDetailsBatch(userList);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('users.failedLoad')));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Batch-load user details (sn, givenName, mail) for the table
  const loadUserDetailsBatch = useCallback(async (baseUsers: UserDetail[]) => {
    setDetailsLoading(true);
    const updated = [...baseUsers];

    const batchSize = 5;
    for (let i = 0; i < updated.length; i += batchSize) {
      const batch = updated.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (user, idx) => {
          if (user.sn || user.givenName || user.mail) return { idx, detail: user };
          try {
            // Use sAMAccountName for API calls, NOT display username
            const apiName = user.sAMAccountName || user.username;
            if (!apiName) return { idx: i + idx, detail: user };
            const res = await api.get(`/users/${encodeURIComponent(apiName)}`);
            const outputText = extractOutputText(res.data);
            if (outputText) {
              return { idx: i + idx, detail: parseUserDetail(apiName, outputText) };
            }
            const unwrapped = unwrapResponse(res.data) as Record<string, unknown>;
            const decoded = decodeLdapObject(unwrapped);
            // Extract nested "user" object if present
            const userObj = decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)
              ? decoded.user as Record<string, unknown> : decoded;
            return {
              idx: i + idx,
              detail: {
                ...user,
                sn: typeof userObj.sn === 'string' ? userObj.sn : user.sn,
                givenName: typeof userObj.givenName === 'string' ? userObj.givenName : user.givenName,
                mail: typeof userObj.mail === 'string' ? userObj.mail : user.mail,
              },
            };
          } catch {
            return { idx: i + idx, detail: user };
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { idx, detail } = result.value;
          if (idx < updated.length) {
            updated[idx] = detail;
          }
        }
      }

      setUsers([...updated]);
    }
    setDetailsLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const showUser = useCallback(async (username: string) => {
    setSelectedUser(username);
    setDetailsDialogOpen(true);

    // First try to use already-loaded data (like Groups/Computers show does)
    const found = users.find(u =>
      u.sAMAccountName === username || u.username === username || u.cn === username
    );
    if (found && Object.keys(found).length > 3) {
      // Already have full LDAP data from /users/full
      const decoded = decodeLdapObject(found as Record<string, unknown>);
      // Extract nested "user" object if present
      if (decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)) {
        const innerUser = decoded.user as Record<string, unknown>;
        const { user: _u, ...restOuter } = decoded;
        setUserDetails({ username, ...innerUser, ...restOuter } as UserDetail);
      } else {
        setUserDetails({ username, ...decoded } as UserDetail);
      }
      return;
    }

    // Fallback: fetch from API
    setUserDetails(null);
    try {
      const response = await api.get(`/users/${encodeURIComponent(username)}`);
      const data = response.data;
      const outputText = extractOutputText(data);

      if (outputText) {
        // Parse text output into a structured object
        const parsed = parseUserDetail(username, outputText);
        setUserDetails(parsed);
      } else {
        // Use raw LDAP object directly (like Groups show does)
        let unwrapped = unwrapResponse(data) as Record<string, unknown>;
        const decoded = decodeLdapObject(unwrapped);

        // Extract nested "user" object from API response (e.g. {status: "ok", user: {dn:..., cn:...}})
        // This is the common format from the Samba AD API
        if (decoded.user && typeof decoded.user === 'object' && !Array.isArray(decoded.user)) {
          const innerUser = decoded.user as Record<string, unknown>;
          const { user: _u, ...restOuter } = decoded;
          setUserDetails({ username, ...innerUser, ...restOuter } as UserDetail);
        } else {
          setUserDetails({ username, ...decoded } as UserDetail);
        }
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('users.failedDetails')));
    }
  }, [users, t]);

  const createUser = useCallback(async () => {
    try {
      await api.post('/users/', newUser);
      // Add to admin groups if selected
      const groupsToAdd = Object.entries(adminGroups).filter(([, v]) => v).map(([k]) => k);
      for (const group of groupsToAdd) {
        try {
          await api.post(`/groups/${encodeURIComponent(group)}/members`, { members: [newUser.username] });
        } catch (grpErr) {
          console.warn(`Failed to add ${newUser.username} to ${group}:`, grpErr);
          toast.error(t('users.failedAddToGroup', { group }));
        }
      }
      toast.success(`${t('users.userCreated')}: ${newUser.username}`);
      if (groupsToAdd.length > 0) {
        toast.info(t('users.addedToGroups', { groups: groupsToAdd.join(', ') }));
      }
      setCreateDialogOpen(false);
      // Reset admin groups
      setAdminGroups({ 'Domain Admins': false, 'Schema Admins': false, 'Enterprise Admins': false, 'Group Policy Creator Owners': false, 'Administrators': false });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('users.failedCreate')));
    }
  }, [newUser, adminGroups, t]);

  const deleteUser = useCallback(async (username: string) => {
    if (!confirm(`${t('users.confirmDelete')}: ${username}?`)) return;
    try {
      await api.delete(`/users/${encodeURIComponent(username)}`);
      toast.success(`${t('users.userDeleted')}: ${username}`);
      if (selectedUser === username) { setSelectedUser(null); setDetailsDialogOpen(false); }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    }
  }, [selectedUser, t]);

  const toggleUser = useCallback(async (username: string, action: 'enable' | 'disable') => {
    try {
      await api.post(`/users/${encodeURIComponent(username)}/${action}`);
      toast.success(`${action === 'enable' ? t('users.userEnabled') : t('users.userDisabled')}: ${username}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    }
  }, [t]);

  // Open edit dialog for a user
  const openEditDialog = useCallback((username: string) => {
    setEditUsername(username);
    setEditPassword('');
    setEditMustChange(false);
    setEditExpiryDays('');
    setEditNewSamName('');
    setEditNewParentDn('');
    setEditSensitiveOn(false);
    setEditActiveTab('password');
    setEditDialogOpen(true);
  }, []);

  // Edit user action handlers
  const handleSetPassword = useCallback(async () => {
    if (!editUsername || !editPassword) return;
    setEditLoading(true);
    try {
      await api.put(`/users/${encodeURIComponent(editUsername)}/password`, {
        new_password: editPassword,
        ...(editMustChange ? { must_change_at_next_login: true } : {}),
      });
      toast.success(t('users.passwordSet'));
      setEditPassword('');
      setEditMustChange(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, editPassword, editMustChange, t]);

  const handleSetExpiry = useCallback(async () => {
    if (!editUsername || !editExpiryDays) return;
    setEditLoading(true);
    try {
      await api.put(`/users/${encodeURIComponent(editUsername)}/setexpiry`, {
        days: Number(editExpiryDays),
      });
      toast.success(t('users.expirySet'));
      setEditExpiryDays('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, editExpiryDays, t]);

  const handleRename = useCallback(async () => {
    if (!editUsername || !editNewSamName) return;
    setEditLoading(true);
    try {
      await api.post(`/users/${encodeURIComponent(editUsername)}/rename`, {
        new_samaccountname: editNewSamName,
      });
      toast.success(t('users.userRenamed'));
      setEditNewSamName('');
      setEditDialogOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, editNewSamName, t]);

  const handleMove = useCallback(async () => {
    if (!editUsername || !editNewParentDn) return;
    setEditLoading(true);
    try {
      await api.post(`/users/${encodeURIComponent(editUsername)}/move`, {
        new_parent_dn: editNewParentDn,
      });
      toast.success(t('users.userMoved'));
      setEditNewParentDn('');
      setEditDialogOpen(false);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, editNewParentDn, t]);

  const handleSetSensitive = useCallback(async () => {
    if (!editUsername) return;
    setEditLoading(true);
    try {
      await api.put(`/users/${encodeURIComponent(editUsername)}/sensitive`, {
        on: editSensitiveOn,
      });
      toast.success(t('users.sensitiveSet'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, editSensitiveOn, t]);

  const handleUnlock = useCallback(async () => {
    if (!editUsername) return;
    setEditLoading(true);
    try {
      await api.post(`/users/${encodeURIComponent(editUsername)}/unlock`);
      toast.success(t('users.userUnlocked'));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
      toast.error(safeToastMessage(error?.response?.data?.detail || error?.response?.data?.message || error?.message, t('common.error')));
    } finally { setEditLoading(false); }
  }, [editUsername, t]);

  const filteredUsers = users.filter(u => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    // Search across all values — handle arrays and nested objects (LDAP
    // often returns array values like memberOf: ["CN=...", "CN=..."]).
    // Stringify each value safely and check if it contains the query.
    const matchesValue = (v: unknown): boolean => {
      if (v === null || v === undefined) return false;
      if (Array.isArray(v)) {
        return v.some(item => matchesValue(item));
      }
      if (typeof v === 'object') {
        return Object.values(v as Record<string, unknown>).some(item => matchesValue(item));
      }
      return String(v).toLowerCase().includes(q);
    };
    return Object.values(u).some(v => matchesValue(v));
  });

  // Get user account status from userAccountControl
  const isAccountDisabled = (uac?: string): boolean => {
    if (!uac) return false;
    const val = parseInt(uac, 10);
    return !isNaN(val) && (val & 2) !== 0; // ACCOUNTDISABLE flag
  };

  // Get the API-usable name (sAMAccountName) for a user
  const getApiName = (user: UserDetail): string => {
    return user.sAMAccountName || user.username || '';
  };

  // Get the display name for the table
  const getDisplayName = (user: UserDetail): string => {
    return user.sAMAccountName || user.username || String(Object.values(user)[0] || '');
  };

  return (
    <RequirePermission permission="user.list">
      <div className="space-y-2 md:space-y-4">
        {/* Toolbar - compact on mobile, full on desktop */}
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          <RequirePermission permission="user.create">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
                  <UserPlus className="w-3.5 h-3.5 md:w-4 md:h-4 md:mr-1" />
                  <span className="hidden sm:inline">{t('users.createUser')}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t('users.createUser')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('users.createUser')}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  {/* Account section */}
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.accountSection')}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.username')} *</Label>
                      <Input value={newUser.username} onChange={(e) => setNewUser(p => ({ ...p, username: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.password')}</Label>
                      <Input type="password" value={newUser.password} onChange={(e) => setNewUser(p => ({ ...p, password: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('users.userOu')}</Label>
                    <Input value={newUser.userou} onChange={(e) => setNewUser(p => ({ ...p, userou: e.target.value }))} className="h-8 text-sm" autoComplete="off" placeholder="e.g. OU=Users,DC=example,DC=com" />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={newUser.must_change_at_next_login} onCheckedChange={(v) => setNewUser(p => ({ ...p, must_change_at_next_login: v }))} />
                      <Label className="text-xs">{t('users.mustChangePassword')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={newUser.random_password} onCheckedChange={(v) => setNewUser(p => ({ ...p, random_password: v }))} />
                      <Label className="text-xs">{t('users.randomPassword')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={newUser.smartcard_required} onCheckedChange={(v) => setNewUser(p => ({ ...p, smartcard_required: v }))} />
                      <Label className="text-xs">{t('users.smartcardRequired')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={newUser.use_username_as_cn} onCheckedChange={(v) => setNewUser(p => ({ ...p, use_username_as_cn: v }))} />
                      <Label className="text-xs">{t('users.useUsernameAsCn')}</Label>
                    </div>
                  </div>

                  {/* Personal info section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.personalSection')}</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.givenName')}</Label>
                      <Input value={newUser.given_name} onChange={(e) => setNewUser(p => ({ ...p, given_name: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.surname')}</Label>
                      <Input value={newUser.surname} onChange={(e) => setNewUser(p => ({ ...p, surname: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.initials')}</Label>
                      <Input value={newUser.initials} onChange={(e) => setNewUser(p => ({ ...p, initials: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>

                  {/* Contact section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.contactSection')}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.mail')}</Label>
                      <Input value={newUser.mail_address} onChange={(e) => setNewUser(p => ({ ...p, mail_address: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.internetAddress')}</Label>
                      <Input value={newUser.internet_address} onChange={(e) => setNewUser(p => ({ ...p, internet_address: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.telephone')}</Label>
                      <Input value={newUser.telephone_number} onChange={(e) => setNewUser(p => ({ ...p, telephone_number: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.physicalDeliveryOffice')}</Label>
                      <Input value={newUser.physical_delivery_office} onChange={(e) => setNewUser(p => ({ ...p, physical_delivery_office: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>

                  {/* Organization section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.organizationSection')}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.jobTitle')}</Label>
                      <Input value={newUser.job_title} onChange={(e) => setNewUser(p => ({ ...p, job_title: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.department')}</Label>
                      <Input value={newUser.department} onChange={(e) => setNewUser(p => ({ ...p, department: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.company')}</Label>
                      <Input value={newUser.company} onChange={(e) => setNewUser(p => ({ ...p, company: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.description')}</Label>
                      <Input value={newUser.description} onChange={(e) => setNewUser(p => ({ ...p, description: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>

                  {/* Profile / Logon section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.profileSection')}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.profilePath')}</Label>
                      <Input value={newUser.profile_path} onChange={(e) => setNewUser(p => ({ ...p, profile_path: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.scriptPath')}</Label>
                      <Input value={newUser.script_path} onChange={(e) => setNewUser(p => ({ ...p, script_path: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.homeDrive')}</Label>
                      <Input value={newUser.home_drive} onChange={(e) => setNewUser(p => ({ ...p, home_drive: e.target.value }))} className="h-8 text-sm" autoComplete="off" placeholder="e.g. Z:" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.homeDirectory')}</Label>
                      <Input value={newUser.home_directory} onChange={(e) => setNewUser(p => ({ ...p, home_directory: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>

                  {/* Unix / RFC2307 section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('users.unixSection')}</div>
                  <div className="flex items-center gap-2 mb-1">
                    <Switch checked={newUser.rfc2307_from_nss} onCheckedChange={(v) => setNewUser(p => ({ ...p, rfc2307_from_nss: v }))} />
                    <Label className="text-xs">{t('users.rfc2307FromNss')}</Label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.nisDomain')}</Label>
                      <Input value={newUser.nis_domain} onChange={(e) => setNewUser(p => ({ ...p, nis_domain: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.unixHome')}</Label>
                      <Input value={newUser.unix_home} onChange={(e) => setNewUser(p => ({ ...p, unix_home: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.uid')}</Label>
                      <Input value={newUser.uid} onChange={(e) => setNewUser(p => ({ ...p, uid: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.uidNumber')}</Label>
                      <Input type="number" value={newUser.uid_number} onChange={(e) => setNewUser(p => ({ ...p, uid_number: Number(e.target.value) }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.gidNumber')}</Label>
                      <Input type="number" value={newUser.gid_number} onChange={(e) => setNewUser(p => ({ ...p, gid_number: Number(e.target.value) }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.gecos')}</Label>
                      <Input value={newUser.gecos} onChange={(e) => setNewUser(p => ({ ...p, gecos: e.target.value }))} className="h-8 text-sm" autoComplete="off" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('users.loginShell')}</Label>
                      <Input value={newUser.login_shell} onChange={(e) => setNewUser(p => ({ ...p, login_shell: e.target.value }))} className="h-8 text-sm" autoComplete="off" placeholder="/bin/bash" />
                    </div>
                  </div>

                  {/* Admin Groups section */}
                  <Separator />
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-3 h-3 text-red-400" />
                    {t('users.adminGroupsSection')}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t('users.adminGroupsHint')}</p>
                  <div className="space-y-1.5">
                    {Object.entries(adminGroups).map(([group, checked]) => (
                      <label key={group} className="flex items-center gap-2 cursor-pointer hover:bg-accent/30 rounded px-1 py-0.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAdminGroups(prev => ({ ...prev, [group]: !prev[group as keyof typeof prev] }))}
                          className="w-3.5 h-3.5 rounded"
                        />
                        <span className="text-xs">{group}</span>
                      </label>
                    ))}
                  </div>

                  <Button onClick={createUser} disabled={!newUser.username} className="w-full">
                    {t('users.createUser')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </RequirePermission>

          <div className="flex-1" />

          {detailsLoading && (
            <Badge variant="outline" className="text-[10px] md:text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              <span className="hidden sm:inline">{t('users.loadingDetails')}</span>
              <span className="sm:hidden">…</span>
            </Badge>
          )}

          {/* Column customizer — available on all devices.
              On mobile it opens as a dialog (list of columns with checkboxes,
              drag to reorder, add custom columns). Hidden columns are hidden
              from both desktop table and mobile cards. */}
          <ColumnCustomizer
            entityType="users"
            columns={colConfig}
            onColumnsChange={setColConfig}
            dataKeys={userDataKeys}
          />

          <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading} className="h-8 md:h-9 px-2 md:px-3 text-xs md:text-sm">
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
            placeholder={t('users.searchUsers')}
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
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t('common.noData')}
            </div>
          ) : (
            filteredUsers.map((user, i) => {
              const apiName = getApiName(user);
              const displayName = getDisplayName(user);
              const disabled = isAccountDisabled(user.userAccountControl as string);
              // Show ALL visible columns from ColumnCustomizer as metadata in the card,
              // except # and actions (handled separately). This includes custom columns
              // the user added (e.g. krbtgt, whenCreated, etc.).
              const extraCols = visibleColumns.filter(c =>
                c.key !== '#' && c.key !== 'actions' &&
                c.key !== 'sAMAccountName' // already shown as displayName
              );
              return (
                <Card key={`m-${apiName}-${i}`} className={`p-3 ${disabled ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <UserIcon className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm truncate">{displayName}</span>
                        {disabled && (
                          <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
                            {t('common.disabled')}
                          </Badge>
                        )}
                      </div>
                      {(user.sn || user.givenName) && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {[user.givenName, user.sn].filter(Boolean).join(' ')}
                        </div>
                      )}
                      {user.mail && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground truncate">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{user.mail}</span>
                        </div>
                      )}
                      {user.whenChanged && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          {String(user.whenChanged)}
                        </div>
                      )}
                      {/* Extra visible columns from ColumnCustomizer.
                          Custom columns appear here as "key: value" rows. */}
                      {extraCols.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-0.5">
                          {extraCols.map(col => {
                            const val = user[col.key as keyof typeof user];
                            if (val === null || val === undefined || val === '') return null;
                            return (
                              <div key={col.key} className="flex items-start gap-1 text-[10px]">
                                <span className="font-mono text-muted-foreground/70 flex-shrink-0">{col.label}:</span>
                                <span className="font-mono text-muted-foreground truncate">{String(val)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Action buttons - always visible on mobile (no hover) */}
                  <div className="flex gap-1 mt-2 pt-2 border-t justify-end">
                    <RequirePermission permission="user.show">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => showUser(apiName)} title={t('common.show')}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="user.enable">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(apiName)} title={t('common.edit')}>
                        <PenLine className="w-4 h-4 text-blue-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="user.enable">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleUser(apiName, 'enable')} title={t('users.enableUser')}>
                        <UserCheck className="w-4 h-4 text-green-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="user.disable">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleUser(apiName, 'disable')} title={t('users.disableUser')}>
                        <UserX className="w-4 h-4 text-amber-400" />
                      </Button>
                    </RequirePermission>
                    <RequirePermission permission="user.delete">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteUser(apiName)} title={t('common.delete')}>
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
                <TableRow className="hover:bg-transparent">
                  {visibleColumns.map(col => {
                    // Render each visible column header in the configured order
                    if (col.key === '#') {
                      return <TableHead key={col.key} className="w-12 relative sticky top-0 bg-card z-10">#<ResizeHandle onResize={(d) => setColumnWidth('#', (getColumnWidth('#') || 48) + d)} /></TableHead>;
                    }
                    if (col.key === 'actions') {
                      return <TableHead key={col.key} className="w-56 sticky top-0 bg-card z-10">{t('common.actions')}</TableHead>;
                    }
                    // For built-in and extra columns, render by key with appropriate label
                    const label = col.removable ? col.label : (
                      col.key === 'sAMAccountName' ? t('users.username') :
                      col.key === 'sn' ? t('users.surname') :
                      col.key === 'givenName' ? t('users.givenName') :
                      col.key === 'mail' ? t('users.mail') :
                      col.key === 'whenChanged' ? 'whenChanged' :
                      col.key === 'userAccountControl' ? t('common.status') :
                      col.label
                    );
                    return (
                      <TableHead key={col.key} style={{ width: getColumnWidth(col.key) || undefined, minWidth: col.removable ? '100px' : '120px' }} className="relative sticky top-0 bg-card z-10">
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
                    <TableCell colSpan={colConfig.filter(c => c.visible).length} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colConfig.filter(c => c.visible).length} className="text-center py-8 text-muted-foreground">
                      {t('common.noData')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user, i) => {
                    const apiName = getApiName(user);
                    const displayName = getDisplayName(user);
                    const disabled = isAccountDisabled(user.userAccountControl as string);
                    return (
                      <TableRow key={`${apiName}-${i}`} className={`group ${disabled ? 'opacity-60' : ''} hover:bg-accent/50`}>
                        {visibleColumns.map(col => {
                          // Render each visible column cell in the configured order
                          if (col.key === '#') {
                            return <TableCell key={col.key} className="text-xs text-muted-foreground">{i + 1}</TableCell>;
                          }
                          if (col.key === 'actions') {
                            return (
                              <TableCell key={col.key}>
                                {/* On desktop: show on hover; on mobile (touch): always visible. */}
                                <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                  <RequirePermission permission="user.show">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => showUser(apiName)} title={t('common.show')}>
                                      <Eye className="w-3 h-3" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="user.enable">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(apiName)} title={t('common.edit')}>
                                      <PenLine className="w-3 h-3 text-blue-400" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="user.enable">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleUser(apiName, 'enable')} title={t('users.enableUser')}>
                                      <UserCheck className="w-3 h-3 text-green-400" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="user.disable">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleUser(apiName, 'disable')} title={t('users.disableUser')}>
                                      <UserX className="w-3 h-3 text-amber-400" />
                                    </Button>
                                  </RequirePermission>
                                  <RequirePermission permission="user.delete">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteUser(apiName)} title={t('common.delete')}>
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </Button>
                                  </RequirePermission>
                                </div>
                              </TableCell>
                            );
                          }
                          // Built-in columns
                          if (col.key === 'sAMAccountName') {
                            return (
                              <TableCell key={col.key}>
                                <div className="flex items-center gap-2">
                                  <UserIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                  <span className="font-medium">{displayName}</span>
                                  {disabled && <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">{t('common.disabled')}</Badge>}
                                </div>
                              </TableCell>
                            );
                          }
                          if (col.key === 'sn') {
                            return <TableCell key={col.key} className="text-sm whitespace-nowrap">{String(user.sn || user.surname || '')}</TableCell>;
                          }
                          if (col.key === 'givenName') {
                            return <TableCell key={col.key} className="text-sm whitespace-nowrap">{String(user.givenName || '')}</TableCell>;
                          }
                          if (col.key === 'mail') {
                            return (
                              <TableCell key={col.key} className="text-sm">
                                {user.mail ? (
                                  <span className="flex items-center gap-1">
                                    <Mail className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{user.mail}</span>
                                  </span>
                                ) : ''}
                              </TableCell>
                            );
                          }
                          if (col.key === 'whenChanged') {
                            return <TableCell key={col.key} className="text-xs font-mono text-muted-foreground whitespace-nowrap">{String(user.whenChanged || '')}</TableCell>;
                          }
                          if (col.key === 'userAccountControl') {
                            return (
                              <TableCell key={col.key}>
                                {user.userAccountControl ? (
                                  <Badge variant={disabled ? 'destructive' : 'default'} className="text-[10px]">
                                    {disabled ? t('common.disabled') : t('common.active')}
                                  </Badge>
                                ) : ''}
                              </TableCell>
                            );
                          }
                          // Generic extra column
                          const value = user[col.key as keyof typeof user];
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
          </ScrollArea>
        </Card>
        )}

        {/* User Details Dialog (Show) */}
        <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-3xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm md:text-base">
                <UserIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="truncate">{userDetails?.cn || userDetails?.displayName || userDetails?.sAMAccountName || selectedUser}</span>
              </DialogTitle>
              <DialogDescription className="sr-only">{selectedUser}</DialogDescription>
            </DialogHeader>
            {userDetails ? (
              <ScrollArea className="max-h-[65vh]">
                <AttributeViewer
                  entityType="users"
                  data={userDetails as Record<string, unknown>}
                  keyInfoKeys={['sAMAccountName', 'cn', 'displayName', 'sn', 'givenName', 'mail', 'userAccountControl', 'userPrincipalName', 'dn', 'distinguishedName']}
                  showCustomize={true}
                />
              </ScrollArea>
            ) : (
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-[95vw] md:max-w-xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm md:text-base">
                <PenLine className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span className="truncate">{editUsername}</span>
              </DialogTitle>
              <DialogDescription className="sr-only">{t('users.editUser')}: {editUsername}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <Tabs value={editActiveTab} onValueChange={setEditActiveTab} className="w-full">
                {/* Tabs layout:
                    - ⟳ landscape mobile: HORIZONTAL icon-only row (saves space,
                      text would overflow in narrow rotated viewport).
                      Active tab's text label is shown centered below the icons.
                    - Normal mobile portrait: VERTICAL list, icon + label
                    - Desktop: VERTICAL list, icon + label */}
                <TabsList className={`${isLandscapeMobile ? 'flex flex-row justify-around' : 'flex flex-col'} w-full h-auto gap-0.5 p-0 bg-transparent`}>
                  <TabsTrigger
                    value="password"
                    className={`${isLandscapeMobile ? 'flex-col gap-0.5 px-1' : 'w-full justify-start'} text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                    title={t('users.setPassword')}
                  >
                    <KeyRound className="w-4 h-4 flex-shrink-0" />
                    {!isLandscapeMobile && <span className="truncate ml-2">{t('users.setPassword')}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="expiry"
                    className={`${isLandscapeMobile ? 'flex-col gap-0.5 px-1' : 'w-full justify-start'} text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                    title={t('users.setExpiry')}
                  >
                    <CalendarClock className="w-4 h-4 flex-shrink-0" />
                    {!isLandscapeMobile && <span className="truncate ml-2">{t('users.setExpiry')}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="rename"
                    className={`${isLandscapeMobile ? 'flex-col gap-0.5 px-1' : 'w-full justify-start'} text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                    title={t('users.renameUser')}
                  >
                    <FilePenLine className="w-4 h-4 flex-shrink-0" />
                    {!isLandscapeMobile && <span className="truncate ml-2">{t('users.renameUser')}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="move"
                    className={`${isLandscapeMobile ? 'flex-col gap-0.5 px-1' : 'w-full justify-start'} text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                    title={t('users.moveUser')}
                  >
                    <FolderInput className="w-4 h-4 flex-shrink-0" />
                    {!isLandscapeMobile && <span className="truncate ml-2">{t('users.moveUser')}</span>}
                  </TabsTrigger>
                  <TabsTrigger
                    value="sensitive"
                    className={`${isLandscapeMobile ? 'flex-col gap-0.5 px-1' : 'w-full justify-start'} text-xs md:text-sm py-2 px-2.5 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                    title={t('users.sensitiveFlag')}
                  >
                    <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                    {!isLandscapeMobile && <span className="truncate ml-2">{t('users.sensitiveFlag')}</span>}
                  </TabsTrigger>
                </TabsList>

                {/* In ⟳ landscape mode, show the active tab's text label
                    centered below the icon row — so the user knows what
                    they selected (icons only can be ambiguous). */}
                {isLandscapeMobile && (
                  <div className="text-center text-sm font-medium py-2 border-b">
                    {editActiveTab === 'password' && t('users.setPassword')}
                    {editActiveTab === 'expiry' && t('users.setExpiry')}
                    {editActiveTab === 'rename' && t('users.renameUser')}
                    {editActiveTab === 'move' && t('users.moveUser')}
                    {editActiveTab === 'sensitive' && t('users.sensitiveFlag')}
                  </div>
                )}

                {/* Set Password Tab */}
                <TabsContent value="password" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('users.password')} *</Label>
                    <Input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={editMustChange} onCheckedChange={setEditMustChange} />
                    <Label className="text-xs">{t('users.mustChangePassword')}</Label>
                  </div>
                  <Button
                    onClick={handleSetPassword}
                    disabled={!editPassword || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <KeyRound className="w-4 h-4 mr-1" />}
                    {t('users.setPassword')}
                  </Button>
                </TabsContent>

                {/* Set Expiry Tab */}
                <TabsContent value="expiry" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('users.expiryDays')} *</Label>
                    <Input
                      type="number"
                      value={editExpiryDays}
                      onChange={(e) => setEditExpiryDays(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="0"
                    />
                  </div>
                  <Button
                    onClick={handleSetExpiry}
                    disabled={!editExpiryDays || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CalendarClock className="w-4 h-4 mr-1" />}
                    {t('users.setExpiry')}
                  </Button>
                </TabsContent>

                {/* Rename Tab */}
                <TabsContent value="rename" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('users.newSamAccountName')} *</Label>
                    <Input
                      value={editNewSamName}
                      onChange={(e) => setEditNewSamName(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    onClick={handleRename}
                    disabled={!editNewSamName || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FilePenLine className="w-4 h-4 mr-1" />}
                    {t('users.renameUser')}
                  </Button>
                </TabsContent>

                {/* Move Tab */}
                <TabsContent value="move" className="space-y-3 mt-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('users.newParentDN')} *</Label>
                    <Input
                      value={editNewParentDn}
                      onChange={(e) => setEditNewParentDn(e.target.value)}
                      className="h-8 text-sm"
                      autoComplete="off"
                      placeholder="OU=Users,DC=example,DC=com"
                    />
                  </div>
                  <Button
                    onClick={handleMove}
                    disabled={!editNewParentDn || editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FolderInput className="w-4 h-4 mr-1" />}
                    {t('users.moveUser')}
                  </Button>
                </TabsContent>

                {/* Sensitive / Unlock Tab */}
                <TabsContent value="sensitive" className="space-y-3 mt-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={editSensitiveOn} onCheckedChange={setEditSensitiveOn} />
                    <Label className="text-xs">{t('users.sensitiveFlag')}</Label>
                  </div>
                  <Button
                    onClick={handleSetSensitive}
                    disabled={editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldAlert className="w-4 h-4 mr-1" />}
                    {t('users.sensitiveSet')}
                  </Button>
                  <Separator />
                  <Button
                    variant="outline"
                    onClick={handleUnlock}
                    disabled={editLoading}
                    className="w-full"
                  >
                    {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Unlock className="w-4 h-4 mr-1" />}
                    {t('users.unlockUser')}
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
