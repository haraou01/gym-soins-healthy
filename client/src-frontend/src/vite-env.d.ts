/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** Clé de licence active (optionnelle : peut aussi être stockée en localStorage). */
  readonly VITE_LICENSE_KEY?: string;
  /** Empreinte matérielle associée à la licence (optionnelle). */
  readonly VITE_HARDWARE_ID?: string;
  /**
   * Passer à `"true"` pour tester le filtrage par licence en développement.
   * Par défaut, tous les modules sont débloqués en local.
   */
  readonly VITE_LICENSE_ENFORCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
