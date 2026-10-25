import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarX2,
  Eye,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Plus,
  Receipt,
  RotateCcw,
  Rows3,
  Rows4,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import { settingsAPI } from '@/api';
import {
  Badge,
  Button,
  Card,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { useDensity, type Density } from '@/hooks/useDensity';
import { useSettings } from '@/hooks/useSettings';
import { useTheme, type ThemePreference } from '@/hooks/useTheme';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  buildColorScale,
  readableTextColor,
} from '@/lib/theme';
import { cn, formatCurrency, getApiErrorMessage } from '@/lib/utils';
import type { AppSettings, TaxRateInput } from '@/types';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const CURRENCIES = [
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'USD', label: 'Dollar américain (USD)' },
  { value: 'GBP', label: 'Livre sterling (GBP)' },
  { value: 'CHF', label: 'Franc suisse (CHF)' },
  { value: 'MAD', label: 'Dirham marocain (MAD)' },
  { value: 'TND', label: 'Dinar tunisien (TND)' },
  { value: 'CAD', label: 'Dollar canadien (CAD)' },
];

const LOCALES = [
  { value: 'fr', label: 'Français (fr)' },
  { value: 'en', label: 'English (en)' },
  { value: 'es', label: 'Español (es)' },
  { value: 'ar', label: 'العربية (ar)' },
  { value: 'fr-FR', label: 'Français — France (fr-FR)' },
  { value: 'en-US', label: 'English — United States (en-US)' },
];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
];

const DENSITY_OPTIONS: Array<{
  value: Density;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    value: 'comfortable',
    label: 'Confortable',
    hint: 'Espacements généreux',
    icon: Rows3,
  },
  {
    value: 'compact',
    label: 'Compact',
    hint: 'Plus de lignes visibles',
    icon: Rows4,
  },
];

interface SettingsForm {
  gymName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  currency: string;
  locale: string;
  taxRates: TaxRateInput[];
  freeCancellationHours: string;
  lateCancellationFeePercent: string;
  noShowFeePercent: string;
  notes: string;
}

function newRateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `rate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toForm(settings: AppSettings): SettingsForm {
  return {
    gymName: settings.gymName,
    logoUrl: settings.logoUrl ?? '',
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    currency: settings.currency,
    locale: settings.locale,
    taxRates: settings.taxRates.map((rate) => ({
      id: rate.id,
      label: rate.label,
      rate: rate.rate,
    })),
    freeCancellationHours: String(
      settings.cancellationPolicy.freeCancellationHours,
    ),
    lateCancellationFeePercent: String(
      settings.cancellationPolicy.lateCancellationFeePercent,
    ),
    noShowFeePercent: String(settings.cancellationPolicy.noShowFeePercent),
    notes: settings.cancellationPolicy.notes ?? '',
  };
}

function validate(form: SettingsForm): string | null {
  if (!form.gymName.trim()) {
    return 'Le nom de l’établissement est obligatoire.';
  }

  if (!HEX_COLOR.test(form.primaryColor)) {
    return 'La couleur primaire doit être au format hexadécimal (#RRGGBB).';
  }

  if (!HEX_COLOR.test(form.secondaryColor)) {
    return 'La couleur secondaire doit être au format hexadécimal (#RRGGBB).';
  }

  const labels = new Set<string>();
  for (const rate of form.taxRates) {
    const label = rate.label.trim();
    if (!label) {
      return 'Chaque taux de TVA doit avoir un libellé.';
    }
    if (labels.has(label.toLowerCase())) {
      return `Le taux de TVA « ${label} » est présent plusieurs fois.`;
    }
    labels.add(label.toLowerCase());

    if (!Number.isFinite(rate.rate) || rate.rate < 0 || rate.rate > 100) {
      return `Le taux « ${label} » doit être compris entre 0 et 100.`;
    }
  }

  const hours = Number(form.freeCancellationHours);
  if (!Number.isInteger(hours) || hours < 0 || hours > 8760) {
    return 'Le délai d’annulation gratuite doit être un nombre entier d’heures (0 à 8760).';
  }

  const lateFee = Number(form.lateCancellationFeePercent);
  if (!Number.isFinite(lateFee) || lateFee < 0 || lateFee > 100) {
    return 'Les frais d’annulation tardive doivent être compris entre 0 et 100 %.';
  }

  const noShowFee = Number(form.noShowFeePercent);
  if (!Number.isFinite(noShowFee) || noShowFee < 0 || noShowFee > 100) {
    return 'Les frais de no-show doivent être compris entre 0 et 100 %.';
  }

  return null;
}

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-300">
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-semibold text-content">{title}</h2>
        <p className="text-xs text-content-subtle">{description}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { save } = useSettings();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();

  const [form, setForm] = useState<SettingsForm | null>(null);
  const [snapshot, setSnapshot] = useState<SettingsForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await settingsAPI.get();
        if (!active) return;
        const next = toForm(data);
        setForm(next);
        setSnapshot(next);
      } catch (err) {
        if (active) {
          setError(
            getApiErrorMessage(
              err,
              'Impossible de charger la configuration de l’établissement.',
            ),
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const previewPrimary =
    form && HEX_COLOR.test(form.primaryColor)
      ? form.primaryColor
      : DEFAULT_PRIMARY_COLOR;
  const previewSecondary =
    form && HEX_COLOR.test(form.secondaryColor)
      ? form.secondaryColor
      : DEFAULT_SECONDARY_COLOR;
  const previewPrimaryText = buildColorScale(previewPrimary, resolvedTheme)[
    resolvedTheme === 'dark' ? '300' : '700'
  ];

  const currencyOptions = useMemo(() => {
    if (!form) return CURRENCIES;
    return CURRENCIES.some((option) => option.value === form.currency)
      ? CURRENCIES
      : [{ value: form.currency, label: form.currency }, ...CURRENCIES];
  }, [form]);

  const localeOptions = useMemo(() => {
    if (!form) return LOCALES;
    return LOCALES.some((option) => option.value === form.locale)
      ? LOCALES
      : [{ value: form.locale, label: form.locale }, ...LOCALES];
  }, [form]);

  function update<K extends keyof SettingsForm>(
    key: K,
    value: SettingsForm[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSuccess('');
  }

  function updateTaxRate(index: number, patch: Partial<TaxRateInput>) {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        taxRates: current.taxRates.map((rate, i) =>
          i === index ? { ...rate, ...patch } : rate,
        ),
      };
    });
    setSuccess('');
  }

  function addTaxRate() {
    setForm((current) =>
      current
        ? {
            ...current,
            taxRates: [
              ...current.taxRates,
              { id: newRateId(), label: '', rate: 20 },
            ],
          }
        : current,
    );
    setSuccess('');
  }

  function removeTaxRate(index: number) {
    setForm((current) =>
      current
        ? {
            ...current,
            taxRates: current.taxRates.filter((_, i) => i !== index),
          }
        : current,
    );
    setSuccess('');
  }

  function reset() {
    if (snapshot) setForm(snapshot);
    setError('');
    setSuccess('');
    setLogoBroken(false);
  }

  async function handleSave() {
    if (!form) return;

    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      setSuccess('');
      return;
    }

    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      const data = await save({
        gymName: form.gymName.trim(),
        logoUrl: form.logoUrl.trim(),
        primaryColor: form.primaryColor.toLowerCase(),
        secondaryColor: form.secondaryColor.toLowerCase(),
        currency: form.currency,
        locale: form.locale,
        taxRates: form.taxRates.map((rate) => ({
          id: rate.id,
          label: rate.label.trim(),
          rate: Number(rate.rate),
        })),
        cancellationPolicy: {
          freeCancellationHours: Number(form.freeCancellationHours),
          lateCancellationFeePercent: Number(
            form.lateCancellationFeePercent,
          ),
          noShowFeePercent: Number(form.noShowFeePercent),
          notes: form.notes.trim(),
        },
      });

      const next = toForm(data);
      setForm(next);
      setSnapshot(next);
      setLogoBroken(false);
      setSuccess(
        'Configuration enregistrée : le nom, le thème et la devise sont appliqués à l’interface.',
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          'Impossible d’enregistrer la configuration. Vérifiez vos droits.',
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-3 py-16 text-sm text-content-muted">
        <Loader2 size={18} className="animate-spin" />
        Chargement de la configuration…
      </Card>
    );
  }

  if (!form) {
    return (
      <div className="space-y-4">
        <Notice tone="error">
          {error || 'Configuration indisponible.'}
        </Notice>
        <Button
          variant="outline"
          icon={<RotateCcw size={16} />}
          onClick={() => window.location.reload()}
        >
          Réessayer
        </Button>
      </div>
    );
  }

  const previewLogo = form.logoUrl.trim() && !logoBroken;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-content">
              Configuration &amp; Whitelabel
            </h1>
            <Badge variant="success">
              <ShieldCheck size={12} className="mr-1" />
              Administrateur
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-content-muted">
            Personnalisez l’identité de l’établissement, le thème, la devise,
            la locale, les taux de TVA et les règles d’annulation. Les
            modifications sont appliquées immédiatement après enregistrement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={<RotateCcw size={16} />}
            onClick={reset}
            disabled={isSaving}
          >
            Réinitialiser
          </Button>
          <Button
            icon={
              isSaving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )
            }
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <SectionHeader
              icon={<Palette size={18} />}
              title="Apparence & ergonomie"
              description="Préférences locales de ce poste : thème et densité d’affichage. Elles s’appliquent immédiatement, sans enregistrement serveur."
            />

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-content">Thème</p>
                <div
                  role="group"
                  aria-label="Thème de l’interface"
                  className="grid grid-cols-3 gap-2"
                >
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                    const active = theme === value;

                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTheme(value)}
                        aria-pressed={active}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                          active
                            ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                            : 'border-line-strong bg-surface-raised text-content-muted hover:border-brand-500/40 hover:text-content',
                        )}
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-content-subtle">
                  « Système » suit automatiquement la préférence de votre
                  système d’exploitation.
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-content">Densité</p>
                <div
                  role="group"
                  aria-label="Densité d’affichage"
                  className="grid grid-cols-2 gap-2"
                >
                  {DENSITY_OPTIONS.map(
                    ({ value, label, hint, icon: Icon }) => {
                      const active = density === value;

                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDensity(value)}
                          aria-pressed={active}
                          className={cn(
                            'flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                            active
                              ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                              : 'border-line-strong bg-surface-raised text-content-muted hover:border-brand-500/40 hover:text-content',
                          )}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Icon size={16} />
                            {label}
                          </span>
                          <span className="text-[11px] text-content-subtle">
                            {hint}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
                <p className="mt-2 text-xs text-content-subtle">
                  Le mode compact resserre les tableaux, le POS, le KDS et le
                  planning. Les zones tactiles restent agrandies sur tablette.
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader
              icon={<Building2 size={18} />}
              title="Identité de l’établissement"
              description="Nom et logo affichés dans la navigation, le tableau de bord et l’écran de connexion."
            />

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="settings-gym-name"
                  className="text-sm font-medium text-content"
                >
                  Nom de l’établissement
                </label>
                <Input
                  id="settings-gym-name"
                  value={form.gymName}
                  maxLength={120}
                  onChange={(event) => update('gymName', event.target.value)}
                  placeholder="Ex. Atlas Fitness Club"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="settings-logo-url"
                  className="text-sm font-medium text-content"
                >
                  URL du logo
                </label>
                <Input
                  id="settings-logo-url"
                  value={form.logoUrl}
                  maxLength={2048}
                  onChange={(event) => {
                    update('logoUrl', event.target.value);
                    setLogoBroken(false);
                  }}
                  placeholder="https://exemple.com/logo.png"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-md border border-line bg-surface-raised/40 p-3">
              {previewLogo ? (
                <img
                  src={form.logoUrl.trim()}
                  alt="Aperçu du logo"
                  className="h-12 w-12 rounded bg-card object-contain"
                  onError={() => setLogoBroken(true)}
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded bg-brand-600 text-white">
                  <ImageIcon size={20} />
                </div>
              )}
              <div className="text-xs text-content-muted">
                Aperçu du logo
                <div className="text-content-subtle">
                  PNG, SVG ou JPG — URL publique (HTTPS recommandé).
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader
              icon={<Palette size={18} />}
              title="Thème"
              description="Les couleurs sont converties en variables CSS et appliquées à toute l’interface."
            />

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="settings-primary-color"
                  className="text-sm font-medium text-content"
                >
                  Couleur primaire
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Sélecteur de couleur primaire"
                    value={previewPrimary}
                    onChange={(event) =>
                      update('primaryColor', event.target.value)
                    }
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line-strong bg-card p-1"
                  />
                  <Input
                    id="settings-primary-color"
                    value={form.primaryColor}
                    maxLength={7}
                    onChange={(event) =>
                      update('primaryColor', event.target.value)
                    }
                    className="font-mono uppercase"
                    placeholder="#14B8A6"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="settings-secondary-color"
                  className="text-sm font-medium text-content"
                >
                  Couleur secondaire
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Sélecteur de couleur secondaire"
                    value={previewSecondary}
                    onChange={(event) =>
                      update('secondaryColor', event.target.value)
                    }
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-line-strong bg-card p-1"
                  />
                  <Input
                    id="settings-secondary-color"
                    value={form.secondaryColor}
                    maxLength={7}
                    onChange={(event) =>
                      update('secondaryColor', event.target.value)
                    }
                    className="font-mono uppercase"
                    placeholder="#8B5CF6"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader
              icon={<Globe2 size={18} />}
              title="Devise & locale"
              description="Devise de référence utilisée pour les montants et langue déclarée du document."
            />

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="settings-currency"
                  className="text-sm font-medium text-content"
                >
                  Devise
                </label>
                <Select
                  id="settings-currency"
                  value={form.currency}
                  onChange={(event) => update('currency', event.target.value)}
                >
                  {currencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="settings-locale"
                  className="text-sm font-medium text-content"
                >
                  Locale
                </label>
                <Select
                  id="settings-locale"
                  value={form.locale}
                  onChange={(event) => update('locale', event.target.value)}
                >
                  {localeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <p className="mt-3 text-xs text-content-subtle">
              La devise est utilisée pour l’affichage des prix et des
              statistiques. La locale définit la langue du document
              (<code className="text-content-muted">lang</code>) et prépare
              l’internationalisation de l’interface.
            </p>
          </Card>

          <Card>
            <SectionHeader
              icon={<Receipt size={18} />}
              title="Taux de TVA"
              description="Multi-taux appliqués aux prestations, abonnements et ventes boutique."
            />

            <div className="mt-5 space-y-3">
              {form.taxRates.length === 0 && (
                <p className="rounded-md border border-dashed border-line-strong p-4 text-center text-xs text-content-subtle">
                  Aucun taux configuré. Ajoutez au moins un taux si votre
                  activité est assujettie à la TVA.
                </p>
              )}

              {form.taxRates.map((rate, index) => (
                <div
                  key={rate.id ?? `rate-${index}`}
                  className="flex flex-wrap items-end gap-2"
                >
                  <div className="min-w-[180px] flex-1 space-y-1">
                    <label
                      htmlFor={`tax-label-${index}`}
                      className="text-xs font-medium text-content-muted"
                    >
                      Libellé
                    </label>
                    <Input
                      id={`tax-label-${index}`}
                      value={rate.label}
                      maxLength={60}
                      onChange={(event) =>
                        updateTaxRate(index, { label: event.target.value })
                      }
                      placeholder="TVA standard"
                    />
                  </div>

                  <div className="w-28 space-y-1">
                    <label
                      htmlFor={`tax-rate-${index}`}
                      className="text-xs font-medium text-content-muted"
                    >
                      Taux (%)
                    </label>
                    <Input
                      id={`tax-rate-${index}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={rate.rate}
                      onChange={(event) =>
                        updateTaxRate(index, {
                          rate: Number(event.target.value),
                        })
                      }
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Supprimer le taux ${rate.label || index + 1}`}
                    onClick={() => removeTaxRate(index)}
                    className="mb-0.5 text-red-800 hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                icon={<Plus size={16} />}
                onClick={addTaxRate}
              >
                Ajouter un taux
              </Button>
            </div>
          </Card>

          <Card>
            <SectionHeader
              icon={<CalendarX2 size={18} />}
              title="Politique d’annulation"
              description="Règles de no-show et frais appliqués aux réservations tardives."
            />

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label
                  htmlFor="settings-free-hours"
                  className="text-sm font-medium text-content"
                >
                  Annulation gratuite (h)
                </label>
                <Input
                  id="settings-free-hours"
                  type="number"
                  min={0}
                  max={8760}
                  step={1}
                  value={form.freeCancellationHours}
                  onChange={(event) =>
                    update('freeCancellationHours', event.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="settings-late-fee"
                  className="text-sm font-medium text-content"
                >
                  Frais annulation tardive (%)
                </label>
                <Input
                  id="settings-late-fee"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.lateCancellationFeePercent}
                  onChange={(event) =>
                    update('lateCancellationFeePercent', event.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="settings-noshow-fee"
                  className="text-sm font-medium text-content"
                >
                  Frais no-show (%)
                </label>
                <Input
                  id="settings-noshow-fee"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.noShowFeePercent}
                  onChange={(event) =>
                    update('noShowFeePercent', event.target.value)
                  }
                />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label
                htmlFor="settings-notes"
                className="text-sm font-medium text-content"
              >
                Mentions affichées aux clients
              </label>
              <Textarea
                id="settings-notes"
                value={form.notes}
                maxLength={500}
                rows={3}
                onChange={(event) => update('notes', event.target.value)}
                placeholder="Ex. Annulation gratuite jusqu’à 24 h avant le rendez-vous."
              />
              <p className="text-right text-xs text-content-subtle">
                {form.notes.length}/500
              </p>
            </div>
          </Card>
        </div>

        <div>
          <Card className="xl:sticky xl:top-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-content">
                <Eye size={16} className="text-brand-700 dark:text-brand-400" />
                Aperçu en direct
              </h2>
              <Badge>Whitelabel</Badge>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <div
                className="p-4"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${previewPrimary}, ${previewSecondary})`,
                }}
              >
                <div className="flex items-center gap-3 rounded-lg bg-black/60 px-3 py-2">
                  {previewLogo ? (
                    <img
                      src={form.logoUrl.trim()}
                      alt=""
                      className="h-10 w-10 rounded bg-black/30 object-contain"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-black/30 text-sm font-bold text-white">
                      {(form.gymName.trim() || 'G').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">
                      {form.gymName.trim() || 'Nom de l’établissement'}
                    </p>
                    <p className="text-xs text-white">
                      Tableau de bord • {form.currency} • {form.locale}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 bg-card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-content-muted">Abonnement mensuel</span>
                  <span
                    className="font-semibold"
                    style={{ color: previewPrimaryText }}
                  >
                    {formatCurrency(49.9, form.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-content-muted">Séance coaching</span>
                  <span className="font-semibold text-content">
                    {formatCurrency(35, form.currency)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: previewPrimary,
                      color: readableTextColor(previewPrimary),
                    }}
                  >
                    Primaire
                  </span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: previewSecondary,
                      color: readableTextColor(previewSecondary),
                    }}
                  >
                    Secondaire
                  </span>
                </div>
              </div>
            </div>

            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-content-subtle">TVA</dt>
                <dd className="text-right text-content">
                  {form.taxRates.length === 0
                    ? '—'
                    : form.taxRates
                        .map((rate) => `${rate.rate}%`)
                        .join(' • ')}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-content-subtle">Annulation gratuite</dt>
                <dd className="text-content">
                  {form.freeCancellationHours || '0'} h
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-content-subtle">Annulation tardive</dt>
                <dd className="text-content">
                  {form.lateCancellationFeePercent || '0'} %
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-content-subtle">No-show</dt>
                <dd className="text-content">
                  {form.noShowFeePercent || '0'} %
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-md border border-line bg-surface-raised/40 p-3 text-xs text-content-subtle">
              L’aperçu est mis à jour en direct. Le thème global n’est
              appliqué qu’après enregistrement.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
