import { lazy, Suspense } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Layout } from '@/components/layout/Layout';
import { LicenseGate } from '@/components/ui/LicenseGate';
import type { LicensedFeature } from '@/types';
import { RoleGate } from '@/components/ui/RoleGate';
import { SETTINGS_ROLES } from '@/lib/roles';
import { APP_MODULES, SETTINGS_PATH } from './modules';

const LoginPage = lazy(() => import('@/components/auth/Login'));
const DashboardPage = lazy(() => import('@/components/dashboard/Dashboard'));
const GymPage = lazy(() => import('@/pages/GymPage'));
const CarePage = lazy(() => import('@/pages/CarePage'));
const BookingPage = lazy(() => import('@/pages/BookingPage'));
const MaintenancePage = lazy(() => import('@/pages/MaintenancePage'));
const ShopPage = lazy(() => import('@/pages/ShopPage'));
const LoyaltyPage = lazy(() => import('@/pages/LoyaltyPage'));
const HealthyFoodPage = lazy(() => import('@/pages/HealthyFoodPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFound'));

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

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] items-center justify-center text-sm text-content-muted"
    >
      Chargement…
    </div>
  );
}

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
    <Suspense fallback={<RouteFallback />}>
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
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
