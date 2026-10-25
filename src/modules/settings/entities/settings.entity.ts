import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Taux de TVA paramétrable (multi-taux). */
export interface TaxRate {
  /** Identifiant stable côté client (ex. `standard`, `reduit`). */
  id: string;
  label: string;
  /** Taux en pourcentage (0 → 100). */
  rate: number;
}

/** Règles d'annulation / no-show appliquées aux réservations. */
export interface CancellationPolicy {
  /** Délai (heures) avant le rendez-vous pour une annulation sans frais. */
  freeCancellationHours: number;
  /** Frais appliqués en cas d'annulation tardive (% du montant). */
  lateCancellationFeePercent: number;
  /** Frais appliqués en cas de no-show (% du montant). */
  noShowFeePercent: number;
  /** Mentions libres affichées aux clients. */
  notes?: string;
}

/** Ligne unique de configuration de l'établissement. */
export const SETTINGS_ID = 'default';

export const DEFAULT_TAX_RATES: TaxRate[] = [
  { id: 'standard', label: 'TVA standard', rate: 20 },
  { id: 'reduit', label: 'TVA réduite', rate: 10 },
  { id: 'super-reduit', label: 'TVA super réduite', rate: 5.5 },
];

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  freeCancellationHours: 24,
  lateCancellationFeePercent: 50,
  noShowFeePercent: 100,
  notes: '',
};

export const DEFAULT_PRIMARY_COLOR = '#14b8a6';
export const DEFAULT_SECONDARY_COLOR = '#8b5cf6';

@Entity('settings')
export class Settings {
  /** Configuration singleton : une seule ligne `default`. */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  gymName: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  logoUrl: string | null;

  @Column({ type: 'varchar', length: 7, default: DEFAULT_PRIMARY_COLOR })
  primaryColor: string;

  @Column({ type: 'varchar', length: 7, default: DEFAULT_SECONDARY_COLOR })
  secondaryColor: string;

  /** Devise ISO 4217 (EUR, USD, GBP, MAD, TND, CHF...). */
  @Column({ type: 'varchar', length: 3, default: 'EUR' })
  currency: string;

  /** Locale BCP 47 simplifiée (fr, en, es, ar, fr-FR...). */
  @Column({ type: 'varchar', length: 8, default: 'fr' })
  locale: string;

  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  taxRates: TaxRate[];

  @Column({
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  cancellationPolicy: CancellationPolicy;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
