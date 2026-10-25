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
  CheckCircle2,
  Clock,
  Coins,
  History,
  Info,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';

import { Badge, Button, Card, Input, Notice, StatCard } from '@/components/ui';
import { careAPI } from '@/api';
import {
  formatCurrency,
  formatDuration,
  getApiErrorMessage,
} from '@/lib/utils';
import type {
  CareService,
  CareServiceType,
  CareSession,
  CareSessionResult,
  ClientCarePackage,
  ClientCarePackageStatus,
} from '@/types';

type CareTab = 'catalogue' | 'packages' | 'sessions';
type HistoryMode = 'therapist' | 'client';

const CARE_TYPE_LABELS: Record<CareServiceType, string> = {
  UNITAIRE: 'Soin unitaire',
  PACK: 'Pack multi-séances',
};

const PACKAGE_STATUS_META: Record<
  ClientCarePackageStatus,
  { label: string; variant: 'success' | 'warning' | 'default' }
> = {
  ACTIF: { label: 'Actif', variant: 'success' },
  EPUISE: { label: 'Épuisé', variant: 'default' },
  EXPIRE: { label: 'Expiré', variant: 'warning' },
};

const TABS: { id: CareTab; label: string; icon: ReactNode }[] = [
  { id: 'catalogue', label: 'Catalogue des soins', icon: <Sparkles size={16} /> },
  { id: 'packages', label: 'Attribution de packs', icon: <Package size={16} /> },
  { id: 'sessions', label: 'Consommation & Historique', icon: <History size={16} /> },
];

const SELECT_CLASSES =
  'h-10 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-content placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-brand-500';

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export default function CarePage() {
  const [activeTab, setActiveTab] = useState<CareTab>('catalogue');

  /* ----------------------------- Catalogue ----------------------------- */
  const [services, setServices] = useState<CareService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | CareServiceType>('ALL');

  const [newService, setNewService] = useState({
    title: '',
    description: '',
    durationMinutes: '60',
    price: '',
    type: 'UNITAIRE' as CareServiceType,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  /* ------------------------- Packs / portefeuille ----------------------- */
  const [packageClientId, setPackageClientId] = useState('');
  const [packages, setPackages] = useState<ClientCarePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [packagesLoadedFor, setPackagesLoadedFor] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({
    clientId: '',
    careServiceId: '',
    totalSessions: '10',
  });
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);

  /* --------------------- Consommation & historique --------------------- */
  const [consumeForm, setConsumeForm] = useState({
    clientId: '',
    careServiceId: '',
    therapistId: '',
    timestamp: '',
    notes: '',
  });
  const [consumeError, setConsumeError] = useState<string | null>(null);
  const [consumeResult, setConsumeResult] = useState<CareSessionResult | null>(null);
  const [consumeLoading, setConsumeLoading] = useState(false);

  const [historyMode, setHistoryMode] = useState<HistoryMode>('therapist');
  const [historyId, setHistoryId] = useState('');
  const [sessions, setSessions] = useState<CareSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoadedFor, setHistoryLoadedFor] = useState<{
    mode: HistoryMode;
    id: string;
  } | null>(null);

  const fetchServices = useCallback(async () => {
    setServicesLoading(true);
    setServicesError(null);

    try {
      const { data } = await careAPI.getServices();
      setServices(data);
    } catch (error) {
      setServicesError(
        getApiErrorMessage(
          error,
          'Impossible de charger le catalogue des soins.',
        ),
      );
    } finally {
      setServicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const unitServices = useMemo(
    () => services.filter((service) => service.type === 'UNITAIRE'),
    [services],
  );
  const packServices = useMemo(
    () => services.filter((service) => service.type === 'PACK'),
    [services],
  );
  const filteredServices = useMemo(() => {
    const term = serviceSearch.trim().toLowerCase();

    return services.filter((service) => {
      const matchesType = typeFilter === 'ALL' || service.type === typeFilter;
      const matchesTerm =
        term.length === 0 ||
        service.title.toLowerCase().includes(term) ||
        (service.description ?? '').toLowerCase().includes(term);

      return matchesType && matchesTerm;
    });
  }, [services, serviceSearch, typeFilter]);

  const activePackages = useMemo(
    () => packages.filter((pack) => pack.status === 'ACTIF'),
    [packages],
  );
  const totalCredits = useMemo(
    () =>
      activePackages.reduce(
        (total, pack) => total + pack.remainingSessions,
        0,
      ),
    [activePackages],
  );

  const handleCreateService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const title = newService.title.trim();
    const duration = Number(newService.durationMinutes);
    const price = Number(newService.price);

    if (title.length < 2) {
      setFormError('Le titre du soin doit contenir au moins 2 caractères.');
      return;
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
      setFormError(
        'La durée doit être un nombre entier compris entre 1 et 600 minutes.',
      );
      return;
    }

    if (newService.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setFormError('Le tarif doit être un montant positif ou nul.');
      return;
    }

    setFormLoading(true);

    try {
      const { data } = await careAPI.createService({
        title,
        description: newService.description.trim() || undefined,
        durationMinutes: duration,
        price,
        type: newService.type,
      });

      setServices((previous) => [data, ...previous]);
      setNewService({
        title: '',
        description: '',
        durationMinutes: '60',
        price: '',
        type: 'UNITAIRE',
      });
      setFormSuccess(`« ${data.title} » a été ajouté au catalogue.`);
    } catch (error) {
      setFormError(
        getApiErrorMessage(error, "Impossible d'ajouter ce soin au catalogue."),
      );
    } finally {
      setFormLoading(false);
    }
  };

  const loadPackages = useCallback(async (rawClientId: string) => {
    const clientId = rawClientId.trim();

    if (!clientId) {
      setPackagesError("Saisissez l'identifiant du client.");
      return;
    }

    setPackagesLoading(true);
    setPackagesError(null);

    try {
      const { data } = await careAPI.getPackagesByClient(clientId);
      setPackages(data);
      setPackagesLoadedFor(clientId);
    } catch (error) {
      setPackages([]);
      setPackagesLoadedFor(null);
      setPackagesError(
        getApiErrorMessage(
          error,
          'Impossible de charger les packs de ce client.',
        ),
      );
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  const handleLoadPackages = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadPackages(packageClientId);
  };

  const handleAssignPackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAssignError(null);
    setAssignSuccess(null);

    const clientId = assignForm.clientId.trim();
    const totalSessions = Number(assignForm.totalSessions);

    if (!clientId) {
      setAssignError("Saisissez l'identifiant du client.");
      return;
    }

    if (!assignForm.careServiceId) {
      setAssignError('Sélectionnez un pack à attribuer.');
      return;
    }

    if (
      !Number.isInteger(totalSessions) ||
      totalSessions < 1 ||
      totalSessions > 365
    ) {
      setAssignError(
        'Le nombre de séances doit être un entier compris entre 1 et 365.',
      );
      return;
    }

    setAssignLoading(true);

    try {
      const { data } = await careAPI.assignPackage({
        clientId,
        careServiceId: assignForm.careServiceId,
        totalSessions,
      });
      const pack = servicesById.get(data.careServiceId);

      setAssignSuccess(
        `Pack${pack ? ` « ${pack.title} »` : ''} attribué à ${clientId} — ${data.totalSessions} séances créditées.`,
      );
      setAssignForm((previous) => ({
        ...previous,
        careServiceId: '',
        totalSessions: '10',
      }));
      setPackageClientId(clientId);
      await loadPackages(clientId);
    } catch (error) {
      setAssignError(
        getApiErrorMessage(error, "Impossible d'attribuer ce pack."),
      );
    } finally {
      setAssignLoading(false);
    }
  };

  const loadHistory = useCallback(
    async (mode: HistoryMode, rawId: string) => {
      const id = rawId.trim();

      if (!id) {
        setHistoryError(
          mode === 'therapist'
            ? "Saisissez l'identifiant du praticien."
            : "Saisissez l'identifiant du client.",
        );
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const { data } =
          mode === 'therapist'
            ? await careAPI.getSessionsByTherapist(id)
            : await careAPI.getSessionsByClient(id);

        setSessions(data);
        setHistoryLoadedFor({ mode, id });
      } catch (error) {
        setSessions([]);
        setHistoryLoadedFor(null);
        setHistoryError(
          getApiErrorMessage(
            error,
            "Impossible de charger l'historique des séances.",
          ),
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [],
  );

  const handleSearchHistory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadHistory(historyMode, historyId);
  };

  const handleHistoryModeChange = (mode: HistoryMode) => {
    setHistoryMode(mode);
    setSessions([]);
    setHistoryLoadedFor(null);
    setHistoryError(null);
  };

  const handleConsumeSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConsumeError(null);
    setConsumeResult(null);

    const clientId = consumeForm.clientId.trim();
    const therapistId = consumeForm.therapistId.trim();

    if (!clientId) {
      setConsumeError("Saisissez l'identifiant du client.");
      return;
    }

    if (!consumeForm.careServiceId) {
      setConsumeError('Sélectionnez le pack consommé.');
      return;
    }

    if (!therapistId) {
      setConsumeError("Saisissez l'identifiant du praticien.");
      return;
    }

    let timestamp: string | undefined;

    if (consumeForm.timestamp) {
      const parsed = new Date(consumeForm.timestamp);

      if (Number.isNaN(parsed.getTime())) {
        setConsumeError('La date de la séance est invalide.');
        return;
      }

      timestamp = parsed.toISOString();
    }

    setConsumeLoading(true);

    try {
      const { data } = await careAPI.consumeSession({
        clientId,
        careServiceId: consumeForm.careServiceId,
        therapistId,
        timestamp,
        notes: consumeForm.notes.trim() || undefined,
      });

      setConsumeResult(data);
      setConsumeForm((previous) => ({
        ...previous,
        timestamp: '',
        notes: '',
      }));

      if (packagesLoadedFor === clientId) {
        void loadPackages(clientId);
      }

      setHistoryMode('therapist');
      setHistoryId(therapistId);
      void loadHistory('therapist', therapistId);
    } catch (error) {
      setConsumeError(
        getApiErrorMessage(
          error,
          'Impossible de valider cette séance (pack absent ou épuisé ?).',
        ),
      );
    } finally {
      setConsumeLoading(false);
    }
  };

  const prepareAssignment = (careServiceId: string) => {
    setAssignForm((previous) => ({ ...previous, careServiceId }));
    setAssignError(null);
    setAssignSuccess(null);
    setActiveTab('packages');
  };

  const prepareConsumption = (pack: ClientCarePackage) => {
    setConsumeForm((previous) => ({
      ...previous,
      clientId: pack.clientId,
      careServiceId: pack.careServiceId,
    }));
    setConsumeError(null);
    setConsumeResult(null);
    setActiveTab('sessions');
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-purple-500/20 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30">
            <Stethoscope size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content sm:text-3xl">
              Soins & Thérapies
            </h1>
            <p className="text-sm text-content-muted">
              Catalogue, packs multi-séances, consommation et historique par
              praticien.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchServices()}
          disabled={servicesLoading}
          icon={
            <RefreshCw
              size={15}
              className={servicesLoading ? 'animate-spin' : undefined}
            />
          }
        >
          Actualiser
        </Button>
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
            {tab.id === 'catalogue' && services.length > 0 && (
              <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content">
                {services.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===================== ONGLET CATALOGUE ===================== */}
      {activeTab === 'catalogue' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-dense>
            <StatCard
              label="Catalogue"
              value={services.length}
              hint="prestations disponibles"
              icon={<Sparkles size={22} />}
              tone="brand"
            />
            <StatCard
              label="Soins unitaires"
              value={unitServices.length}
              hint="à la séance"
              icon={<Stethoscope size={22} />}
              tone="brand"
            />
            <StatCard
              label="Packs"
              value={packServices.length}
              hint="multi-séances"
              icon={<Layers size={22} />}
              tone="purple"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
            {/* Liste */}
            <div className="xl:col-span-8">
              <Card className="h-full">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-content">
                      Catalogue des soins
                    </h2>
                    <p className="text-xs text-content-subtle">
                      Sauna, laser, massages, soins ciblés et packs.
                    </p>
                  </div>
                  <Badge variant="default">
                    {filteredServices.length} résultat
                    {filteredServices.length > 1 ? 's' : ''}
                  </Badge>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                    />
                    <Input
                      value={serviceSearch}
                      onChange={(event) => setServiceSearch(event.target.value)}
                      placeholder="Rechercher un soin..."
                      className="pl-9"
                    />
                  </div>
                  <select
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(
                        event.target.value as 'ALL' | CareServiceType,
                      )
                    }
                    className={`${SELECT_CLASSES} sm:w-48`}
                    aria-label="Filtrer par type de prestation"
                  >
                    <option value="ALL">Tous les types</option>
                    <option value="UNITAIRE">Soins unitaires</option>
                    <option value="PACK">Packs</option>
                  </select>
                </div>

                <div className="mt-4 space-y-3">
                  {servicesLoading && services.length === 0 && (
                    <div className="space-y-3">
                      {[0, 1, 2].map((index) => (
                        <div
                          key={index}
                          className="h-24 animate-pulse rounded-lg bg-surface-raised"
                        />
                      ))}
                    </div>
                  )}

                  {servicesError && (
                    <Notice tone="error">{servicesError}</Notice>
                  )}

                  {!servicesLoading &&
                    !servicesError &&
                    filteredServices.length === 0 && (
                      <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
                        <Sparkles
                          size={24}
                          className="mx-auto mb-2 text-content-subtle"
                        />
                        <p className="text-sm text-content-muted">
                          Aucun soin ne correspond à votre recherche.
                        </p>
                        <p className="mt-1 text-xs text-content-subtle">
                          Ajoutez une prestation depuis le formulaire à droite.
                        </p>
                      </div>
                    )}

                  {filteredServices.map((service) => {
                    const isPack = service.type === 'PACK';

                    return (
                      <div
                        key={service.id}
                        className="rounded-lg border border-line bg-surface-raised/40 p-4 transition-colors hover:border-line-strong"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <div
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                                isPack
                                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                                  : 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                              }`}
                            >
                              {isPack ? (
                                <Layers size={20} />
                              ) : (
                                <Sparkles size={20} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-medium text-content">
                                  {service.title}
                                </h3>
                                <Badge
                                  variant="default"
                                  className={
                                    isPack
                                      ? 'border border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300'
                                      : 'border border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                                  }
                                >
                                  {CARE_TYPE_LABELS[service.type]}
                                </Badge>
                              </div>
                              {service.description ? (
                                <p className="mt-1 text-sm text-content-muted">
                                  {service.description}
                                </p>
                              ) : (
                                <p className="mt-1 text-sm italic text-content-subtle">
                                  Aucune description
                                </p>
                              )}
                              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-content-muted">
                                <span className="inline-flex items-center gap-1.5">
                                  <Clock size={14} className="text-content-subtle" />
                                  {formatDuration(service.durationMinutes)}
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <Coins size={14} className="text-content-subtle" />
                                  {formatCurrency(service.price)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {isPack && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => prepareAssignment(service.id)}
                              icon={<Package size={14} />}
                            >
                              Attribuer
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            {/* Formulaire */}
            <div className="xl:col-span-4">
              <Card>
                <div className="mb-5 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                    <Plus size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-content">
                      Nouvelle prestation
                    </h2>
                    <p className="text-xs text-content-subtle">
                      Soin unitaire ou pack multi-séances.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleCreateService} className="space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="care-title"
                      className="text-xs font-medium text-content-muted"
                    >
                      Titre *
                    </label>
                    <Input
                      id="care-title"
                      value={newService.title}
                      onChange={(event) =>
                        setNewService((previous) => ({
                          ...previous,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Ex : Massage relaxant 60 min"
                      minLength={2}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="care-description"
                      className="text-xs font-medium text-content-muted"
                    >
                      Description
                    </label>
                    <textarea
                      id="care-description"
                      rows={3}
                      value={newService.description}
                      onChange={(event) =>
                        setNewService((previous) => ({
                          ...previous,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Bienfaits, protocole, contre-indications..."
                      className={TEXTAREA_CLASSES}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label
                        htmlFor="care-duration"
                        className="text-xs font-medium text-content-muted"
                      >
                        Durée (min) *
                      </label>
                      <Input
                        id="care-duration"
                        type="number"
                        min={1}
                        max={600}
                        step={5}
                        value={newService.durationMinutes}
                        onChange={(event) =>
                          setNewService((previous) => ({
                            ...previous,
                            durationMinutes: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="care-price"
                        className="text-xs font-medium text-content-muted"
                      >
                        Tarif (€) *
                      </label>
                      <Input
                        id="care-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={newService.price}
                        onChange={(event) =>
                          setNewService((previous) => ({
                            ...previous,
                            price: event.target.value,
                          }))
                        }
                        placeholder="0.00"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs font-medium text-content-muted">
                      Type de prestation *
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(CARE_TYPE_LABELS) as CareServiceType[]).map(
                        (type) => {
                          const selected = newService.type === type;

                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() =>
                                setNewService((previous) => ({
                                  ...previous,
                                  type,
                                }))
                              }
                              className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                                selected
                                  ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                                  : 'border-line-strong bg-surface-raised/50 text-content-muted hover:border-line-strong'
                              }`}
                            >
                              <span className="flex items-center gap-2 text-sm font-medium">
                                {type === 'PACK' ? (
                                  <Layers size={15} />
                                ) : (
                                  <Sparkles size={15} />
                                )}
                                {CARE_TYPE_LABELS[type]}
                              </span>
                              <span className="text-[11px] leading-tight">
                                {type === 'PACK'
                                  ? 'Lot de séances à créditer'
                                  : "Prestation à l'unité"}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>

                  {formError && <Notice tone="error">{formError}</Notice>}
                  {formSuccess && <Notice tone="success">{formSuccess}</Notice>}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={formLoading}
                    icon={
                      formLoading ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <Plus size={16} />
                      )
                    }
                  >
                    {formLoading ? 'Ajout en cours...' : 'Ajouter au catalogue'}
                  </Button>
                </form>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ===================== ONGLET PACKS ===================== */}
      {activeTab === 'packages' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          {/* Attribution */}
          <div className="xl:col-span-5">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-700 dark:text-purple-300">
                  <Package size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Attribuer un pack
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Créez un crédit de séances pour un client.
                  </p>
                </div>
              </div>

              <form onSubmit={handleAssignPackage} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="assign-client"
                    className="text-xs font-medium text-content-muted"
                  >
                    Identifiant client *
                  </label>
                  <Input
                    id="assign-client"
                    value={assignForm.clientId}
                    onChange={(event) =>
                      setAssignForm((previous) => ({
                        ...previous,
                        clientId: event.target.value,
                      }))
                    }
                    placeholder="Ex : client-001"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="assign-pack"
                    className="text-xs font-medium text-content-muted"
                  >
                    Pack à attribuer *
                  </label>
                  {packServices.length === 0 ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      Aucun pack au catalogue. Créez d'abord une prestation de
                      type « Pack ».
                      <button
                        type="button"
                        onClick={() => setActiveTab('catalogue')}
                        className="mt-2 flex items-center gap-1 font-medium text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                      >
                        Aller au catalogue <ArrowRight size={13} />
                      </button>
                    </div>
                  ) : (
                    <select
                      id="assign-pack"
                      value={assignForm.careServiceId}
                      onChange={(event) =>
                        setAssignForm((previous) => ({
                          ...previous,
                          careServiceId: event.target.value,
                        }))
                      }
                      className={SELECT_CLASSES}
                      required
                    >
                      <option value="">Sélectionner un pack...</option>
                      {packServices.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.title} — {formatCurrency(pack.price)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="assign-sessions"
                    className="text-xs font-medium text-content-muted"
                  >
                    Nombre de séances *
                  </label>
                  <Input
                    id="assign-sessions"
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={assignForm.totalSessions}
                    onChange={(event) =>
                      setAssignForm((previous) => ({
                        ...previous,
                        totalSessions: event.target.value,
                      }))
                    }
                    required
                  />
                </div>

                {assignError && <Notice tone="error">{assignError}</Notice>}
                {assignSuccess && (
                  <Notice tone="success">{assignSuccess}</Notice>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={assignLoading || packServices.length === 0}
                  icon={
                    assignLoading ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Package size={16} />
                    )
                  }
                >
                  {assignLoading ? 'Attribution...' : 'Attribuer le pack'}
                </Button>
              </form>
            </Card>

            <div className="mt-4 flex gap-2 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={15} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                Le solde est crédité immédiatement. Il est décrémenté à chaque
                séance validée dans l'onglet « Consommation & Historique ».
              </p>
            </div>
          </div>

          {/* Portefeuille */}
          <div className="xl:col-span-7">
            <Card className="h-full">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-content">
                    Portefeuille client
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Vérifiez les packs, le solde et les crédits restants.
                  </p>
                </div>
                {packagesLoadedFor && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadPackages(packagesLoadedFor)}
                    disabled={packagesLoading}
                    icon={
                      <RefreshCw
                        size={14}
                        className={packagesLoading ? 'animate-spin' : undefined}
                      />
                    }
                  >
                    Actualiser
                  </Button>
                )}
              </div>

              <form onSubmit={handleLoadPackages} className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                  />
                  <Input
                    value={packageClientId}
                    onChange={(event) => setPackageClientId(event.target.value)}
                    placeholder="ID du client à consulter..."
                    className="pl-9"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={packagesLoading}
                  icon={
                    packagesLoading ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )
                  }
                >
                  Vérifier
                </Button>
              </form>

              {packagesError && (
                <div className="mt-4">
                  <Notice tone="error">{packagesError}</Notice>
                </div>
              )}

              {packagesLoadedFor && !packagesError && (
                <>
                  <div className="mt-5 flex items-center justify-between">
                    <div className="text-sm text-content-muted">
                      Client{' '}
                      <span className="font-mono text-content">
                        {packagesLoadedFor}
                      </span>
                    </div>
                    <Badge variant="default">
                      {packages.length} pack{packages.length > 1 ? 's' : ''}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-line bg-surface-raised/40 p-4">
                      <div className="text-xs text-content-subtle">Packs actifs</div>
                      <div className="text-2xl font-semibold text-content">
                        {activePackages.length}
                      </div>
                    </div>
                    <div className="rounded-lg border border-line bg-surface-raised/40 p-4">
                      <div className="text-xs text-content-subtle">
                        Crédits restants
                      </div>
                      <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                        {totalCredits}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!packagesLoadedFor && !packagesError && !packagesLoading && (
                <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-10 text-center">
                  <Package size={24} className="mx-auto mb-2 text-content-subtle" />
                  <p className="text-sm text-content-muted">
                    Recherchez un client pour afficher ses crédits.
                  </p>
                  <p className="mt-1 text-xs text-content-subtle">
                    Le détail de chaque pack apparaîtra ici.
                  </p>
                </div>
              )}

              {packagesLoading && packages.length === 0 && (
                <div className="mt-5 space-y-3">
                  {[0, 1].map((index) => (
                    <div
                      key={index}
                      className="h-28 animate-pulse rounded-lg bg-surface-raised"
                    />
                  ))}
                </div>
              )}

              {packagesLoadedFor && packages.length === 0 && !packagesLoading && (
                <div className="mt-5 rounded-lg border border-dashed border-line px-6 py-8 text-center">
                  <p className="text-sm text-content-muted">
                    Aucun pack attribué à ce client.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignForm((previous) => ({
                        ...previous,
                        clientId: packagesLoadedFor,
                      }));
                    }}
                    className="mt-2 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    Préparer une attribution
                  </button>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {packages.map((pack) => {
                  const service = servicesById.get(pack.careServiceId);
                  const consumed = pack.totalSessions - pack.remainingSessions;
                  const percent =
                    pack.totalSessions > 0
                      ? Math.min(
                          100,
                          Math.round((consumed / pack.totalSessions) * 100),
                        )
                      : 0;
                  const status = PACKAGE_STATUS_META[pack.status];

                  return (
                    <div
                      key={pack.id}
                      className="rounded-lg border border-line bg-surface-raised/40 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-content">
                            {service?.title ?? 'Prestation supprimée'}
                          </div>
                          <div className="mt-0.5 text-xs text-content-subtle">
                            Pack #{pack.id.slice(0, 8)} · attribué le{' '}
                            {formatDate(pack.createdAt)}
                          </div>
                        </div>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-content-muted">
                          <span className="font-semibold text-content">
                            {pack.remainingSessions}
                          </span>{' '}
                          / {pack.totalSessions} séances restantes
                        </span>
                        <span className="text-content-subtle">
                          {percent}% consommé
                        </span>
                      </div>

                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-overlay">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pack.status === 'ACTIF'
                              ? 'bg-brand-500'
                              : 'bg-surface-strong'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      {pack.status === 'ACTIF' &&
                        pack.remainingSessions > 0 && (
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => prepareConsumption(pack)}
                              icon={<ArrowRight size={14} />}
                            >
                              Consommer une séance
                            </Button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ===================== ONGLET CONSOMMATION ===================== */}
      {activeTab === 'sessions' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          {/* Validation */}
          <div className="xl:col-span-5">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Valider une séance
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Décrémente automatiquement le pack du client.
                  </p>
                </div>
              </div>

              <form onSubmit={handleConsumeSession} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="consume-client"
                    className="text-xs font-medium text-content-muted"
                  >
                    Identifiant client *
                  </label>
                  <Input
                    id="consume-client"
                    value={consumeForm.clientId}
                    onChange={(event) =>
                      setConsumeForm((previous) => ({
                        ...previous,
                        clientId: event.target.value,
                      }))
                    }
                    placeholder="Ex : client-001"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="consume-service"
                    className="text-xs font-medium text-content-muted"
                  >
                    Pack consommé *
                  </label>
                  {packServices.length === 0 ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      Aucun pack au catalogue. Créez un pack puis attribuez-le à
                      un client.
                    </div>
                  ) : (
                    <select
                      id="consume-service"
                      value={consumeForm.careServiceId}
                      onChange={(event) =>
                        setConsumeForm((previous) => ({
                          ...previous,
                          careServiceId: event.target.value,
                        }))
                      }
                      className={SELECT_CLASSES}
                      required
                    >
                      <option value="">Sélectionner le pack...</option>
                      {packServices.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="consume-therapist"
                    className="text-xs font-medium text-content-muted"
                  >
                    Identifiant praticien *
                  </label>
                  <Input
                    id="consume-therapist"
                    value={consumeForm.therapistId}
                    onChange={(event) =>
                      setConsumeForm((previous) => ({
                        ...previous,
                        therapistId: event.target.value,
                      }))
                    }
                    placeholder="Ex : therapist-001"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="consume-date"
                    className="text-xs font-medium text-content-muted"
                  >
                    Date de la séance
                  </label>
                  <Input
                    id="consume-date"
                    type="datetime-local"
                    value={consumeForm.timestamp}
                    onChange={(event) =>
                      setConsumeForm((previous) => ({
                        ...previous,
                        timestamp: event.target.value,
                      }))
                    }
                  />
                  <p className="text-[11px] text-content-subtle">
                    Laissez vide pour utiliser la date et l'heure actuelles.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="consume-notes"
                    className="text-xs font-medium text-content-muted"
                  >
                    Notes
                  </label>
                  <textarea
                    id="consume-notes"
                    rows={3}
                    value={consumeForm.notes}
                    onChange={(event) =>
                      setConsumeForm((previous) => ({
                        ...previous,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Observations, zone traitée, réactions..."
                    className={TEXTAREA_CLASSES}
                  />
                </div>

                {consumeError && <Notice tone="error">{consumeError}</Notice>}

                {consumeResult && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 size={17} />
                      Séance enregistrée
                    </div>
                    <div className="mt-1 text-xs text-content-muted">
                      {servicesById.get(consumeResult.session.careServiceId)
                        ?.title ?? 'Soin'}
                      {' · '}
                      {consumeResult.session.clientId}
                      {' · '}
                      {formatDate(consumeResult.session.timestamp)}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-content-muted">Solde restant</div>
                        <div className="text-lg font-semibold text-content">
                          {consumeResult.remainingSessions} séance
                          {consumeResult.remainingSessions > 1 ? 's' : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-content-muted">Pack</div>
                        <div className="font-mono text-content">
                          #{consumeResult.packageId.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={consumeLoading || packServices.length === 0}
                  icon={
                    consumeLoading ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )
                  }
                >
                  {consumeLoading ? 'Validation...' : 'Valider la séance'}
                </Button>
              </form>
            </Card>
          </div>

          {/* Historique */}
          <div className="xl:col-span-7">
            <Card className="h-full">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-content">
                    Historique des séances
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Consultez les séances par praticien ou par client.
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-line bg-surface-raised/50 p-1">
                  <button
                    type="button"
                    onClick={() => handleHistoryModeChange('therapist')}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      historyMode === 'therapist'
                        ? 'bg-surface-overlay text-content'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    <Stethoscope size={14} />
                    Par praticien
                  </button>
                  <button
                    type="button"
                    onClick={() => handleHistoryModeChange('client')}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      historyMode === 'client'
                        ? 'bg-surface-overlay text-content'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    <UserRound size={14} />
                    Par client
                  </button>
                </div>
              </div>

              <form onSubmit={handleSearchHistory} className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                  />
                  <Input
                    value={historyId}
                    onChange={(event) => setHistoryId(event.target.value)}
                    placeholder={
                      historyMode === 'therapist'
                        ? 'ID du praticien...'
                        : 'ID du client...'
                    }
                    className="pl-9"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={historyLoading}
                  icon={
                    historyLoading ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )
                  }
                >
                  Rechercher
                </Button>
              </form>

              {historyError && (
                <div className="mt-4">
                  <Notice tone="error">{historyError}</Notice>
                </div>
              )}

              {historyLoadedFor && !historyError && (
                <div className="mt-4 flex items-center justify-between text-xs text-content-subtle">
                  <span>
                    {sessions.length} séance{sessions.length > 1 ? 's' : ''}{' '}
                    pour{' '}
                    <span className="font-mono text-content">
                      {historyLoadedFor.id}
                    </span>
                  </span>
                  <Badge variant="default">
                    {historyLoadedFor.mode === 'therapist'
                      ? 'Praticien'
                      : 'Client'}
                  </Badge>
                </div>
              )}

              {!historyLoadedFor && !historyError && (
                <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-10 text-center">
                  <History size={24} className="mx-auto mb-2 text-content-subtle" />
                  <p className="text-sm text-content-muted">
                    Renseignez un identifiant pour afficher l'historique.
                  </p>
                  <p className="mt-1 text-xs text-content-subtle">
                    Les séances les plus récentes apparaissent en premier.
                  </p>
                </div>
              )}

              {historyLoading && sessions.length === 0 && (
                <div className="mt-5 space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="h-12 animate-pulse rounded-lg bg-surface-raised"
                    />
                  ))}
                </div>
              )}

              {historyLoadedFor && sessions.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-content-subtle">
                        <th className="pb-2 pr-3 font-medium">Date</th>
                        <th className="pb-2 pr-3 font-medium">Soin</th>
                        <th className="pb-2 pr-3 font-medium">Pack</th>
                        <th className="pb-2 pr-3 font-medium">
                          {historyMode === 'therapist' ? 'Client' : 'Praticien'}
                        </th>
                        <th className="pb-2 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => (
                        <tr
                          key={session.id}
                          className="border-b border-line/60"
                        >
                          <td className="py-3 pr-3 text-content">
                            {formatDate(session.timestamp)}
                          </td>
                          <td className="py-3 pr-3 text-content">
                            {servicesById.get(session.careServiceId)?.title ??
                              'Soin inconnu'}
                          </td>
                          <td className="py-3 pr-3 font-mono text-xs text-content-muted">
                            {session.packageId
                              ? `#${session.packageId.slice(0, 8)}`
                              : '—'}
                          </td>
                          <td className="py-3 pr-3 font-mono text-xs text-content-muted">
                            {historyMode === 'therapist'
                              ? session.clientId
                              : session.therapistId}
                          </td>
                          <td
                            className="max-w-[220px] truncate py-3 text-xs text-content-subtle"
                            title={session.notes ?? undefined}
                          >
                            {session.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {historyLoadedFor &&
                sessions.length === 0 &&
                !historyLoading && (
                  <div className="mt-5 rounded-lg border border-dashed border-line px-6 py-8 text-center">
                    <p className="text-sm text-content-muted">
                      Aucune séance enregistrée pour cet identifiant.
                    </p>
                  </div>
                )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
