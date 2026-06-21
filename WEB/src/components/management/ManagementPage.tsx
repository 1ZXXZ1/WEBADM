'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/permissions/RequirePermission';
import {
  Users, KeyRound, Shield, Lock, FileText, Ban, BarChart3, ScrollText,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Lock as LockIcon } from 'lucide-react';
import EnvSettingsTab from './EnvSettingsTab';
import BanManagementTab from './BanManagementTab';
import UsersTab from './UsersTab';
import KeysTab from './KeysTab';
import RolesTab from './RolesTab';
import PermissionsTab from './PermissionsTab';
import StatsTab from './StatsTab';
import AuditTab from './AuditTab';
import {
  mgmtRolesApi, mgmtUsersApi, getErrorMessage,
  type MgmtRole, type MgmtUser,
} from '@/lib/api-mgmt';
import { toast } from 'sonner';
import { safeToastMessage } from '@/lib/parsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { useOrientation } from '@/hooks/use-orientation';

const BUILT_IN_ROLES = ['admin', 'operator', 'auditor', 'viewer'];

export default function ManagementPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { effectiveLandscape } = useOrientation();
  const isLandscapeMobile = isMobile && effectiveLandscape;

  // Shared state: roles + users (used by multiple tabs)
  const [roles, setRoles] = useState<MgmtRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [users, setUsers] = useState<MgmtUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const data = await mgmtRolesApi.list({ include_disabled: true });
      setRoles(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadRoles')));
    } finally {
      setRolesLoading(false);
    }
  }, [t]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await mgmtUsersApi.list({ offset: 0, limit: 500 });
      setUsers(data);
    } catch (err) {
      toast.error(safeToastMessage(getErrorMessage(err), t('management.failedLoadUsers')));
    } finally {
      setUsersLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRoles();
    loadUsers();
  }, [loadRoles, loadUsers]);

  // Combined role options for create-user / create-key dropdowns
  const roleOptions = useMemo(() => {
    const set = new Set<string>(BUILT_IN_ROLES);
    for (const r of roles) {
      const name = String(r?.name ?? '').trim();
      if (name) set.add(name);
    }
    const builtIn = BUILT_IN_ROLES.filter(r => set.has(r));
    const custom = [...set]
      .filter(r => !BUILT_IN_ROLES.includes(r))
      .sort((a, b) => a.localeCompare(b));
    return [...builtIn, ...custom];
  }, [roles]);

  // Reload helper — used by tabs when they modify roles/users
  const handleRolesOrUsersChanged = useCallback(() => {
    loadRoles();
    loadUsers();
  }, [loadRoles, loadUsers]);

  const tabItems = [
    { value: 'users', label: t('management.users'), icon: Users },
    { value: 'keys', label: t('management.apiKeys'), icon: KeyRound },
    { value: 'roles', label: t('management.roles'), icon: Shield },
    { value: 'permissions', label: t('management.permissions'), icon: Lock },
    { value: 'stats', label: t('management.stats_tab'), icon: BarChart3 },
    { value: 'audit', label: t('management.audit_tab'), icon: ScrollText },
    { value: 'env', label: t('management.env.tab', 'ENV / .env'), icon: FileText },
    { value: 'bans', label: t('management.ban.tab', { defaultValue: 'Блокировка' }), icon: Ban },
  ];

  return (
    <RequirePermission permission="mgmt.users.list">
      <Tabs defaultValue="users" className={`flex ${isMobile ? 'flex-col' : 'flex-row'} gap-3 h-[calc(100vh-9rem)]`}>
        {/* Tabs sidebar — like Chat rooms list.
            Mobile (+ ⟳ rotate): horizontal scrollable list at top.
            Desktop: vertical list on the left.
            Uses isMobile (short-side check) instead of md: breakpoint so
            ⟳ landscape on a phone still shows horizontal tabs (920px wide
            would otherwise trigger md:flex-row). */}
        <div className={`${isMobile ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto'} flex-shrink-0`}
          style={{ WebkitOverflowScrolling: 'touch', touchAction: isMobile ? 'pan-x' : 'pan-y' }}
        >
          <TabsList className={`${isMobile ? 'flex flex-row gap-1 h-9' : 'flex flex-col w-48 h-auto gap-1'} bg-transparent p-0`}>
            {tabItems.map(item => {
              const Icon = item.icon;
              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className={`${isMobile ? 'flex-shrink-0 px-3' : 'w-full justify-start'} gap-2 text-xs md:text-sm py-2 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground rounded-md whitespace-nowrap`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Tab content — fills remaining space */}
        <div className="flex-1 min-w-0 min-h-0 overflow-auto">
          <TabsContent value="users" className="mt-0">
            <UsersTab
              roleOptions={roleOptions}
              onRolesMaybeChanged={handleRolesOrUsersChanged}
            />
          </TabsContent>

          <TabsContent value="keys" className="mt-0">
            <KeysTab
              roleOptions={roleOptions}
              users={usersLoading ? [] : users}
            />
          </TabsContent>

          <TabsContent value="roles" className="mt-0">
            <RolesTab
              roles={roles}
              loading={rolesLoading}
              onReload={handleRolesOrUsersChanged}
              users={usersLoading ? [] : users}
            />
          </TabsContent>

          <TabsContent value="permissions" className="mt-0">
            <PermissionsTab
              roles={roles}
              loading={rolesLoading}
              onReload={handleRolesOrUsersChanged}
            />
          </TabsContent>

          <TabsContent value="stats" className="mt-0">
            <StatsTab />
          </TabsContent>

          <TabsContent value="audit" className="mt-0">
            <AuditTab />
          </TabsContent>

          <TabsContent value="env" className="mt-0">
            <RequirePermission permission="cfg.list" fallback={<EnvAccessDenied />}>
              <EnvSettingsTab />
            </RequirePermission>
          </TabsContent>

          <TabsContent value="bans" className="mt-0">
            <RequirePermission permission="ban.list" fallback={<BanAccessDenied />}>
              <BanManagementTab />
            </RequirePermission>
          </TabsContent>
        </div>
      </Tabs>
    </RequirePermission>
  );
}

// Inline fallback component for users without cfg.list permission
function EnvAccessDenied() {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="py-8 text-center text-muted-foreground">
        <LockIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">{t('management.env.accessDenied', 'Недостаточно прав для просмотра настроек ENV')}</p>
      </div>
    </Card>
  );
}

// Inline fallback component for users without ban.list permission
function BanAccessDenied() {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="py-8 text-center text-muted-foreground">
        <LockIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">{t('management.ban.accessDenied', { defaultValue: 'Недостаточно прав для просмотра банов' })}</p>
      </div>
    </Card>
  );
}
