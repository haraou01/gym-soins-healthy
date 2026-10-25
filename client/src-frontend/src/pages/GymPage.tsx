import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  DoorOpen,
  Fingerprint,
  Contact,
  Info,
  KeyRound,
  LogIn,
  LogOut,
  PauseCircle,
  PlayCircle,
  QrCode,
  RefreshCw,
  Search,
  Timer,
  Ticket,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';

import { Badge, Button, Card, Input, Notice, StatCard } from '@/components/ui';
import { gymAPI } from '@/api';
import { getApiErrorMessage } from '@/lib/utils';
import type {
  AccessLog,
  AccessMethod,
  CheckInResult,
  Subscription,
  SubscriptionStatus,
  SubscriptionType,
} from '@/types';

type GymTab = 'subscriptions' | 'access' | 'passes';
type StatusFilter = 'ALL' | SubscriptionStatus;
type TypeFilter = 'ALL' | SubscriptionType;

interface SubscriptionFormState {
  clientId: string;
  type: SubscriptionType;
  startDate: string;
  endDate: string;
  remainingSessions: string;
}

const SUBSCRIPTION_TYPE_META: Record<
  SubscriptionType,
  { label: string; short: string; classes: string; icon: ReactNode }
> = {
  PASS_JOURNALIER: {
    label: 'Pass journalier',
    short: 'Journée',
    classes: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    icon: <Ticket size={16} />,
  },
  MENSUEL: {
    label: 'Abonnement mensuel',
    short: 'Mensuel',
    classes: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300',
    icon: <CalendarDays size={16} />,
  },
  ANNUEL: {
    label: 'Abonnement annuel',
    short: 'Annuel',
    classes: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
    icon: <BadgeCheck size={16} />,
  },
  CARNET_SEANCES: {
    label: 'Carnet de séances',
    short: 'Carnet',
    classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: <CreditCard size={16} />,
  },
};

const SUBSCRIPTION_STATUS_META: Record<
  SubscriptionStatus,
  { label: string; variant: 'success' | 'warning' | 'danger'; icon: ReactNode }
> = {
  ACTIF: {
    label: 'Actif',
    variant: 'success',
    icon: <CheckCircle2 size={13} />,
  },
  SUSPENDU: {
    label: 'Suspendu',
    variant: 'warning',
    icon: <PauseCircle size={13} />,
  },
  EXPIRE: {
    label: 'Expiré',
    variant: 'danger',
    icon: <XCircle size={13} />,
  },
};

const ACCESS_METHOD_META: Record<
  AccessMethod,
  { label: string; icon: ReactNode }
> = {
  RFID: { label: 'Badge RFID', icon: <CreditCard size={15} /> },
  QR_CODE: { label: 'QR Code', icon: <QrCode size={15} /> },
  BIOMETRIE: { label: 'Biométrie', icon: <Fingerprint size={15} /> },
  MANUEL: { label: 'Manuel', icon: <KeyRound size={15} /> },
};

const TABS: { id: GymTab; label: string; icon: ReactNode }[] = [
  { id: 'subscriptions', label: 'Abonnements', icon: <Contact size={16} /> },
  { id: 'access', label: 'Contrôle d’accès', icon: <DoorOpen size={16} /> },
  { id: 'passes', label: 'Cartes & Carnets', icon: <Ticket size={16} /> },
];

const SELECT_CLASSES =
  'h-10 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function defaultEndDate(type: SubscriptionType, start: Date): Date {
  switch (type) {
    case 'PASS_JOURNALIER':
      return start;
    case 'ANNUEL':
      return addDays(start, 365);
    case 'CARNET_SEANCES':
      return addDays(start, 180);
    case 'MENSUEL':
    default:
      return addDays(start, 30);
  }
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

/** Nombre de jours restants avant l'échéance (négatif si dépassée). */
function daysUntil(value: string): number {
  const end = new Date(value).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.ceil((end - Date.now()) / DAY_MS);
}

function isSameDay(value: string, reference: Date): boolean {
  const date = new Date(value);
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function createSubscriptionForm(): SubscriptionFormState {
  const today = new Date();
  return {
    clientId: '',
    type: 'MENSUEL',
    startDate: toDateInput(today),
    endDate: toDateInput(addDays(today, 30)),
    remainingSessions: '10',
  };
}

export default function GymPage() {
  const [activeTab, setActiveTab] = useState<GymTab>('subscriptions');

  /* --------------------------- Données globales -------------------------- */
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [subsRes, logsRes] = await Promise.all([
        gymAPI.getSubscriptions(),
        gymAPI.getAccessLogs(60),
      ]);
      setSubscriptions(subsRes.data);
      setAccessLogs(logsRes.data);
    } catch (error) {
      setLoadError(
        getApiErrorMessage(error, 'Impossible de charger les données de la salle.'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const activeSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.status === 'ACTIF'),
    [subscriptions],
  );
  const expiringSoon = useMemo(
    () =>
      activeSubscriptions
        .filter((s) => {
          const days = daysUntil(s.endDate);
          return days >= 0 && days <= 7;
        })
        .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate)),
    [activeSubscriptions],
  );
  const carnets = useMemo(
    () => subscriptions.filter((s) => s.type === 'CARNET_SEANCES'),
    [subscriptions],
  );
  const todayEntries = useMemo(() => {
    const today = new Date();
    return accessLogs.filter(
      (log) =>
        log.direction === 'ENTREE' &&
        log.granted &&
        isSameDay(log.timestamp, today),
    );
  }, [accessLogs]);

  const knownClientIds = useMemo(
    () => [...new Set(subscriptions.map((s) => s.clientId))].sort(),
    [subscriptions],
  );

  /* ----------------------------- Abonnements ---------------------------- */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [form, setForm] = useState<SubscriptionFormState>(createSubscriptionForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const filteredSubscriptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return subscriptions.filter((s) => {
      const matchesSearch = !term || s.clientId.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
      const matchesType = typeFilter === 'ALL' || s.type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [subscriptions, search, statusFilter, typeFilter]);

  const updateForm = (patch: Partial<SubscriptionFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setFormError(null);
    setFormSuccess(null);
  };

  const handleTypeChange = (type: SubscriptionType) => {
    const start = form.startDate ? parseDateOnly(form.startDate) : new Date();
    updateForm({
      type,
      endDate: toDateInput(defaultEndDate(type, start)),
    });
  };

  const handleStartChange = (startDate: string) => {
    const start = startDate ? parseDateOnly(startDate) : new Date();
    updateForm({
      startDate,
      endDate: toDateInput(defaultEndDate(form.type, start)),
    });
  };

  const handleCreateSubscription = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const clientId = form.clientId.trim();
    if (!clientId) {
      setFormError('Veuillez renseigner l’identifiant du client.');
      return;
    }
    if (!form.startDate || !form.endDate) {
      setFormError('Veuillez renseigner les dates de début et de fin.');
      return;
    }

    const start = parseDateOnly(form.startDate);
    const end = parseDateOnly(form.endDate);
    end.setHours(23, 59, 59, 999);

    if (end.getTime() < start.getTime()) {
      setFormError('La date de fin doit être postérieure à la date de début.');
      return;
    }

    const sessions = Number(form.remainingSessions);
    if (form.type === 'CARNET_SEANCES' && (!Number.isInteger(sessions) || sessions < 1)) {
      setFormError('Un carnet doit comporter au moins une séance.');
      return;
    }

    setSaving(true);
    try {
      const { data } = await gymAPI.createSubscription({
        clientId,
        type: form.type,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        remainingSessions:
          form.type === 'CARNET_SEANCES' ? sessions : 0,
      });
      setSubscriptions((prev) => [data, ...prev]);
      setForm(createSubscriptionForm());
      setFormSuccess(`Abonnement ${SUBSCRIPTION_TYPE_META[data.type].short} créé pour ${data.clientId}.`);
    } catch (error) {
      setFormError(
        getApiErrorMessage(error, 'Impossible de créer cet abonnement.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    subscription: Subscription,
    status: SubscriptionStatus,
  ) => {
    setStatusSavingId(subscription.id);
    setActionError(null);
    setActionSuccess(null);
    try {
      const { data } = await gymAPI.updateSubscription(subscription.id, status);
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === data.id ? data : s)),
      );
      const labels: Record<SubscriptionStatus, string> = {
        ACTIF: 'réactivé',
        SUSPENDU: 'suspendu',
        EXPIRE: 'clôturé',
      };
      setActionSuccess(`L’abonnement de ${data.clientId} a été ${labels[status]}.`);
    } catch (error) {
      setActionError(
        getApiErrorMessage(error, 'Impossible de modifier cet abonnement.'),
      );
    } finally {
      setStatusSavingId(null);
    }
  };

  const prefillRenewal = (subscription: Subscription) => {
    const today = new Date();
    setForm({
      clientId: subscription.clientId,
      type: subscription.type,
      startDate: toDateInput(today),
      endDate: toDateInput(defaultEndDate(subscription.type, today)),
      remainingSessions: String(
        subscription.type === 'CARNET_SEANCES'
          ? subscription.remainingSessions || 10
          : 0,
      ),
    });
    setFormError(null);
    setFormSuccess(null);
    setActiveTab('subscriptions');
  };

  /* --------------------------- Contrôle d'accès ------------------------- */
  const [accessClientId, setAccessClientId] = useState('');
  const [accessMethod, setAccessMethod] = useState<AccessMethod>('RFID');
  const [accessLoading, setAccessLoading] = useState<'in' | 'out' | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<CheckInResult | null>(null);
  const [accessContext, setAccessContext] = useState<'in' | 'out'>('in');

  const runAccess = async (direction: 'in' | 'out') => {
    const clientId = accessClientId.trim();
    if (!clientId) {
      setAccessError('Veuillez renseigner l’identifiant du client.');
      return;
    }

    setAccessLoading(direction);
    setAccessError(null);
    setAccessResult(null);
    setAccessContext(direction);
    try {
      const payload = { clientId, method: accessMethod };
      const { data } =
        direction === 'in'
          ? await gymAPI.checkIn(payload)
          : await gymAPI.checkOut(payload);
      // `granted: false` est une réponse métier valide (refus journalisé),
      // pas une erreur HTTP : on affiche le résultat sans bloquer l'interface.
      setAccessResult(data);
      // Rafraîchissement des logs en arrière-plan : les boutons Entrée/Sortie
      // redeviennent disponibles immédiatement, même après un refus.
      void fetchAll();
    } catch (error) {
      setAccessError(
        getApiErrorMessage(error, 'Le contrôle d’accès a échoué.'),
      );
    } finally {
      setAccessLoading(null);
    }
  };

  /* ----------------------------- Cartes/Carnets ------------------------- */
  const [passSearch, setPassSearch] = useState('');

  const filteredCarnets = useMemo(() => {
    const term = passSearch.trim().toLowerCase();
    return carnets.filter(
      (s) => !term || s.clientId.toLowerCase().includes(term),
    );
  }, [carnets, passSearch]);

  const statusCounts = useMemo(
    () => ({
      ALL: subscriptions.length,
      ACTIF: activeSubscriptions.length,
      SUSPENDU: subscriptions.filter((s) => s.status === 'SUSPENDU').length,
      EXPIRE: subscriptions.filter((s) => s.status === 'EXPIRE').length,
    }),
    [subscriptions, activeSubscriptions],
  );

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-purple-500/20 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content sm:text-3xl">
              Gestion Salle de Sport
            </h1>
            <p className="text-sm text-content-muted">
              Abonnements, tourniquet et carnets de séances.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchAll()}
          disabled={loading}
          icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />}
        >
          Actualiser
        </Button>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-dense>
        <StatCard
          label="Abonnements actifs"
          value={activeSubscriptions.length}
          hint={`${subscriptions.length} au total`}
          icon={<Users size={22} />}
          tone="brand"
        />
        <StatCard
          label="Entrées du jour"
          value={todayEntries.length}
          hint="passages validés"
          icon={<LogIn size={22} />}
          tone="emerald"
        />
        <StatCard
          label="Carnets"
          value={carnets.length}
          hint={`${carnets.filter((s) => s.status === 'ACTIF' && s.remainingSessions > 0).length} encore crédités`}
          icon={<CreditCard size={22} />}
          tone="purple"
        />
        <StatCard
          label="Échéances 7 j"
          value={expiringSoon.length}
          hint="à relancer"
          icon={<Timer size={22} />}
          tone={expiringSoon.length > 0 ? 'amber' : 'blue'}
        />
      </div>

      {loadError && <Notice tone="error">{loadError}</Notice>}

      {/* Onglets */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-400'
                : 'border-transparent text-content-muted hover:bg-surface-overlay/50 hover:text-content'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'subscriptions' && subscriptions.length > 0 && (
              <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content-muted">
                {subscriptions.length}
              </span>
            )}
            {tab.id === 'passes' && carnets.length > 0 && (
              <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content-muted">
                {carnets.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ========================== ABONNEMENTS ========================== */}
      {activeTab === 'subscriptions' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-8">
            <Card>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                    size={16}
                  />
                  <Input
                    aria-label="Rechercher un abonnement par identifiant client"
                    className="pl-9"
                    placeholder="Rechercher un identifiant client..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filtrer les abonnements par formule"
                  className={`${SELECT_CLASSES} lg:w-52`}
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                >
                  <option value="ALL">Tous les types</option>
                  {Object.entries(SUBSCRIPTION_TYPE_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-5 flex flex-wrap gap-1">
                {(['ALL', 'ACTIF', 'SUSPENDU', 'EXPIRE'] as StatusFilter[]).map(
                  (status) => {
                    const selected = statusFilter === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStatusFilter(status)}
                        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'bg-surface-overlay text-content ring-1 ring-line-strong'
                            : 'text-content-subtle hover:bg-surface-raised hover:text-content'
                        }`}
                      >
                        {status === 'ALL'
                          ? 'Tous'
                          : SUBSCRIPTION_STATUS_META[status].label}
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                            selected
                              ? 'bg-surface-strong text-content'
                              : 'bg-surface-raised text-content-subtle'
                          }`}
                        >
                          {statusCounts[status]}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>

              {actionError && (
                <Notice tone="error" className="mb-4">
                  {actionError}
                </Notice>
              )}
              {actionSuccess && (
                <Notice tone="success" className="mb-4">
                  {actionSuccess}
                </Notice>
              )}

              {loading && subscriptions.length === 0 ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-lg bg-surface-raised/50"
                    />
                  ))}
                </div>
              ) : filteredSubscriptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <Contact size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">
                    Aucun abonnement ne correspond à ces critères.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredSubscriptions.map((subscription) => {
                    const typeMeta = SUBSCRIPTION_TYPE_META[subscription.type];
                    const statusMeta =
                      SUBSCRIPTION_STATUS_META[subscription.status];
                    const days = daysUntil(subscription.endDate);
                    const isExpiring =
                      subscription.status === 'ACTIF' && days >= 0 && days <= 7;
                    const isExpiredWindow = days < 0;

                    return (
                      <div
                        key={subscription.id}
                        className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised/40 p-4 transition-colors hover:border-line-strong lg:flex-row lg:items-center"
                      >
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${typeMeta.classes}`}
                        >
                          {typeMeta.icon}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-content">
                              {subscription.clientId}
                            </span>
                            <Badge variant={statusMeta.variant} className="gap-1">
                              {statusMeta.icon}
                              {statusMeta.label}
                            </Badge>
                            {isExpiring && (
                              <Badge variant="warning">
                                {days === 0
                                  ? 'Expire aujourd’hui'
                                  : `J-${days}`}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-content-subtle">
                            {typeMeta.label} · {formatDate(subscription.startDate)} →{' '}
                            {formatDate(subscription.endDate)}
                            {subscription.type === 'CARNET_SEANCES' &&
                              ` · ${subscription.remainingSessions} séance(s)`}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {subscription.status === 'ACTIF' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="border border-line text-[11px]"
                              disabled={statusSavingId === subscription.id}
                              onClick={() =>
                                void handleStatusChange(subscription, 'SUSPENDU')
                              }
                              icon={
                                statusSavingId === subscription.id ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <PauseCircle size={13} />
                                )
                              }
                            >
                              Suspendre
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-400"
                              disabled={statusSavingId === subscription.id}
                              onClick={() =>
                                void handleStatusChange(subscription, 'ACTIF')
                              }
                              icon={
                                statusSavingId === subscription.id ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <PlayCircle size={13} />
                                )
                              }
                            >
                              Réactiver
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[11px]"
                            onClick={() => prefillRenewal(subscription)}
                            icon={<RefreshCw size={13} />}
                          >
                            Renouveler
                          </Button>
                          {isExpiredWindow && subscription.status === 'ACTIF' && (
                            <span className="text-[11px] text-amber-800 dark:text-amber-400">
                              Fenêtre dépassée
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-4 xl:col-span-4">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                  <Contact size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Nouvel abonnement
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Rattachez une formule à un client.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateSubscription} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="gym-client-id" className="text-xs font-medium text-content-muted">
                    Identifiant client *
                  </label>
                  <Input id="gym-client-id"
                    required
                    list="gym-known-clients"
                    placeholder="Ex: CLIENT-001"
                    value={form.clientId}
                    onChange={(e) => updateForm({ clientId: e.target.value })}
                  />
                  <datalist id="gym-known-clients">
                    {knownClientIds.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2">
                  <label htmlFor="gym-subscription-type" className="text-xs font-medium text-content-muted">
                    Formule *
                  </label>
                  <select id="gym-subscription-type"
                    className={SELECT_CLASSES}
                    value={form.type}
                    onChange={(e) =>
                      handleTypeChange(e.target.value as SubscriptionType)
                    }
                  >
                    {Object.entries(SUBSCRIPTION_TYPE_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="gym-start-date" className="text-xs font-medium text-content-muted">
                      Début *
                    </label>
                    <Input id="gym-start-date"
                      type="date"
                      required
                      value={form.startDate}
                      onChange={(e) => handleStartChange(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="gym-end-date" className="text-xs font-medium text-content-muted">
                      Fin *
                    </label>
                    <Input id="gym-end-date"
                      type="date"
                      required
                      value={form.endDate}
                      onChange={(e) => updateForm({ endDate: e.target.value })}
                    />
                  </div>
                </div>

                {form.type === 'CARNET_SEANCES' && (
                  <div className="space-y-2">
                    <label htmlFor="gym-remaining-sessions" className="text-xs font-medium text-content-muted">
                      Nombre de séances *
                    </label>
                    <Input id="gym-remaining-sessions"
                      type="number"
                      min={1}
                      required
                      value={form.remainingSessions}
                      onChange={(e) =>
                        updateForm({ remainingSessions: e.target.value })
                      }
                    />
                  </div>
                )}

                {formError && <Notice tone="error">{formError}</Notice>}
                {formSuccess && <Notice tone="success">{formSuccess}</Notice>}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={saving}
                  icon={
                    saving ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Contact size={16} />
                    )
                  }
                >
                  Créer l’abonnement
                </Button>
              </form>
            </Card>

            <div className="flex gap-3 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={16} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                Un abonnement est créé <strong>actif</strong>. Le tourniquet
                vérifie sa validité, le crédit de séances et l’anti-passback à
                chaque passage.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================= CONTRÔLE D'ACCÈS ======================= */}
      {activeTab === 'access' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-5">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <DoorOpen size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">Tourniquet</h2>
                  <p className="text-xs text-content-subtle">
                    Simulez une entrée ou une sortie.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-content-muted">
                    Client *
                  </label>
                  <Input
                    list="gym-access-clients"
                    placeholder="Identifiant du client"
                    value={accessClientId}
                    onChange={(e) => {
                      setAccessClientId(e.target.value);
                      setAccessError(null);
                      setAccessResult(null);
                    }}
                  />
                  <datalist id="gym-access-clients">
                    {knownClientIds.map((id) => (
                      <option key={id} value={id} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-content-muted">
                    Méthode d’identification
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      Object.entries(ACCESS_METHOD_META) as [
                        AccessMethod,
                        { label: string; icon: ReactNode },
                      ][]
                    ).map(([method, meta]) => {
                      const selected = accessMethod === method;
                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setAccessMethod(method)}
                          className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                            selected
                              ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                              : 'border-line text-content-muted hover:border-line-strong hover:text-content'
                          }`}
                        >
                          {meta.icon}
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Button
                    type="button"
                    className="w-full bg-emerald-700 hover:bg-emerald-800"
                    disabled={accessLoading !== null}
                    onClick={() => void runAccess('in')}
                    icon={
                      accessLoading === 'in' ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <LogIn size={16} />
                      )
                    }
                  >
                    Entrée
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={accessLoading !== null}
                    onClick={() => void runAccess('out')}
                    icon={
                      accessLoading === 'out' ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <LogOut size={16} />
                      )
                    }
                  >
                    Sortie
                  </Button>
                </div>

                {accessError && <Notice tone="error">{accessError}</Notice>}

                {accessResult && (
                  <div
                    className={`rounded-lg border p-4 ${
                      accessResult.granted
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : 'border-red-500/30 bg-red-500/10'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 rounded-full p-1.5 ${
                          accessResult.granted
                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-500/20 text-red-800 dark:text-red-300'
                        }`}
                      >
                        {accessResult.granted ? (
                          <CheckCircle2 size={18} />
                        ) : (
                          <XCircle size={18} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-semibold ${
                            accessResult.granted
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-red-800 dark:text-red-300'
                          }`}
                        >
                          {accessResult.granted
                            ? accessContext === 'in'
                              ? 'Entrée autorisée'
                              : 'Sortie enregistrée'
                            : 'Accès refusé'}
                        </p>
                        <p className="mt-1 text-xs text-content-muted">
                          {accessResult.reason ||
                            (accessContext === 'in'
                              ? 'Abonnement valide, bon passage.'
                              : 'Bonne séance, à bientôt.')}
                        </p>
                        {accessResult.subscription && (
                          <p className="mt-2 text-[11px] text-content-subtle">
                            {SUBSCRIPTION_TYPE_META[accessResult.subscription.type].label}
                            {' · '}
                            jusqu’au {formatDate(accessResult.subscription.endDate)}
                            {accessResult.subscription.type === 'CARNET_SEANCES' &&
                              ` · ${accessResult.subscription.remainingSessions} séance(s) restante(s)`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <div className="flex gap-3 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-400" />
              <div>
                <p className="font-medium text-content">Règles du tourniquet</p>
                <p className="mt-1">
                  Abonnement actif et dans sa période, séances restantes pour un
                  carnet, et anti-passback (une entrée doit être suivie d’une
                  sortie).
                </p>
              </div>
            </div>
          </div>

          <div className="xl:col-span-7">
            <Card className="h-full">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-content">
                    Journal des passages
                  </h2>
                  <p className="text-xs text-content-subtle">
                    {accessLogs.length} derniers événements.
                  </p>
                </div>
                <Badge variant="default" className="gap-1">
                  <Timer size={12} />
                  Temps réel
                </Badge>
              </div>

              {loading && accessLogs.length === 0 ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-lg bg-surface-raised/50"
                    />
                  ))}
                </div>
              ) : accessLogs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <DoorOpen size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">Aucun passage enregistré.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wider text-content-subtle">
                        <th className="pb-3 pr-4 font-medium">Client</th>
                        <th className="pb-3 pr-4 font-medium">Sens</th>
                        <th className="pb-3 pr-4 font-medium">Méthode</th>
                        <th className="pb-3 pr-4 font-medium">Heure</th>
                        <th className="pb-3 text-right font-medium">Résultat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {accessLogs.map((log) => (
                        <tr
                          key={log.id}
                          className="transition-colors hover:bg-surface-raised/30"
                        >
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2 text-content">
                              <UserRound size={14} className="text-content-subtle" />
                              <span className="truncate">{log.clientId}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-content-subtle">
                              #{shortId(log.id)}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                log.direction === 'ENTREE'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-sky-700 dark:text-sky-400'
                              }`}
                            >
                              {log.direction === 'ENTREE' ? (
                                <ArrowUpRight size={13} />
                              ) : (
                                <ArrowDownRight size={13} />
                              )}
                              {log.direction === 'ENTREE' ? 'Entrée' : 'Sortie'}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-xs text-content-muted">
                            <span className="inline-flex items-center gap-1.5">
                              {ACCESS_METHOD_META[log.method].icon}
                              {ACCESS_METHOD_META[log.method].label}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-xs text-content-muted">
                            <div>{formatTime(log.timestamp)}</div>
                            <div className="text-[10px] text-content-subtle">
                              {formatDate(log.timestamp)}
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            {log.granted ? (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 size={12} />
                                Accordé
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="gap-1">
                                <XCircle size={12} />
                                Refusé
                              </Badge>
                            )}
                            {!log.granted && log.reason && (
                              <div className="mt-1 max-w-[180px] text-[10px] text-red-800 dark:text-red-400/80">
                                {log.reason}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ========================= CARTES & CARNETS ======================= */}
      {activeTab === 'passes' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
            <div className="xl:col-span-7">
              <Card className="h-full">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-content">
                      Carnets de séances
                    </h2>
                    <p className="text-xs text-content-subtle">
                      Suivi du crédit restant par client.
                    </p>
                  </div>
                  <div className="relative sm:w-56">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                      size={15}
                    />
                    <Input
                      className="pl-9"
                      placeholder="Filtrer par client..."
                      value={passSearch}
                      onChange={(e) => setPassSearch(e.target.value)}
                    />
                  </div>
                </div>

                {filteredCarnets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line py-16 text-center">
                    <CreditCard size={30} className="mx-auto mb-3 text-content-subtle" />
                    <p className="text-sm text-content-subtle">
                      Aucun carnet de séances pour le moment.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {filteredCarnets.map((carnet) => {
                      const statusMeta =
                        SUBSCRIPTION_STATUS_META[carnet.status];
                      const days = daysUntil(carnet.endDate);
                      const empty = carnet.remainingSessions <= 0;
                      const progress = Math.max(
                        0,
                        Math.min(100, carnet.remainingSessions * 10),
                      );

                      return (
                        <div
                          key={carnet.id}
                          className="rounded-lg border border-line bg-surface-raised/40 p-4"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-content">
                                {carnet.clientId}
                              </p>
                              <p className="mt-0.5 text-[11px] text-content-subtle">
                                Valide jusqu’au {formatDate(carnet.endDate)}
                              </p>
                            </div>
                            <Badge variant={statusMeta.variant} className="gap-1">
                              {statusMeta.icon}
                              {statusMeta.label}
                            </Badge>
                          </div>

                          <div className="mt-4 flex items-end justify-between">
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-content-subtle">
                                Séances restantes
                              </p>
                              <p
                                className={`text-2xl font-semibold ${
                                  empty ? 'text-red-800 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                {carnet.remainingSessions}
                              </p>
                            </div>
                            <span
                              className={`text-[11px] ${
                                days < 0
                                  ? 'text-red-800 dark:text-red-400'
                                  : days <= 7
                                    ? 'text-amber-800 dark:text-amber-400'
                                    : 'text-content-subtle'
                              }`}
                            >
                              {days < 0 ? 'Expiré' : `J-${days}`}
                            </span>
                          </div>

                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                            <div
                              className={`h-full rounded-full ${
                                empty ? 'bg-red-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>

                          <div className="mt-4 flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 text-[11px]"
                              onClick={() => {
                                setAccessClientId(carnet.clientId);
                                setAccessMethod('QR_CODE');
                                setAccessError(null);
                                setAccessResult(null);
                                setActiveTab('access');
                              }}
                              icon={<LogIn size={13} />}
                            >
                              Pointer
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 border border-line text-[11px]"
                              onClick={() => prefillRenewal(carnet)}
                              icon={<RefreshCw size={13} />}
                            >
                              Recharger
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-4 xl:col-span-5">
              <Card>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300">
                    <Timer size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-content">
                      Échéances proches
                    </h2>
                    <p className="text-xs text-content-subtle">
                      Abonnements à relancer sous 7 jours.
                    </p>
                  </div>
                </div>

                {expiringSoon.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-2 rounded-full bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 size={22} />
                    </div>
                    <p className="text-xs text-content-subtle">
                      Aucune échéance imminente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {expiringSoon.map((subscription) => {
                      const days = daysUntil(subscription.endDate);
                      return (
                        <div
                          key={subscription.id}
                          className="flex items-center justify-between rounded-lg border border-line bg-card p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-content">
                              {subscription.clientId}
                            </p>
                            <p className="mt-0.5 text-[10px] text-content-subtle">
                              {SUBSCRIPTION_TYPE_META[subscription.type].short} ·{' '}
                              {formatDate(subscription.endDate)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={days === 0 ? 'danger' : 'warning'}>
                              {days === 0 ? 'Aujourd’hui' : `J-${days}`}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => prefillRenewal(subscription)}
                              className="rounded-md p-1.5 text-content-subtle hover:bg-surface-raised hover:text-content"
                              title="Renouveler"
                            >
                              <RefreshCw size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <div className="flex gap-3 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
                <Info size={16} className="mt-0.5 shrink-0 text-content-subtle" />
                <p>
                  Un carnet décrémente automatiquement une séance à chaque
                  entrée validée. À zéro, le tourniquet refuse l’accès jusqu’au
                  rechargement.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
