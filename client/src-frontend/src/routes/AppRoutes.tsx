import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Layout } from '@/components/layout/Layout';
import LoginPage from '@/components/auth/Login';
import DashboardPage from '@/components/dashboard/Dashboard';
import { LicenseGate } from '@/components/ui/LicenseGate';
import type { LicensedFeature } from '@/types';
import GymPage from '@/pages/GymPage';
import CarePage from '@/pages/CarePage';
import BookingPage from '@/pages/BookingPage';
import MaintenancePage from '@/pages/MaintenancePage';
import ShopPage from '@/pages/ShopPage';
import LoyaltyPage from '@/pages/LoyaltyPage';
import HealthyFoodPage from '@/pages/HealthyFoodPage';
import SettingsPage from '@/pages/SettingsPage';
import NotFoundPage from '@/pages/NotFound';
import { RoleGate } from '@/components/ui/RoleGate';
import { SETTINGS_ROLES } from '@/lib/roles';
import { APP_MODULES, SETTINGS_PATH } from './modules';

/** Composant associé à chaque module sous licence. */
const MODULE_PAGES: Record<LicensedFeature, React.ReactNode> = {
  gym: <GymPage />,
  care: <CarePage />,
  booking: <BookingPage />,
  maintenance: <MaintenancePage />,
  shop: <ShopPage />,
  loyalty: <LoyaltyPage />,
  healthy_food: <HealthyFoodPage />,
};

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        {APP_MODULES.map((module) => (
          <Route
            key={module.id}
            path={module.path}
            element={
              <LicenseGate feature={module.feature}>
                {MODULE_PAGES[module.feature]}
              </LicenseGate>
            }
          />
        ))}
        <Route
          path={SETTINGS_PATH}
          element={
            <RoleGate roles={SETTINGS_ROLES}>
              <SettingsPage />
            </RoleGate>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
