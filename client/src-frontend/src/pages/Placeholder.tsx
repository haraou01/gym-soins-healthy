import { Card } from '@/components/ui';

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-content">{title}</h1>
      <Card>
        <p className="text-content-muted">
          Contenu du module {title} en cours de développement.
        </p>
      </Card>
    </div>
  );
}
