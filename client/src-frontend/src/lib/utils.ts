import axios from 'axios';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

/** Extrait un message lisible d'une erreur Axios ou native. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as
      | { message?: string | string[] }
      | undefined;

    if (Array.isArray(payload?.message)) {
      return payload.message.join(' ');
    }

    if (typeof payload?.message === 'string') {
      return payload.message;
    }

    return error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();
let activeCurrency = 'EUR';

/**
 * Définit la devise utilisée par `formatCurrency` (configuration whitelabel).
 * Les codes invalides sont ignorés.
 */
export function setActiveCurrency(currency: string): void {
  const normalized = currency?.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) {
    activeCurrency = normalized;
  }
}

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  const cached = currencyFormatters.get(currency);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    formatter = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 2,
    });
  }

  currencyFormatters.set(currency, formatter);
  return formatter;
}

/** Formate un montant dans la devise active (ex. 189.9 → « 189,90 € »). */
export function formatCurrency(value: number, currency = activeCurrency): string {
  const amount = Number(value);
  return getCurrencyFormatter(currency).format(
    Number.isFinite(amount) ? amount : 0,
  );
}

/** Formate une durée en minutes pour l'affichage (ex. 90 → « 1 h 30 »). */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '—';
  }

  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;

  if (hours === 0) {
    return `${rounded} min`;
  }

  return remainder === 0
    ? `${hours} h`
    : `${hours} h ${String(remainder).padStart(2, '0')}`;
}
