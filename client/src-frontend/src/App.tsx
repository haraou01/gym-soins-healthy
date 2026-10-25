import { LicenseProvider } from '@/hooks/useLicense';
import { AuthProvider } from '@/hooks/useAuth';
import { SettingsProvider } from '@/hooks/useSettings';
import { ThemeProvider } from '@/hooks/useTheme';
import { DensityProvider } from '@/hooks/useDensity';
import AppRoutes from '@/routes/AppRoutes';

export function AppWithProviders() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <DensityProvider>
          <AuthProvider>
            <LicenseProvider>
              <AppRoutes />
            </LicenseProvider>
          </AuthProvider>
        </DensityProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

export default AppWithProviders;
