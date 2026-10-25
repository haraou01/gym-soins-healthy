import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  Ban,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock,
  Dumbbell,
  HeartPulse,
  Info,
  Layers,
  ListChecks,
  RefreshCw,
  Search,
  Stethoscope,
  Timer,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';

import { Badge, Button, Card, Input, Notice, StatCard } from '@/components/ui';
import { bookingAPI } from '@/api';
import { formatDuration, getApiErrorMessage } from '@/lib/utils';
import type { Booking, BookingResourceType, BookingStatus } from '@/types';

type BookingTab = 'create' | 'active' | 'planning';
type PlanningMode = 'client' | 'resource' | 'practitioner';

interface CreateBookingFormState {
  clientId: string;
  resourceType: BookingResourceType;
  resourceId: string;
  practitionerOrCoachId: string;
  startTime: string;
  endTime: string;
}

const RESOURCE_META: Record<
  BookingResourceType,
  {
    label: string;
    description: string;
    idPlaceholder: string;
    icon: ReactNode;
    classes: string;
  }
> = {
  GYM_CLASS: {
    label: 'Cours collectif',
    description: 'Cours de groupe',
    idPlaceholder: 'UUID du cours collectif',
    icon: <Dumbbell size={14} />,
    classes: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  CARE_SESSION: {
    label: 'Séance de soin',
    description: 'Soin ou thérapie',
    idPlaceholder: 'UUID de la prestation de soin',
    icon: <HeartPulse size={14} />,
    classes: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  },
  EQUIPMENT: {
    label: 'Équipement',
    description: 'Machine ou cabine',
    idPlaceholder: "UUID de l'équipement",
    icon: <Wrench size={14} />,
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
};

const STATUS_META: Record<
  BookingStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'default' }
> = {
  CONFIRME: { label: 'Confirmé', variant: 'success' },
  ANNULE: { label: 'Annulé', variant: 'danger' },
  TERMINE: { label: 'Terminé', variant: 'default' },
};

const TABS: { id: BookingTab; label: string; icon: ReactNode }[] = [
  {
    id: 'create',
    label: 'Créer une réservation',
    icon: <CalendarPlus size={16} />,
  },
  {
    id: 'active',
    label: 'Réservations actives',
    icon: <ListChecks size={16} />,
  },
  {
    id: 'planning',
    label: 'Plannings filtrés',
    icon: <CalendarRange size={16} />,
  },
];

const PLANNING_MODES: { id: PlanningMode; label: string; icon: ReactNode }[] = [
  { id: 'client', label: 'Par client', icon: <UserRound size={14} /> },
  { id: 'resource', label: 'Par ressource', icon: <Layers size={14} /> },
  {
    id: 'practitioner',
    label: 'Par praticien',
    icon: <Stethoscope size={14} />,
  },
];

const SELECT_CLASSES =
  'h-10 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dayFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

const pad = (value: number): string => String(value).padStart(2, '0');

function toDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextSlot(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    start: toDateTimeLocal(start),
    end: toDateTimeLocal(end),
  };
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : shortDateFormatter.format(date);
}

function formatDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dayFormatter.format(date);
}

function formatTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

function bookingMinutes(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 60000),
  );
}

function localDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

function shortId(value: string): string {
  return value.length > 16
    ? `${value.slice(0, 8)}…${value.slice(-4)}`
    : value;
}

function RecapRow({
  label,
  value,
  mono = false,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 pb-2 last:border-0 last:pb-0">
      <dt className="shrink-0 text-xs text-content-subtle">{label}</dt>
      <dd
        className={`min-w-0 break-words text-right ${
          mono ? 'font-mono text-xs' : 'text-sm'
        } text-content`}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

export default function BookingPage() {
  const [activeTab, setActiveTab] = useState<BookingTab>('create');

  /* ------------------------- Réservations globales ------------------------ */
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  /* ----------------------------- Création -------------------------------- */
  const [createForm, setCreateForm] = useState<CreateBookingFormState>(() => {
    const slot = nextSlot();

    return {
      clientId: '',
      resourceType: 'GYM_CLASS',
      resourceId: '',
      practitionerOrCoachId: '',
      startTime: slot.start,
      endTime: slot.end,
    };
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createConflict, setCreateConflict] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<Booking | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  /* ----------------------------- Annulation ------------------------------ */
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  /* ------------------------------ Planning ------------------------------- */
  const [planningMode, setPlanningMode] = useState<PlanningMode>('client');
  const [planningClientId, setPlanningClientId] = useState('');
  const [planningPractitionerId, setPlanningPractitionerId] = useState('');
  const [planningResourceType, setPlanningResourceType] =
    useState<BookingResourceType>('GYM_CLASS');
  const [planningResourceId, setPlanningResourceId] = useState('');
  const [planningBookings, setPlanningBookings] = useState<Booking[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [planningLoadedFor, setPlanningLoadedFor] = useState<{
    mode: PlanningMode;
    label: string;
    value: string;
  } | null>(null);

  const fetchBookings = useCallback(async () => {
    setBookingsLoading(true);
    setBookingsError(null);

    try {
      const { data } = await bookingAPI.getAll();
      setBookings(data);
    } catch (error) {
      setBookingsError(
        getApiErrorMessage(
          error,
          'Impossible de charger les réservations.',
        ),
      );
    } finally {
      setBookingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  const confirmedBookings = useMemo(
    () => bookings.filter((booking) => booking.status === 'CONFIRME'),
    [bookings],
  );

  const now = Date.now();
  const todayKey = localDateKey(new Date());
  const upcomingCount = confirmedBookings.filter(
    (booking) => new Date(booking.startTime).getTime() >= now,
  ).length;
  const todayCount = confirmedBookings.filter(
    (booking) => localDateKey(booking.startTime) === todayKey,
  ).length;

  const createResourceMeta = RESOURCE_META[createForm.resourceType];
  const createStartDate = new Date(createForm.startTime);
  const createEndDate = new Date(createForm.endTime);
  const createDuration =
    !Number.isNaN(createStartDate.getTime()) &&
    !Number.isNaN(createEndDate.getTime()) &&
    createEndDate > createStartDate
      ? Math.round(
          (createEndDate.getTime() - createStartDate.getTime()) / 60000,
        )
      : null;

  const groupedPlanning = useMemo(() => {
    const groups = new Map<string, Booking[]>();

    for (const booking of planningBookings) {
      const key = localDateKey(booking.startTime);
      const existing = groups.get(key);

      if (existing) {
        existing.push(booking);
      } else {
        groups.set(key, [booking]);
      }
    }

    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      date: items[0].startTime,
      bookings: items,
    }));
  }, [planningBookings]);

  const updateCreateForm = (patch: Partial<CreateBookingFormState>) => {
    setCreateForm((previous) => ({ ...previous, ...patch }));
    setCreateError(null);
    setCreateConflict(false);
    setCreateSuccess(null);
  };

  const handleResourceTypeChange = (resourceType: BookingResourceType) => {
    updateCreateForm({ resourceType, resourceId: '' });
  };

  const handleCreateBooking = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setCreateError(null);
    setCreateConflict(false);
    setCreateSuccess(null);

    const clientId = createForm.clientId.trim();
    const resourceId = createForm.resourceId.trim();
    const practitionerOrCoachId = createForm.practitionerOrCoachId.trim();
    const start = new Date(createForm.startTime);
    const end = new Date(createForm.endTime);

    if (!clientId) {
      setCreateError("Saisissez l'identifiant du client.");
      return;
    }

    if (!practitionerOrCoachId) {
      setCreateError("Saisissez l'identifiant du praticien ou du coach.");
      return;
    }

    if (!resourceId) {
      setCreateError("Saisissez l'identifiant de la ressource.");
      return;
    }

    if (!UUID_REGEX.test(resourceId)) {
      setCreateError(
        "L'identifiant de ressource doit être un UUID valide.",
      );
      return;
    }

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      setCreateError('Renseignez une date et une heure valides.');
      return;
    }

    if (end <= start) {
      setCreateError(
        "L'heure de fin doit être postérieure à l'heure de début.",
      );
      return;
    }

    setCreateLoading(true);

    try {
      const { data } = await bookingAPI.create({
        clientId,
        resourceType: createForm.resourceType,
        resourceId,
        practitionerOrCoachId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });

      setCreateSuccess(data);

      const slot = nextSlot();
      setCreateForm((previous) => ({
        ...previous,
        clientId: '',
        resourceId: '',
        startTime: slot.start,
        endTime: slot.end,
      }));

      await fetchBookings();
    } catch (error) {
      const message = getApiErrorMessage(
        error,
        'Impossible de créer la réservation.',
      );

      setCreateError(message);
      setCreateConflict(/conflit/i.test(message));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCancelBooking = async (booking: Booking) => {
    setCancellingId(booking.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      await bookingAPI.cancel(booking.id);

      setActionSuccess(
        `Réservation de ${booking.clientId} annulée. Le créneau de ${formatTime(
          booking.startTime,
        )} à ${formatTime(booking.endTime)} est de nouveau disponible.`,
      );

      setBookings((previous) =>
        previous.filter((item) => item.id !== booking.id),
      );
      setPlanningBookings((previous) =>
        previous.map((item) =>
          item.id === booking.id
            ? { ...item, status: 'ANNULE' as BookingStatus }
            : item,
        ),
      );

      await fetchBookings();
    } catch (error) {
      setActionError(
        getApiErrorMessage(
          error,
          "Impossible d'annuler cette réservation.",
        ),
      );
    } finally {
      setCancellingId(null);
    }
  };

  const loadPlanning = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setPlanningError(null);

    let request: () => Promise<{ data: Booking[] }>;
    let label: string;
    let value: string;

    if (planningMode === 'client') {
      const clientId = planningClientId.trim();

      if (!clientId) {
        setPlanningError("Saisissez l'identifiant du client.");
        return;
      }

      request = () => bookingAPI.getByClient(clientId);
      label = 'Client';
      value = clientId;
    } else if (planningMode === 'practitioner') {
      const practitionerId = planningPractitionerId.trim();

      if (!practitionerId) {
        setPlanningError(
          "Saisissez l'identifiant du praticien ou du coach.",
        );
        return;
      }

      request = () => bookingAPI.getByPractitioner(practitionerId);
      label = 'Praticien';
      value = practitionerId;
    } else {
      const resourceId = planningResourceId.trim();

      if (!resourceId) {
        setPlanningError("Saisissez l'identifiant de la ressource.");
        return;
      }

      if (!UUID_REGEX.test(resourceId)) {
        setPlanningError(
          "L'identifiant de ressource doit être un UUID valide.",
        );
        return;
      }

      request = () =>
        bookingAPI.getByResource(planningResourceType, resourceId);
      label = RESOURCE_META[planningResourceType].label;
      value = resourceId;
    }

    setPlanningLoading(true);

    try {
      const { data } = await request();
      setPlanningBookings(data);
      setPlanningLoadedFor({
        mode: planningMode,
        label,
        value,
      });
    } catch (error) {
      setPlanningBookings([]);
      setPlanningLoadedFor(null);
      setPlanningError(
        getApiErrorMessage(error, 'Impossible de charger ce planning.'),
      );
    } finally {
      setPlanningLoading(false);
    }
  };

  const handlePlanningModeChange = (mode: PlanningMode) => {
    setPlanningMode(mode);
    setPlanningBookings([]);
    setPlanningLoadedFor(null);
    setPlanningError(null);
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-blue-500/20 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30">
            <CalendarDays size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content sm:text-3xl">
              Réservations & Plannings
            </h1>
            <p className="text-sm text-content-muted">
              Planification centralisée des cours, soins et équipements.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchBookings()}
          disabled={bookingsLoading}
          icon={
            <RefreshCw
              size={15}
              className={bookingsLoading ? 'animate-spin' : undefined}
            />
          }
        >
          Actualiser
        </Button>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-dense>
        <StatCard
          label="Confirmées"
          value={confirmedBookings.length}
          hint="réservations actives"
          icon={<CalendarCheck2 size={22} />}
          tone="brand"
        />
        <StatCard
          label="À venir"
          value={upcomingCount}
          hint="créneaux planifiés"
          icon={<CalendarClock size={22} />}
          tone="blue"
        />
        <StatCard
          label="Aujourd'hui"
          value={todayCount}
          hint="sur la journée en cours"
          icon={<CalendarDays size={22} />}
          tone="purple"
        />
      </div>

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
            {tab.id === 'active' && confirmedBookings.length > 0 && (
              <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content">
                {confirmedBookings.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===================== ONGLET CRÉATION ===================== */}
      {activeTab === 'create' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="xl:col-span-7">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                  <CalendarPlus size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Nouvelle réservation
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Réservez un créneau pour un cours, un soin ou un
                    équipement.
                  </p>
                </div>
              </div>

              <form
                onSubmit={handleCreateBooking}
                className="space-y-6"
              >
                {/* Client & intervenant */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-content-subtle" />
                    <h3 className="text-sm font-semibold text-content">
                      Client & intervenant
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label
                        htmlFor="booking-client"
                        className="text-xs font-medium text-content-muted"
                      >
                        Identifiant client *
                      </label>
                      <Input
                        id="booking-client"
                        value={createForm.clientId}
                        onChange={(event) =>
                          updateCreateForm({
                            clientId: event.target.value,
                          })
                        }
                        placeholder="Ex : client-001"
                        maxLength={64}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="booking-practitioner"
                        className="text-xs font-medium text-content-muted"
                      >
                        Praticien / coach *
                      </label>
                      <Input
                        id="booking-practitioner"
                        value={createForm.practitionerOrCoachId}
                        onChange={(event) =>
                          updateCreateForm({
                            practitionerOrCoachId: event.target.value,
                          })
                        }
                        placeholder="Ex : coach-001"
                        maxLength={64}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Ressource */}
                <div className="space-y-3 border-t border-line pt-5">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-content-subtle" />
                    <h3 className="text-sm font-semibold text-content">
                      Ressource
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      Object.keys(
                        RESOURCE_META,
                      ) as BookingResourceType[]
                    ).map((type) => {
                      const meta = RESOURCE_META[type];
                      const selected = createForm.resourceType === type;

                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleResourceTypeChange(type)}
                          className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                            selected
                              ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                              : 'border-line-strong bg-surface-raised/50 text-content-muted hover:border-line-strong'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {meta.icon}
                            {meta.label}
                          </span>
                          <span className="text-[11px] leading-tight">
                            {meta.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="booking-resource"
                      className="text-xs font-medium text-content-muted"
                    >
                      {createResourceMeta.label} — identifiant *
                    </label>
                    <Input
                      id="booking-resource"
                      value={createForm.resourceId}
                      onChange={(event) =>
                        updateCreateForm({
                          resourceId: event.target.value,
                        })
                      }
                      placeholder={createResourceMeta.idPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    <p className="text-[11px] text-content-subtle">
                      Format attendu : UUID (ex.
                      3fa85f64-5717-4562-b3fc-2c963f66afa6).
                    </p>
                  </div>
                </div>

                {/* Créneau */}
                <div className="space-y-3 border-t border-line pt-5">
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-content-subtle" />
                    <h3 className="text-sm font-semibold text-content">
                      Créneau
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label
                        htmlFor="booking-start"
                        className="text-xs font-medium text-content-muted"
                      >
                        Début *
                      </label>
                      <Input
                        id="booking-start"
                        type="datetime-local"
                        value={createForm.startTime}
                        onChange={(event) =>
                          updateCreateForm({
                            startTime: event.target.value,
                          })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="booking-end"
                        className="text-xs font-medium text-content-muted"
                      >
                        Fin *
                      </label>
                      <Input
                        id="booking-end"
                        type="datetime-local"
                        value={createForm.endTime}
                        onChange={(event) =>
                          updateCreateForm({
                            endTime: event.target.value,
                          })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-2 rounded-md border p-3 text-xs ${
                      createDuration !== null
                        ? 'border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                        : 'border-line bg-surface-raised/40 text-content-muted'
                    }`}
                  >
                    <Timer size={15} className="shrink-0" />
                    {createDuration !== null ? (
                      <span>
                        Durée du créneau :{' '}
                        <strong>{formatDuration(createDuration)}</strong>
                      </span>
                    ) : (
                      <span>
                        Renseignez une plage horaire valide (fin après le
                        début).
                      </span>
                    )}
                  </div>
                </div>

                {createError && (
                  <Notice tone="error">
                    <span>{createError}</span>
                    {createConflict && (
                      <span className="mt-1 block text-xs text-red-800 dark:text-red-200/80">
                        Le créneau est déjà occupé. Choisissez un autre
                        horaire, une autre ressource ou un autre intervenant.
                      </span>
                    )}
                  </Notice>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createLoading}
                  icon={
                    createLoading ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <CalendarPlus size={16} />
                    )
                  }
                >
                  {createLoading
                    ? 'Création en cours...'
                    : 'Confirmer la réservation'}
                </Button>

                {createSuccess && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 size={17} />
                      Réservation confirmée
                    </div>
                    <div className="mt-1 text-xs text-content">
                      #{createSuccess.id.slice(0, 8)} ·{' '}
                      {RESOURCE_META[createSuccess.resourceType].label} ·{' '}
                      {formatDateTime(createSuccess.startTime)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveTab('active')}
                        icon={<ArrowRight size={14} />}
                      >
                        Voir les réservations actives
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreateSuccess(null)}
                      >
                        Créer une autre réservation
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </Card>
          </div>

          {/* Récapitulatif */}
          <div className="space-y-4 xl:col-span-5">
            <Card>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-content">
                    Récapitulatif
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Vérifiez les informations avant validation.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${createResourceMeta.classes}`}
                >
                  {createResourceMeta.icon}
                  {createResourceMeta.label}
                </span>
              </div>

              <dl className="space-y-3">
                <RecapRow
                  label="Client"
                  value={createForm.clientId.trim() || '—'}
                  mono={createForm.clientId.trim().length > 0}
                />
                <RecapRow
                  label="Ressource"
                  value={
                    createForm.resourceId.trim()
                      ? shortId(createForm.resourceId.trim())
                      : '—'
                  }
                  title={createForm.resourceId.trim() || undefined}
                  mono
                />
                <RecapRow
                  label="Praticien / coach"
                  value={
                    createForm.practitionerOrCoachId.trim() || '—'
                  }
                  mono={
                    createForm.practitionerOrCoachId.trim().length > 0
                  }
                />
                <RecapRow
                  label="Début"
                  value={
                    createForm.startTime
                      ? formatDateTime(createForm.startTime)
                      : '—'
                  }
                />
                <RecapRow
                  label="Fin"
                  value={
                    createForm.endTime
                      ? formatDateTime(createForm.endTime)
                      : '—'
                  }
                />
                <RecapRow
                  label="Durée"
                  value={
                    createDuration !== null
                      ? formatDuration(createDuration)
                      : '—'
                  }
                />
                <RecapRow
                  label="Statut prévu"
                  value="Confirmé"
                />
              </dl>
            </Card>

            <div className="flex gap-2 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={15} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                Les réservations confirmées bloquent automatiquement la
                ressource et le praticien sur le créneau. En cas de
                chevauchement, l'API renvoie une erreur de conflit.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===================== ONGLET ACTIVES ===================== */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {actionError && <Notice tone="error">{actionError}</Notice>}
          {actionSuccess && (
            <Notice tone="success">{actionSuccess}</Notice>
          )}

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-content">
                  Réservations confirmées
                </h2>
                <p className="text-xs text-content-subtle">
                  Les créneaux annulés sont libérés immédiatement.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success">
                  {confirmedBookings.length} active
                  {confirmedBookings.length > 1 ? 's' : ''}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void fetchBookings()}
                  disabled={bookingsLoading}
                  icon={
                    <RefreshCw
                      size={14}
                      className={
                        bookingsLoading ? 'animate-spin' : undefined
                      }
                    />
                  }
                >
                  Actualiser
                </Button>
              </div>
            </div>

            {bookingsError && (
              <div className="mb-4">
                <Notice tone="error">{bookingsError}</Notice>
              </div>
            )}

            {bookingsLoading && confirmedBookings.length === 0 && (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-lg bg-surface-raised"
                  />
                ))}
              </div>
            )}

            {!bookingsLoading && confirmedBookings.length === 0 && (
              <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
                <CalendarRange
                  size={24}
                  className="mx-auto mb-2 text-content-subtle"
                />
                <p className="text-sm text-content-muted">
                  Aucune réservation confirmée.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('create')}
                  className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  Créer une première réservation
                </button>
              </div>
            )}

            {confirmedBookings.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-content-subtle">
                      <th className="pb-2 pr-3 font-medium">Client</th>
                      <th className="pb-2 pr-3 font-medium">Ressource</th>
                      <th className="pb-2 pr-3 font-medium">
                        Praticien / coach
                      </th>
                      <th className="pb-2 pr-3 font-medium">Créneau</th>
                      <th className="pb-2 pr-3 font-medium">Durée</th>
                      <th className="pb-2 pr-3 font-medium">Statut</th>
                      <th className="pb-2 text-right font-medium">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmedBookings.map((booking) => {
                      const resourceMeta =
                        RESOURCE_META[booking.resourceType];
                      const statusMeta = STATUS_META[booking.status];

                      return (
                        <tr
                          key={booking.id}
                          className="border-b border-line/60 transition-colors hover:bg-surface-raised/30"
                        >
                          <td className="py-3 pr-3">
                            <div className="font-medium text-content">
                              {booking.clientId}
                            </div>
                            <div className="font-mono text-[11px] text-content-subtle">
                              #{booking.id.slice(0, 8)}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${resourceMeta.classes}`}
                              >
                                {resourceMeta.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm text-content">
                                  {resourceMeta.label}
                                </div>
                                <div
                                  className="font-mono text-[11px] text-content-subtle"
                                  title={booking.resourceId}
                                >
                                  {shortId(booking.resourceId)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="font-mono text-xs text-content-muted">
                              {booking.practitionerOrCoachId}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="text-content">
                              {formatShortDate(booking.startTime)}
                            </div>
                            <div className="text-xs text-content-subtle">
                              {formatTime(booking.startTime)} –{' '}
                              {formatTime(booking.endTime)}
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-xs text-content-muted">
                            {formatDuration(
                              bookingMinutes(
                                booking.startTime,
                                booking.endTime,
                              ),
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <Badge variant={statusMeta.variant}>
                              {statusMeta.label}
                            </Badge>
                          </td>
                          <td className="py-3 text-right">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() =>
                                void handleCancelBooking(booking)
                              }
                              disabled={cancellingId === booking.id}
                              icon={
                                cancellingId === booking.id ? (
                                  <RefreshCw
                                    size={14}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Ban size={14} />
                                )
                              }
                            >
                              {cancellingId === booking.id
                                ? 'Annulation...'
                                : 'Annuler'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===================== ONGLET PLANNINGS ===================== */}
      {activeTab === 'planning' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="xl:col-span-4">
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 text-blue-700 dark:text-blue-300">
                  <CalendarRange size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Filtrer un planning
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Par client, ressource ou praticien.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-1 rounded-lg border border-line bg-surface-raised/50 p-1 sm:grid-cols-3 xl:grid-cols-1">
                {PLANNING_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => handlePlanningModeChange(mode.id)}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      planningMode === mode.id
                        ? 'bg-surface-overlay text-content'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    {mode.icon}
                    {mode.label}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(event) => void loadPlanning(event)}
                className="mt-4 space-y-3"
              >
                {planningMode === 'client' && (
                  <div className="space-y-2">
                    <label
                      htmlFor="planning-client"
                      className="text-xs font-medium text-content-muted"
                    >
                      Identifiant client
                    </label>
                    <Input
                      id="planning-client"
                      value={planningClientId}
                      onChange={(event) =>
                        setPlanningClientId(event.target.value)
                      }
                      placeholder="Ex : client-001"
                      maxLength={64}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}

                {planningMode === 'practitioner' && (
                  <div className="space-y-2">
                    <label
                      htmlFor="planning-practitioner"
                      className="text-xs font-medium text-content-muted"
                    >
                      Identifiant praticien / coach
                    </label>
                    <Input
                      id="planning-practitioner"
                      value={planningPractitionerId}
                      onChange={(event) =>
                        setPlanningPractitionerId(event.target.value)
                      }
                      placeholder="Ex : coach-001"
                      maxLength={64}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}

                {planningMode === 'resource' && (
                  <>
                    <div className="space-y-2">
                      <label
                        htmlFor="planning-resource-type"
                        className="text-xs font-medium text-content-muted"
                      >
                        Type de ressource
                      </label>
                      <select
                        id="planning-resource-type"
                        value={planningResourceType}
                        onChange={(event) =>
                          setPlanningResourceType(
                            event.target.value as BookingResourceType,
                          )
                        }
                        className={SELECT_CLASSES}
                      >
                        {(
                          Object.keys(
                            RESOURCE_META,
                          ) as BookingResourceType[]
                        ).map((type) => (
                          <option key={type} value={type}>
                            {RESOURCE_META[type].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="planning-resource"
                        className="text-xs font-medium text-content-muted"
                      >
                        Identifiant de la ressource
                      </label>
                      <Input
                        id="planning-resource"
                        value={planningResourceId}
                        onChange={(event) =>
                          setPlanningResourceId(event.target.value)
                        }
                        placeholder={
                          RESOURCE_META[planningResourceType].idPlaceholder
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </>
                )}

                {planningError && (
                  <Notice tone="error">{planningError}</Notice>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={planningLoading}
                  icon={
                    planningLoading ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )
                  }
                >
                  {planningLoading
                    ? 'Chargement...'
                    : 'Afficher le planning'}
                </Button>
              </form>
            </Card>

            <div className="mt-4 flex gap-2 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={15} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                L'agenda inclut les réservations confirmées, annulées et
                terminées. Les créneaux sont regroupés par journée.
              </p>
            </div>
          </div>

          <div className="xl:col-span-8">
            <Card className="h-full">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-content">
                    Agenda détaillé
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Chronologie des réservations pour le filtre choisi.
                  </p>
                </div>
                {planningLoadedFor && (
                  <Badge variant="default">
                    {planningLoadedFor.label} ·{' '}
                    {shortId(planningLoadedFor.value)}
                  </Badge>
                )}
              </div>

              {planningLoading && planningBookings.length === 0 && (
                <div className="mt-5 space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="h-20 animate-pulse rounded-lg bg-surface-raised"
                    />
                  ))}
                </div>
              )}

              {!planningLoadedFor &&
                !planningError &&
                !planningLoading && (
                  <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-10 text-center">
                    <CalendarRange
                      size={24}
                      className="mx-auto mb-2 text-content-subtle"
                    />
                    <p className="text-sm text-content-muted">
                      Sélectionnez un filtre pour afficher un agenda.
                    </p>
                    <p className="mt-1 text-xs text-content-subtle">
                      Vous pouvez consulter un client, une ressource ou un
                      praticien.
                    </p>
                  </div>
                )}

              {planningLoadedFor && planningBookings.length === 0 && (
                <div className="mt-5 rounded-lg border border-dashed border-line px-6 py-8 text-center">
                  <p className="text-sm text-content-muted">
                    Aucune réservation pour ce filtre.
                  </p>
                </div>
              )}

              {groupedPlanning.map((group) => (
                <div key={group.key} className="mt-5 first:mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold capitalize text-content">
                      {formatDay(group.date)}
                    </h3>
                    <div className="flex items-center gap-2">
                      {group.key === todayKey && (
                        <Badge variant="success">Aujourd'hui</Badge>
                      )}
                      <Badge variant="default">
                        {group.bookings.length} créneau
                        {group.bookings.length > 1 ? 'x' : ''}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.bookings.map((booking) => {
                      const resourceMeta =
                        RESOURCE_META[booking.resourceType];
                      const statusMeta = STATUS_META[booking.status];

                      return (
                        <div
                          key={booking.id}
                          className="rounded-lg border border-line bg-surface-raised/40 p-3"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex items-start gap-3">
                              <div className="w-14 shrink-0 text-center">
                                <div className="text-sm font-semibold text-content">
                                  {formatTime(booking.startTime)}
                                </div>
                                <div className="text-[11px] text-content-subtle">
                                  {formatTime(booking.endTime)}
                                </div>
                              </div>

                              <div className="min-w-0 border-l border-line pl-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="flex items-center gap-1.5 text-sm font-medium text-content">
                                    {resourceMeta.icon}
                                    {resourceMeta.label}
                                  </span>
                                  <Badge variant={statusMeta.variant}>
                                    {statusMeta.label}
                                  </Badge>
                                </div>
                                <div className="mt-1 text-xs text-content-muted">
                                  Client{' '}
                                  <span className="text-content">
                                    {booking.clientId}
                                  </span>{' '}
                                  · Praticien{' '}
                                  <span className="text-content">
                                    {booking.practitionerOrCoachId}
                                  </span>
                                </div>
                                <div
                                  className="mt-0.5 font-mono text-[11px] text-content-subtle"
                                  title={booking.resourceId}
                                >
                                  Ressource {shortId(booking.resourceId)}
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 text-xs text-content-subtle">
                              {formatDuration(
                                bookingMinutes(
                                  booking.startTime,
                                  booking.endTime,
                                ),
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
