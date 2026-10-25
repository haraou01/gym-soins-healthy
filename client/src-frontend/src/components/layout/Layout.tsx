import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';

import { Sidebar } from './Sidebar';
import { useSettings } from '@/hooks/useSettings';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import {
  findModuleByPath,
  SETTINGS_LABEL,
  SETTINGS_PATH,
} from '@/routes/modules';

export function Layout() {
  const { pathname } = useLocation();
  const { settings } = useSettings();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentModule = findModuleByPath(pathname);
  const title = currentModule
    ? currentModule.label
    : pathname === '/dashboard'
      ? 'Tableau de bord'
      : pathname === SETTINGS_PATH
        ? SETTINGS_LABEL
        : settings.gymName;

  // Ferme le tiroir mobile à chaque navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Verrouille le défilement et gère Échap lorsque le tiroir est ouvert.
  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  return (
    <div className="flex h-dvh bg-surface text-content">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-content focus:shadow-lg"
      >
        Aller au contenu principal
      </a>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Ouvrir la navigation"
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-raised text-content-muted transition-colors hover:bg-surface-overlay hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
            >
              <Menu size={18} />
            </button>
            <p className="truncate text-base font-semibold text-content sm:text-lg">
              {title}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <DensityToggle />
            <ThemeToggle />
          </div>
        </header>

        <main
          id="main-content"
          data-main
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 focus:outline-none sm:p-6 lg:p-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
