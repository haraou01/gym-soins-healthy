import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLicense } from '@/hooks/useLicense';
import { useSettings } from '@/hooks/useSettings';
import { canManageSettings } from '@/lib/roles';
import { APP_MODULES, SETTINGS_LABEL, SETTINGS_PATH } from '@/routes/modules';
import { LogOut, Settings, Shield, X } from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { user, logout, switchTenant } = useAuth();
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const { hasFeature } = useLicense();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const showSettings = canManageSettings(user?.role);

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  function goTo(path: string) {
    navigate(path);
    onClose();
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Fermer la navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        aria-label="Navigation principale"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-card transition-transform duration-300 ease-out lg:visible lg:translate-x-0 lg:shadow-none ${
          open
            ? 'visible translate-x-0 shadow-2xl'
            : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-line px-4">
          <div className="flex min-w-0 items-center gap-2">
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.gymName}
                className="h-8 w-8 shrink-0 rounded bg-surface-raised object-contain"
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-600">
                <Shield size={20} className="text-white" />
              </div>
            )}
            <span className="truncate text-lg font-bold tracking-tight text-content">
              {settings.gymName}
            </span>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer la navigation"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-overlay hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav
          aria-label="Modules"
          className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
        >
          <button
            type="button"
            onClick={() => goTo('/dashboard')}
            aria-current={pathname === '/dashboard' ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              pathname === '/dashboard'
                ? 'bg-brand-600/15 text-brand-700 dark:text-brand-300'
                : 'text-content-muted hover:bg-surface-overlay hover:text-content'
            }`}
          >
            <Shield size={18} />
            <span>Tableau de bord</span>
          </button>

          {APP_MODULES.filter((module) => hasFeature(module.feature)).map(
            (module) => {
              const Icon = module.icon;
              const active = pathname === module.path;

              return (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => goTo(module.path)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    active
                      ? 'bg-brand-600/15 text-brand-700 dark:text-brand-300'
                      : 'text-content-muted hover:bg-surface-overlay hover:text-content'
                  }`}
                >
                  <Icon size={18} />
                  <span>{module.label}</span>
                </button>
              );
            },
          )}

          {showSettings && (
            <div className="pt-3">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Administration
              </p>
              <button
                type="button"
                onClick={() => goTo(SETTINGS_PATH)}
                aria-current={pathname === SETTINGS_PATH ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  pathname === SETTINGS_PATH
                    ? 'bg-brand-600/15 text-brand-700 dark:text-brand-300'
                    : 'text-content-muted hover:bg-surface-overlay hover:text-content'
                }`}
              >
                <Settings size={18} />
                <span>{SETTINGS_LABEL}</span>
              </button>
            </div>
          )}
        </nav>

        <div className="border-t border-line p-4">
          <div className="mb-3">
            <p className="text-xs font-medium text-content-muted">Utilisateur</p>
            <p className="truncate text-sm text-content">{user?.email}</p>
            <p className="mt-1 truncate text-xs text-content-subtle">
              {user?.tenantName ?? 'Établissement courant'}
            </p>
            <span className="mt-1 inline-flex items-center gap-1 rounded border border-line bg-surface-raised px-2 py-0.5 text-xs font-semibold text-content-muted">
              {user?.role}
            </span>
            {user?.tenants && user.tenants.length > 1 && (
              <select
                aria-label="Changer d’établissement"
                value={user.tenantId ?? ''}
                disabled={switchingTenant}
                onChange={async (event) => {
                  const tenantId = event.target.value;
                  if (!tenantId || tenantId === user.tenantId) return;
                  setSwitchingTenant(true);
                  try {
                    await switchTenant(tenantId);
                    window.location.reload();
                  } catch {
                    setSwitchingTenant(false);
                  }
                }}
                className="mt-2 w-full rounded border border-line-strong bg-surface-raised px-2 py-1.5 text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {user.tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.role})
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-sm font-medium text-content-muted transition-colors hover:bg-surface-overlay hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <LogOut size={16} />
            Déconnexion
          </button>
        </div>
      </aside>
    </>
  );
}
