import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-content-muted">
      <Card className="p-8 text-center">
        <h1 className="text-4xl font-bold mb-2">404</h1>
        <p className="mb-4">Page introuvable</p>
        <Link
          to="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Retour au tableau de bord
        </Link>
      </Card>
    </div>
  );
}
