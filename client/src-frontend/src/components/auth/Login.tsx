import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { Button, Input, Card, Notice } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getApiErrorMessage } from '@/lib/utils';
import { Building2, Shield } from 'lucide-react';
import type { TenantSummary } from '@/types';

export default function LoginPage() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password, selectedTenant || undefined);
      navigate('/dashboard');
    } catch (err) {
      const data = (
        err as {
          response?: {
            data?: {
              code?: string;
              tenants?: TenantSummary[];
            };
          };
        }
      )?.response?.data;

      if (data?.code === 'TENANT_SELECTION_REQUIRED' && data.tenants?.length) {
        setTenants(data.tenants);
        setSelectedTenant(data.tenants[0].id);
        setError('Plusieurs établissements sont disponibles. Sélectionnez-en un.');
      } else {
        setError(getApiErrorMessage(err, 'Identifiants invalides'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="relative flex h-dvh items-center justify-center overflow-y-auto bg-surface px-4 py-8"
      style={{
        backgroundImage:
          'radial-gradient(circle at 15% 15%, rgb(var(--brand-600) / 0.18), transparent 45%), radial-gradient(circle at 85% 85%, rgb(var(--accent-600) / 0.18), transparent 45%)',
      }}
    >
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={settings.gymName}
              className="mx-auto mb-3 h-12 w-12 rounded bg-surface-raised object-contain"
            />
          ) : (
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded bg-brand-600">
              <Shield size={24} className="text-white" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-content">Connexion</h1>
          <p className="text-sm text-content-muted">{settings.gymName}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="login-email"
              className="text-sm font-medium text-content"
            >
              Email
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="exemple@gym.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="login-password"
              className="text-sm font-medium text-content"
            >
              Mot de passe
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {tenants.length > 0 && (
            <div className="space-y-2">
              <label
                htmlFor="login-tenant"
                className="flex items-center gap-2 text-sm font-medium text-content"
              >
                <Building2 size={16} />
                Établissement
              </label>
              <select
                id="login-tenant"
                value={selectedTenant}
                onChange={(e) => setSelectedTenant(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <Notice tone="error">{error}</Notice>}

          <Button
            type="submit"
            variant="default"
            className="w-full"
            disabled={loading}
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-content-subtle">
          Version 1.0.0 &bull; Interface desktop via Tauri v2
        </p>
      </Card>
    </main>
  );
}
