'use client';

import React from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RequirePermissionProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RequirePermission({ permission, children, fallback }: RequirePermissionProps) {
  const { hasPermission } = useAuthStore();
  const { t } = useTranslation();

  const permitted = hasPermission(permission);

  if (permitted) {
    return <>{children}</>;
  }

  // If a custom fallback is provided, render it instead of the blurred overlay
  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <div className="relative rounded-lg overflow-hidden">
      <div className="opacity-50 blur-[2px] pointer-events-none select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center backdrop-blur-sm bg-background/30">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Lock className="h-8 w-8" />
          <span className="text-sm font-medium">{t('permissions.accessDenied')}</span>
          <span className="text-xs text-center max-w-[200px]">{t('permissions.lockMessage')}</span>
          <span className="text-xs font-mono bg-muted px-2 py-1 rounded">{permission}</span>
        </div>
      </div>
    </div>
  );
}
