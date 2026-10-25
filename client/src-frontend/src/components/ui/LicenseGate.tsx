import { useLicense } from '@/hooks/useLicense';
import { Card } from '@/components/ui';
import type { LicensedFeature } from '@/types';
import { Lock } from 'lucide-react';

interface LicenseGateProps {
  feature: LicensedFeature;
  children: React.ReactNode;
}

export function LicenseGate({ feature, children }: LicenseGateProps) {
  const { hasFeature, isLoading } = useLicense();

  if (isLoading) {
    return null;
  }

  if (!hasFeature(feature)) {
    return (
      <Card className="flex flex-col items-center justify-center py-20 text-content-subtle border-dashed">
        <Lock size={48} className="mb-4 opacity-50" />
        <h3 className="font-semibold text-content">Module verrouillé</h3>
        <p className="text-sm text-content-muted mt-2">
          Votre licence ne permet pas d'accéder au module « {feature} ».
        </p>
      </Card>
    );
  }

  return <>{children}</>;
}
