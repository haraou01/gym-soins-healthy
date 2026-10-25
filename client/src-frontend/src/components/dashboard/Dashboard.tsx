import { useNavigate } from 'react-router-dom';
import { useLicense } from '@/hooks/useLicense';
import { Card, Badge } from '@/components/ui';
import { APP_MODULES } from '@/routes/modules';

export default function DashboardPage() {
  const { hasFeature, license, isLoading } = useLicense();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        Chargement de la licence...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-content">Tableau de bord</h1>
        <p className="text-content-muted">
          Vue d'ensemble des modules activés sous votre licence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {APP_MODULES.map((module) => {
          const active = hasFeature(module.feature);
          const Icon = module.icon;

          return (
            <Card
              key={module.id}
              className={`group transition-colors ${
                active
                  ? 'cursor-pointer hover:border-brand-500/50'
                  : 'opacity-70'
              }`}
              onClick={active ? () => navigate(module.path) : undefined}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded bg-surface-overlay flex items-center justify-center group-hover:bg-brand-600/20 transition-colors">
                  <Icon size={24} />
                </div>
                {active ? (
                  <Badge variant="success" className="text-[10px]">
                    Actif
                  </Badge>
                ) : (
                  <Badge variant="danger" className="text-[10px]">
                    Verrouillé
                  </Badge>
                )}
              </div>
              <h2 className="font-semibold text-content">{module.label}</h2>
              <p className="text-xs text-content-subtle mt-1">
                {active
                  ? 'Accès autorisé'
                  : `Licence requise: ${module.feature}`}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={!active}
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(module.path);
                  }}
                  className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-600 text-white hover:bg-brand-700'
                      : 'bg-surface-overlay text-content-subtle cursor-not-allowed border border-line-strong'
                  }`}
                >
                  {active ? 'Ouvrir' : 'Verrouillé'}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {license && (
        <Card className="max-w-md">
          <h2 className="font-semibold text-content mb-3">
            Détails de la licence
          </h2>
          <p className="text-sm text-content-muted">
            Modules actifs : {license.modules.join(', ')}
          </p>
        </Card>
      )}
    </div>
  );
}
