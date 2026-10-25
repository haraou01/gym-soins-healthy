import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false,
});

/**
 * Attache automatiquement le token JWT stocké dans localStorage à chaque requête.
 */
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('gymsoins_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Gestion globale des erreurs : redirige vers le login en cas de 401/403.
 *
 * Exception : les appels de licence (`/api/v1/license/*`) renvoient 401 quand la
 * licence est absente/invalide. Ils ne doivent PAS déconnecter l'utilisateur,
 * sinon le LicenseGate ne peut jamais afficher les modules verrouillés.
 */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isLicenseRequest = error.config?.url?.includes('/api/v1/license/') ?? false;

    if (
      !isLicenseRequest &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      localStorage.removeItem('gymsoins_token');
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
