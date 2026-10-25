import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { Button, Input, Card, Notice } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getApiErrorMessage } from '@/lib/utils';
import { Shield, User, Dumbbell, HeartPulse, ChefHat } from 'lucide-react';
import type { UserRole } from '@/types';

const ROLES: { value: UserRole; label: string; icon: React.ReactNode }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Administrateur', icon: <Shield size={20} /> },
  { value: 'RECEPTIONIST', label: 'Réceptionniste', icon: <User size={20} /> },
  { value: 'COACH', label: 'Coach', icon: <Dumbbell size={20} /> },
  { value: 'THERAPIST', label: 'Thérapeute', icon: <HeartPulse size={20} /> },
  { value: 'CHEF', label: 'Chef de cuisine', icon: <ChefHat size={20} /> },
];

export default function LoginPage() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('SUPER_ADMIN');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password, role);
      navigate('/dashboard');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Identifiants invalides'));
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

          <div className="space-y-2">
            <span className="text-sm font-medium text-content">Rôle RBAC</span>
            <div
              role="group"
              aria-label="Rôle RBAC"
              className="grid grid-cols-2 gap-2"
            >
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={role === r.value}
                  onClick={() => setRole(r.value)}
                  className={
                    role === r.value
                      ? 'flex flex-col items-center gap-1.5 rounded border border-brand-500 bg-brand-600/20 px-3 py-2 text-brand-700 dark:text-brand-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
                      : 'flex flex-col items-center gap-1.5 rounded border border-line-strong bg-surface-raised px-3 py-2 text-content-muted transition-colors hover:border-brand-500/40 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
                  }
                >
                  {r.icon}
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

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
