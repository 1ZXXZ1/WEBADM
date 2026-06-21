'use client';

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import {
  Users, Shield, Globe, Terminal, Play,
  Sun, Moon, LogOut, ChevronDown, Monitor, FolderTree,
  Server, Settings, LayoutDashboard, Building2,
  Cpu, Phone, Share2, KeyRound, FileText, Database, FolderSync,
  Sparkles, MessageCircle, Menu, Maximize, Minimize, RotateCw,
} from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useOrientation } from '@/hooks/use-orientation';
// AI Assistant is back as a global floating panel — with only two modes:
// "Конструктор" (ai) and "Агент" (agent). Auto and SDB(beta) modes were
// removed per user request. Chat is a separate page (private from AI).
import AIAssistant from '@/components/etl/AIAssistant';

export type PageId = 'dashboard' | 'users' | 'groups' | 'computers' | 'contacts' | 'ou' |
  'dns' | 'gpo' | 'domain' | 'shell' | 'shell-projects' | 'tasks' | 'dataforge' | 'audit' | 'management' | 'chat';

interface NavItem {
  id: PageId;
  labelKey: string;
  icon: React.ElementType;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, permission: 'dashboard.full' },
  { id: 'users', labelKey: 'nav.users', icon: Users, permission: 'user.list' },
  { id: 'groups', labelKey: 'nav.groups', icon: Shield, permission: 'group.list' },
  { id: 'computers', labelKey: 'nav.computers', icon: Monitor, permission: 'computer.list' },
  { id: 'contacts', labelKey: 'nav.contacts', icon: Phone, permission: 'contact.list' },
  { id: 'ou', labelKey: 'nav.ou', icon: FolderTree, permission: 'ou.list' },
  { id: 'dns', labelKey: 'nav.dns', icon: Globe, permission: 'dns.zonelist' },
  { id: 'gpo', labelKey: 'nav.gpo', icon: FileText, permission: 'gpo.list' },
  { id: 'domain', labelKey: 'nav.domain', icon: Server, permission: 'domain.info' },
  { id: 'shell', labelKey: 'nav.shell', icon: Terminal, permission: 'shell.execute' },
  { id: 'shell-projects', labelKey: 'nav.shellProjects', icon: FolderSync, permission: 'shell.execute' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: Play, permission: 'batch.execute' },
  { id: 'dataforge', labelKey: 'nav.dataforge', icon: Sparkles, permission: 'sdb.info' },
  // Chat — new chat system using /api/v1/chat/* endpoints with WebSocket.
  // Separate from AI Assistant (which was removed) so chat content stays
  // private from AI by default.
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, permission: 'chat.rooms.list' },
  // Audit moved INSIDE Management page (Управление → Аудит tab) — no longer
  // a separate top-level nav item, to avoid confusion with the Samba AD
  // audit page. The standalone 'audit' page is still routable via the
  // PageId type and direct navigation, just not in the menu.
  { id: 'management', labelKey: 'nav.management', icon: Settings, permission: 'mgmt.users.list' },
];

interface MainLayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  children: React.ReactNode;
}

export default function MainLayout({ currentPage, onNavigate, children }: MainLayoutProps) {
  const { t, i18n } = useTranslation();
  const { user, logout, hasPermission } = useAuthStore();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'dark'
  );
  const [collapsed, setCollapsed] = useState(false);
  // Mobile: sidebar is an overlay drawer, hidden by default
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Orientation: tracks natural device orientation + lets the user force
  // a visual 90° rotation on mobile portrait devices (e.g. Oppo Reno 11F).
  // When force-landscape is on, the Samba AD sidebar is hidden entirely so
  // the chat / content area gets full width.
  const {
    isMobile,
    forceLandscape,
    effectiveLandscape,
    toggleForceLandscape: origToggleForceLandscape,
  } = useOrientation();

  // In forced-landscape on mobile, we hide the sidebar (per user spec:
  // "в альбомные не нужно показывать панель samba ad").
  // NOTE: we check `forceLandscape` directly (not just effectiveLandscape)
  // because after native orientation lock the viewport may flip past the
  // md: breakpoint (e.g. Oppo Reno 11F: 920px wide in landscape > 768px),
  // which would otherwise make the sidebar reappear as a static column.
  // Also hide when forceLandscape is on, regardless of effectiveLandscape,
  // to be safe during the transition.
  const hideSidebar = (isMobile && effectiveLandscape) || (forceLandscape && isMobile);

  // Wrap toggle: when entering landscape, force-close the mobile sidebar
  // so it doesn't flash open during the orientation transition. The user
  // can re-open it via the hamburger button (which stays visible in ⟳ mode).
  const toggleForceLandscape = useCallback(async () => {
    setMobileSidebarOpen(false);
    await origToggleForceLandscape();
  }, [origToggleForceLandscape]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    localStorage.setItem('samba-theme', newTheme);
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'ru' ? 'en' : 'ru';
    i18n.changeLanguage(newLang);
    localStorage.setItem('samba-lang', newLang);
  };

  const roleColor = user?.role === 'admin' ? 'bg-red-500' : user?.role === 'operator' ? 'bg-blue-500' : 'bg-gray-500';

  // ── The app tree. When force-rotate is on:
  //    - PRIMARY: Screen Orientation API rotates the browser natively.
  //      No wrapper needed — everything works in real landscape.
  //    - FALLBACK: CSS class on <body> rotates everything (see globals.css).
  //      Portaled dialogs are included because they're children of <body>.
  //
  // Sidebar behavior:
  //   - Normal mobile (portrait): sidebar is hidden, hamburger opens it as drawer
  //   - ⟳ landscape mobile (hideSidebar=true): sidebar NOT shown as static
  //     column, BUT user can still open it as overlay drawer via hamburger
  //   - Desktop (md+): sidebar always visible as static column (or collapsed)
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* ── Mobile sidebar overlay backdrop ──────────────────────────── */}
        {/* Shown when drawer is open (mobile portrait OR ⟳ landscape) */}
        {mobileSidebarOpen && (
          <div
            data-sidebar-backdrop
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        {/* Three modes:
            1. Desktop (not hideSidebar, not mobile): static column, always visible
            2. Mobile portrait (not hideSidebar, isMobile): drawer, hidden by default
            3. ⟳ landscape (hideSidebar): NOT a static column, only opens as drawer */}
        {(!hideSidebar || mobileSidebarOpen) && (
          <aside data-sidebar className={`
            ${collapsed && !hideSidebar ? 'w-16' : 'w-56'}
            ${hideSidebar ? 'fixed' : 'fixed md:relative'}
            flex-shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col transition-all duration-200
            inset-y-0 left-0 z-50
            h-screen md:h-screen
            max-h-screen
            overflow-hidden
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}>
            {/* Sidebar header */}
            <div className={`h-14 flex items-center ${collapsed ? 'justify-center' : 'px-4'} border-b border-gray-800 flex-shrink-0`}>
              {!collapsed && (
                <div className="flex items-center gap-2">
                  <Image src="/logo.svg" alt="Samba AD" width={32} height={32} className="rounded-lg" />
                  <span className="font-bold text-white text-sm">Samba AD</span>
                </div>
              )}
              {collapsed && (
                <div className="flex items-center justify-center">
                  <Image src="/logo_1.svg" alt="Samba AD" width={28} height={28} className="rounded" />
                </div>
              )}
            </div>

            {/* Navigation — scrollable, fills remaining height */}
            <ScrollArea className="flex-1 py-2 min-h-0">
              <nav className="space-y-0.5 px-2">
                {NAV_ITEMS.map((item) => {
                  const permitted = !item.permission || hasPermission(item.permission);
                  const isActive = currentPage === item.id;
                  const Icon = item.icon;

                  if (!permitted) return null;

                  return (
                    <Tooltip key={item.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            onNavigate(item.id);
                            // Close drawer after navigation (mobile / ⟳ mode)
                            setMobileSidebarOpen(false);
                          }}
                          className={`
                            w-full flex items-center gap-3 rounded-lg text-sm transition-all duration-150
                            ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
                            ${isActive
                              ? 'bg-emerald-600/20 text-emerald-400'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                            }
                          `}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-emerald-400' : ''}`} />
                          {!collapsed && (
                            <span className="truncate">{t(item.labelKey)}</span>
                          )}
                        </button>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right" className="text-xs">
                          {t(item.labelKey)}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </nav>
            </ScrollArea>

            {/* Collapse button */}
            <div className="p-2 border-t border-gray-800">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // On mobile: just close the drawer
                  if (window.innerWidth < 768) {
                    setMobileSidebarOpen(false);
                    return;
                  }
                  // On desktop: toggle collapse
                  const newCollapsed = !collapsed;
                  setCollapsed(newCollapsed);
                  if (newCollapsed && currentPage !== 'tasks') {
                    onNavigate('tasks');
                  }
                }}
                className="w-full text-gray-500 hover:text-gray-300"
              >
                {collapsed ? '→' : '←'}
              </Button>
            </div>
          </aside>
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden w-full">
          {/* Header — compact on mobile, with hamburger menu */}
          {/* In force-landscape on mobile, header is even more compact (h-10) */}
          <header className={`${hideSidebar ? 'h-10' : 'h-12 md:h-14'} flex items-center justify-between px-2 md:px-4 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0`}>
            <div className="flex items-center gap-1 md:gap-2 min-w-0">
              {/* Hamburger menu — shown on mobile (portrait) AND in ⟳ landscape
                  mode (hideSidebar=true). Lets the user open the sidebar as
                  an overlay drawer even when the static sidebar is hidden. */}
              {(isMobile || hideSidebar) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => setMobileSidebarOpen(true)}
                  title="Меню"
                >
                  <Menu className="w-5 h-5" />
                </Button>
              )}
              {/* Samba AD logo — mobile only (when sidebar hidden) */}
              <Image src="/logo.svg" alt="Samba AD" width={24} height={24} className="rounded md:hidden flex-shrink-0" />
              {/* Page title */}
              <h2 className={`${hideSidebar ? 'text-xs md:text-sm' : 'text-sm md:text-lg'} font-semibold truncate`}>
                {t(NAV_ITEMS.find(n => n.id === currentPage)?.labelKey || 'nav.dashboard')}
              </h2>
              {/* When sidebar is force-hidden, show a small hint */}
              {hideSidebar && (
                <span className="hidden md:inline text-[10px] text-muted-foreground ml-2">
                  (альбомный режим)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-2">
              {/* Rotate toggle — lets the user force-rotate the app on mobile portrait.
                  Useful on Oppo Reno 11F 5G with rotation lock on. */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 text-muted-foreground hover:text-foreground ${forceLandscape ? 'text-emerald-500 hover:text-emerald-400' : ''}`}
                onClick={toggleForceLandscape}
                title={forceLandscape ? 'Выйти из альбомного режима' : 'Альбомный режим (поворот)'}
              >
                <RotateCw className={`w-4 h-4 ${forceLandscape ? 'rotate-90' : ''} transition-transform`} />
              </Button>

              {/* Fullscreen toggle — next to language/theme */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </Button>

              {/* Language toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLanguage}
                className="text-xs font-bold text-muted-foreground hover:text-foreground px-2"
              >
                {i18n.language === 'ru' ? 'RU' : 'EN'}
              </Button>

              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="text-muted-foreground hover:text-foreground"
                title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2">
                    <Avatar className="w-7 h-7">
                      <AvatarFallback className="bg-gray-800 text-xs">
                        {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:flex flex-col items-start">
                      <span className="text-xs font-medium">{user?.username || 'User'}</span>
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${roleColor} text-white border-0`}>
                        {user?.role || 'viewer'}
                      </Badge>
                    </div>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{user?.username}</p>
                    <p className="text-xs text-muted-foreground">{t('profile.role')}: {user?.role}</p>
                    <p className="text-xs text-muted-foreground">{user?.permissions?.length || 0} {t('profile.permissions')}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-red-400 cursor-pointer">
                    <LogOut className="w-4 h-4 mr-2" />
                    {t('profile.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Page content — minimal padding on mobile */}
          <main className="flex-1 overflow-auto p-1 md:p-4 lg:p-6">
            {children}
          </main>
        </div>
        {/* Global AI Assistant — hidden on Chat page for privacy + space */}
        {currentPage !== 'chat' && <AIAssistant />}
      </div>
    </TooltipProvider>
  );
}
