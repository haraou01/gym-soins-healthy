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
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Dumbbell,
  Hammer,
  HeartPulse,
  History,
  Info,
  MapPin,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Sparkles,
  UserRound,
  Wrench,
  XCircle,
} from 'lucide-react';

import { Badge, Button, Card, Input, Notice, StatCard } from '@/components/ui';
import { maintenanceAPI } from '@/api';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, getApiErrorMessage } from '@/lib/utils';
import type {
  CreateEquipmentInput,
  Equipment,
  EquipmentCategory,
  EquipmentStatus,
  MaintenanceCostSummary,
  MaintenancePriority,
  MaintenanceTicket,
  MaintenanceTicketStatus,
  MaintenanceTicketType,
  UpdateTicketInput,
} from '@/types';

type MaintenanceTab = 'inventory' | 'incidents' | 'history';
type IncidentMode = 'corrective' | 'preventive';
type StatusFilter = 'ALL' | EquipmentStatus;
type TicketStatusFilter = 'ALL' | MaintenanceTicketStatus;
type TicketTypeFilter = 'ALL' | MaintenanceTicketType;

interface EquipmentFormState {
  name: string;
  serialNumber: string;
  category: EquipmentCategory;
  location: string;
  supplier: string;
  purchaseDate: string;
  warrantyEndDate: string;
  usageCount: string;
  runningHours: string;
  preventiveIntervalDays: string;
  preventiveUsageThreshold: string;
  preventiveRunningHoursThreshold: string;
}

interface IncidentFormState {
  equipmentId: string;
  description: string;
  priority: MaintenancePriority;
  scheduledAt: string;
  technician: string;
}

interface TicketEditFormState {
  status: MaintenanceTicketStatus;
  technician: string;
  partsReplaced: string;
  cost: string;
  scheduledAt: string;
}

const EQUIPMENT_STATUS_META: Record<
  EquipmentStatus,
  { label: string; variant: 'success' | 'warning' | 'danger'; icon: ReactNode; classes: string }
> = {
  ACTIF: {
    label: 'Actif',
    variant: 'success',
    icon: <CheckCircle2 size={14} />,
    classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  EN_MAINTENANCE: {
    label: 'Maintenance',
    variant: 'warning',
    icon: <Wrench size={14} />,
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  },
  EN_PANNE: {
    label: 'En panne',
    variant: 'danger',
    icon: <AlertTriangle size={14} />,
    classes: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300',
  },
};

const EQUIPMENT_CATEGORY_META: Record<
  EquipmentCategory,
  { label: string; icon: ReactNode; classes: string }
> = {
  CARDIO: {
    label: 'Cardio',
    icon: <HeartPulse size={20} />,
    classes: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  },
  MUSCULATION: {
    label: 'Musculation',
    icon: <Dumbbell size={20} />,
    classes: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
  },
  FUNCTIONAL: {
    label: 'Fonctionnel',
    icon: <Activity size={20} />,
    classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  },
  CABINE_SOIN: {
    label: 'Cabine de soin',
    icon: <Sparkles size={20} />,
    classes: 'bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/20',
  },
  TOURNQUIET: {
    label: 'Tourniquet',
    icon: <RotateCw size={20} />,
    classes: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20',
  },
};

const PRIORITY_META: Record<
  MaintenancePriority,
  { label: string; variant: 'default' | 'warning' | 'danger' }
> = {
  BASSE: { label: 'Basse', variant: 'default' },
  MOYENNE: { label: 'Moyenne', variant: 'warning' },
  URGENTE: { label: 'Urgente', variant: 'danger' },
};

const TICKET_STATUS_META: Record<
  MaintenanceTicketStatus,
  { label: string; variant: 'warning' | 'default' | 'success'; icon: ReactNode }
> = {
  OUVERT: {
    label: 'Ouvert',
    variant: 'warning',
    icon: <AlertTriangle size={14} />,
  },
  EN_COURS: {
    label: 'En cours',
    variant: 'default',
    icon: <Hammer size={14} />,
  },
  RESOLU: {
    label: 'Résolu',
    variant: 'success',
    icon: <ClipboardCheck size={14} />,
  },
};

const TICKET_TYPE_META: Record<
  MaintenanceTicketType,
  { label: string; classes: string }
> = {
  CORRECTIF: {
    label: 'Correctif',
    classes: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300',
  },
  PREVENTIF: {
    label: 'Préventif',
    classes: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
};

const TABS: { id: MaintenanceTab; label: string; icon: ReactNode }[] = [
  { id: 'inventory', label: 'Inventaire & État', icon: <Package size={16} /> },
  { id: 'incidents', label: 'Signalement & Incidents', icon: <AlertTriangle size={16} /> },
  { id: 'history', label: 'Historique & Coûts', icon: <History size={16} /> },
];

const SELECT_CLASSES =
  'h-10 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-content placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-brand-500';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function parseDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d);
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = parseDate(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d);
}

function formatWarranty(value?: string | null): { label: string; expired: boolean } {
  if (!value) return { label: 'Non renseignée', expired: false };
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return { label: 'Invalide', expired: false };
  const expired = d.getTime() < Date.now();
  return {
    label: expired ? `Expirée le ${dateFormatter.format(d)}` : `Jusqu'au ${dateFormatter.format(d)}`,
    expired,
  };
}

const pad = (v: number) => String(v).padStart(2, '0');

function toDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextPreventiveSlot(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toDateTimeLocal(date);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function createEmptyEquipmentForm(): EquipmentFormState {
  return {
    name: '',
    serialNumber: '',
    category: 'CARDIO',
    location: '',
    supplier: '',
    purchaseDate: '',
    warrantyEndDate: '',
    usageCount: '0',
    runningHours: '0',
    preventiveIntervalDays: '90',
    preventiveUsageThreshold: '',
    preventiveRunningHoursThreshold: '',
  };
}

export default function MaintenancePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MaintenanceTab>('inventory');

  /* -------------------------- Données globales ------------------------- */
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [costSummary, setCostSummary] = useState<MaintenanceCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [eqRes, tkRes, sumRes] = await Promise.all([
        maintenanceAPI.getEquipments(),
        maintenanceAPI.getTickets(),
        maintenanceAPI.getCostSummary(),
      ]);
      setEquipments(eqRes.data);
      setTickets(tkRes.data);
      setCostSummary(sumRes.data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Impossible de charger les données de maintenance.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const equipmentById = useMemo(() => new Map(equipments.map((e) => [e.id, e])), [equipments]);
  const activeCount = equipments.filter((e) => e.status === 'ACTIF').length;
  const brokenCount = equipments.filter((e) => e.status === 'EN_PANNE').length;
  const maintenanceCount = equipments.filter((e) => e.status === 'EN_MAINTENANCE').length;
  const openTickets = useMemo(() => tickets.filter((t) => t.status !== 'RESOLU'), [tickets]);
  const totalCost = costSummary?.totalCost ?? tickets.reduce((sum, t) => sum + (Number(t.cost) || 0), 0);

  const hasOpenTicket = (equipmentId: string) =>
    tickets.some((t) => t.equipmentId === equipmentId && t.status !== 'RESOLU');

  /* ----------------------------- Inventaire ---------------------------- */
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<StatusFilter>('ALL');
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState<'ALL' | EquipmentCategory>('ALL');
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [equipmentFormError, setEquipmentFormError] = useState<string | null>(null);
  const [equipmentFormSuccess, setEquipmentFormSuccess] = useState<string | null>(null);
  const [equipmentForm, setEquipmentForm] = useState<EquipmentFormState>(createEmptyEquipmentForm);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [inventoryActionError, setInventoryActionError] = useState<string | null>(null);
  const [inventoryActionSuccess, setInventoryActionSuccess] = useState<string | null>(null);

  const filteredEquipments = useMemo(() => {
    const search = inventorySearch.trim().toLowerCase();
    return equipments.filter((e) => {
      const matchesSearch =
        !search ||
        [e.name, e.serialNumber, e.location, e.supplier || ''].some((v) =>
          v.toLowerCase().includes(search),
        );
      const matchesStatus = inventoryStatusFilter === 'ALL' || e.status === inventoryStatusFilter;
      const matchesCategory =
        inventoryCategoryFilter === 'ALL' || e.category === inventoryCategoryFilter;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [equipments, inventorySearch, inventoryStatusFilter, inventoryCategoryFilter]);

  const updateEquipmentForm = (patch: Partial<EquipmentFormState>) => {
    setEquipmentForm((prev) => ({ ...prev, ...patch }));
    setEquipmentFormError(null);
    setEquipmentFormSuccess(null);
  };

  const handleCreateEquipment = async (e: FormEvent) => {
    e.preventDefault();
    setEquipmentFormError(null);
    setEquipmentFormSuccess(null);

    const name = equipmentForm.name.trim();
    const serialNumber = equipmentForm.serialNumber.trim();
    const location = equipmentForm.location.trim();

    if (!name || !serialNumber || !location) {
      setEquipmentFormError('Veuillez renseigner le nom, le numéro de série et l’emplacement.');
      return;
    }

    const usageCount = Number(equipmentForm.usageCount);
    const runningHours = Number(equipmentForm.runningHours);

    if (!Number.isInteger(usageCount) || usageCount < 0) {
      setEquipmentFormError('Le nombre d’utilisations doit être un entier positif.');
      return;
    }
    if (!Number.isInteger(runningHours) || runningHours < 0) {
      setEquipmentFormError('Le nombre d’heures de fonctionnement doit être un entier positif.');
      return;
    }

    const parseOptionalPositiveInt = (value: string): number | undefined | null => {
      if (!value.trim()) return undefined;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };

    const preventiveIntervalDays = parseOptionalPositiveInt(
      equipmentForm.preventiveIntervalDays,
    );
    const preventiveUsageThreshold = parseOptionalPositiveInt(
      equipmentForm.preventiveUsageThreshold,
    );
    const preventiveRunningHoursThreshold = parseOptionalPositiveInt(
      equipmentForm.preventiveRunningHoursThreshold,
    );

    if (
      preventiveIntervalDays === null ||
      preventiveUsageThreshold === null ||
      preventiveRunningHoursThreshold === null
    ) {
      setEquipmentFormError(
        'Les seuils préventifs doivent être des entiers strictement positifs.',
      );
      return;
    }

    setEquipmentSaving(true);
    try {
      const payload: CreateEquipmentInput = {
        name,
        serialNumber,
        category: equipmentForm.category,
        location,
        supplier: equipmentForm.supplier.trim() || undefined,
        purchaseDate: equipmentForm.purchaseDate || undefined,
        warrantyEndDate: equipmentForm.warrantyEndDate || undefined,
        usageCount,
        runningHours,
        preventiveIntervalDays,
        preventiveUsageThreshold,
        preventiveRunningHoursThreshold,
      };

      const { data } = await maintenanceAPI.createEquipment(payload);
      setEquipments((prev) => [data, ...prev]);
      setEquipmentForm(createEmptyEquipmentForm());
      setEquipmentFormSuccess(`« ${data.name} » a été ajouté à l’inventaire.`);
    } catch (error) {
      setEquipmentFormError(getApiErrorMessage(error, 'Impossible de créer cet équipement.'));
    } finally {
      setEquipmentSaving(false);
    }
  };

  const handleRestoreEquipment = async (equipment: Equipment) => {
    setStatusSavingId(equipment.id);
    setInventoryActionError(null);
    setInventoryActionSuccess(null);
    try {
      const { data } = await maintenanceAPI.updateEquipment(equipment.id, { status: 'ACTIF' });
      setEquipments((prev) => prev.map((e) => (e.id === data.id ? data : e)));
      setInventoryActionSuccess(`« ${data.name} » est de nouveau opérationnel.`);
    } catch (error) {
      setInventoryActionError(getApiErrorMessage(error, 'Échec de la remise en service.'));
    } finally {
      setStatusSavingId(null);
    }
  };

  const handleRecordUsage = async (equipment: Equipment) => {
    setStatusSavingId(equipment.id);
    setInventoryActionError(null);
    setInventoryActionSuccess(null);
    try {
      const { data } = await maintenanceAPI.recordUsage(equipment.id, {
        usageIncrement: 1,
        reportedByUserId: user?.id || user?.email || 'SYSTEM',
      });

      setEquipments((prev) =>
        prev.map((item) => (item.id === data.equipment.id ? data.equipment : item)),
      );

      setInventoryActionSuccess(
        data.preventiveTicket
          ? `Utilisation enregistrée. Une maintenance préventive a été ouverte automatiquement pour « ${data.equipment.name} ».`
          : `Utilisation enregistrée pour « ${data.equipment.name} ».`,
      );

      if (data.preventiveTicket) {
        void fetchAll();
      }
    } catch (error) {
      setInventoryActionError(
        getApiErrorMessage(error, "Impossible d'enregistrer cette utilisation."),
      );
    } finally {
      setStatusSavingId(null);
    }
  };

  /* ----------------------------- Incidents ----------------------------- */
  const [incidentMode, setIncidentMode] = useState<IncidentMode>('corrective');
  const [incidentForm, setIncidentForm] = useState<IncidentFormState>({
    equipmentId: '',
    description: '',
    priority: 'MOYENNE',
    scheduledAt: nextPreventiveSlot(),
    technician: '',
  });
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentSuccess, setIncidentSuccess] = useState<string | null>(null);

  const startIncidentFor = (equipmentId: string, mode: IncidentMode) => {
    setIncidentMode(mode);
    setIncidentForm((prev) => ({
      ...prev,
      equipmentId,
      description: '',
      priority: mode === 'corrective' ? 'MOYENNE' : 'BASSE',
      technician: mode === 'preventive' ? prev.technician : '',
    }));
    setIncidentError(null);
    setIncidentSuccess(null);
    setActiveTab('incidents');
  };

  const updateIncidentForm = (patch: Partial<IncidentFormState>) => {
    setIncidentForm((prev) => ({ ...prev, ...patch }));
    setIncidentError(null);
    setIncidentSuccess(null);
  };

  const handleSubmitIncident = async (e: FormEvent) => {
    e.preventDefault();
    setIncidentError(null);
    setIncidentSuccess(null);

    const { equipmentId, description, priority, scheduledAt, technician } = incidentForm;
    const desc = description.trim();

    if (!equipmentId) {
      setIncidentError('Veuillez sélectionner un équipement.');
      return;
    }
    if (desc.length < 3) {
      setIncidentError('Veuillez fournir une description de l’incident.');
      return;
    }

    const reporter = user?.id || user?.email || 'admin';

    if (incidentMode === 'preventive') {
      if (!scheduledAt) {
        setIncidentError('Veuillez renseigner une date de planification.');
        return;
      }
      if (Number.isNaN(new Date(scheduledAt).getTime())) {
        setIncidentError('La date de planification est invalide.');
        return;
      }
    }

    setIncidentLoading(true);
    try {
      if (incidentMode === 'corrective') {
        const { data } = await maintenanceAPI.reportIncident({
          equipmentId,
          reportedByUserId: reporter,
          description: desc,
          priority,
        });
        setIncidentSuccess(`Panne signalée. Ticket #${shortId(data.id)} ouvert.`);
      } else {
        const { data } = await maintenanceAPI.schedulePreventive({
          equipmentId,
          reportedByUserId: reporter,
          description: desc,
          priority,
          scheduledAt: new Date(scheduledAt).toISOString(),
          technician: technician.trim() || undefined,
        });
        setIncidentSuccess(`Maintenance planifiée le ${formatDateTime(data.scheduledAt)}.`);
      }
      setIncidentForm((prev) => ({ ...prev, description: '' }));
      await fetchAll();
    } catch (error) {
      setIncidentError(getApiErrorMessage(error, 'Échec du signalement.'));
    } finally {
      setIncidentLoading(false);
    }
  };

  /* ----------------------------- Historique ---------------------------- */
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<TicketStatusFilter>('ALL');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<TicketTypeFilter>('ALL');
  const [historyEquipmentFilter, setHistoryEquipmentFilter] = useState('ALL');

  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [ticketSaving, setTicketSaving] = useState(false);
  const [ticketForm, setTicketForm] = useState<TicketEditFormState>({
    status: 'OUVERT',
    technician: '',
    partsReplaced: '',
    cost: '',
    scheduledAt: '',
  });
  const [ticketEditError, setTicketEditError] = useState<string | null>(null);
  const [ticketEditSuccess, setTicketEditSuccess] = useState<string | null>(null);

  const filteredTickets = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return tickets.filter((t) => {
      const eq = equipmentById.get(t.equipmentId);
      const haystack = [
        eq?.name || '',
        eq?.serialNumber || '',
        t.description,
        t.technician || '',
        t.partsReplaced || '',
      ].join(' ').toLowerCase();

      const matchesSearch = !search || haystack.includes(search);
      const matchesStatus = historyStatusFilter === 'ALL' || t.status === historyStatusFilter;
      const matchesType = historyTypeFilter === 'ALL' || t.type === historyTypeFilter;
      const matchesEq = historyEquipmentFilter === 'ALL' || t.equipmentId === historyEquipmentFilter;

      return matchesSearch && matchesStatus && matchesType && matchesEq;
    });
  }, [tickets, equipmentById, historySearch, historyStatusFilter, historyTypeFilter, historyEquipmentFilter]);

  const editingTicket = editingTicketId ? tickets.find((t) => t.id === editingTicketId) || null : null;

  const openTicketEditor = (ticket: MaintenanceTicket) => {
    setEditingTicketId(ticket.id);
    setTicketForm({
      status: ticket.status,
      technician: ticket.technician || '',
      partsReplaced: ticket.partsReplaced || '',
      cost: ticket.cost != null ? String(ticket.cost) : '',
      scheduledAt: ticket.scheduledAt ? toDateTimeLocal(new Date(ticket.scheduledAt)) : '',
    });
    setTicketEditError(null);
    setTicketEditSuccess(null);
  };

  const handleSaveTicket = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTicket) return;

    const costText = ticketForm.cost.trim();
    const cost = costText === '' ? undefined : Number(costText);
    if (costText !== '' && (!Number.isFinite(cost) || (cost || 0) < 0)) {
      setTicketEditError('Le coût doit être un nombre positif.');
      return;
    }

    setTicketSaving(true);
    try {
      const payload: UpdateTicketInput = {
        status: ticketForm.status,
        technician: ticketForm.technician.trim() || undefined,
        partsReplaced: ticketForm.partsReplaced.trim() || undefined,
        cost,
      };

      if (ticketForm.scheduledAt) {
        payload.scheduledAt = new Date(ticketForm.scheduledAt).toISOString();
      }

      await maintenanceAPI.updateTicket(editingTicket.id, payload);
      setTicketEditSuccess('Ticket mis à jour avec succès.');
      await fetchAll();
    } catch (error) {
      setTicketEditError(getApiErrorMessage(error, 'Échec de la mise à jour.'));
    } finally {
      setTicketSaving(false);
    }
  };

  const openHistoryForEquipment = (equipmentId: string) => {
    setHistoryEquipmentFilter(equipmentId);
    setHistoryStatusFilter('ALL');
    setHistoryTypeFilter('ALL');
    setHistorySearch('');
    setActiveTab('history');
    setEditingTicketId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-amber-500/20 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30">
            <Wrench size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content sm:text-3xl">Maintenance & Équipements</h1>
            <p className="text-sm text-content-muted">Inventaire, pannes et interventions techniques.</p>
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

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-dense>
        <StatCard
          label="Inventaire"
          value={equipments.length}
          hint={`${activeCount} équipements actifs`}
          icon={<Package size={22} />}
          tone="brand"
        />
        <StatCard
          label="Maintenance"
          value={maintenanceCount}
          hint="interventions préventives"
          icon={<Wrench size={22} />}
          tone="amber"
        />
        <StatCard
          label="Pannes"
          value={brokenCount}
          hint="arrêts de service"
          icon={<AlertTriangle size={22} />}
          tone="red"
        />
        <StatCard
          label="Coût total"
          value={formatCurrency(totalCost)}
          hint={`${tickets.filter((t) => t.status === 'RESOLU').length} terminées`}
          icon={<CircleDollarSign size={22} />}
          tone="purple"
        />
      </div>

      {loadError && <Notice tone="error">{loadError}</Notice>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setEditingTicketId(null);
            }}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-400'
                : 'border-transparent text-content-muted hover:bg-surface-overlay/50 hover:text-content'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'inventory' && equipments.length > 0 && (
              <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content-muted">
                {equipments.length}
              </span>
            )}
            {tab.id === 'incidents' && openTickets.length > 0 && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-800 dark:text-red-400 border border-red-500/30">
                {openTickets.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===================== ONGLET INVENTAIRE ===================== */}
      {activeTab === 'inventory' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-8">
            <Card>
              <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle" size={16} />
                  <Input
                    aria-label="Rechercher un équipement"
                    placeholder="Nom, n° de série, fournisseur..."
                    className="pl-9"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filtrer les équipements par catégorie"
                  className={`${SELECT_CLASSES} md:w-48`}
                  value={inventoryCategoryFilter}
                  onChange={(e) => setInventoryCategoryFilter(e.target.value as any)}
                >
                  <option value="ALL">Toutes catégories</option>
                  {Object.entries(EQUIPMENT_CATEGORY_META).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-6 flex flex-wrap gap-1">
                {(['ALL', 'ACTIF', 'EN_MAINTENANCE', 'EN_PANNE'] as StatusFilter[]).map((status) => {
                  const meta = status === 'ALL' ? null : EQUIPMENT_STATUS_META[status];
                  const count =
                    status === 'ALL'
                      ? equipments.length
                      : equipments.filter((e) => e.status === status).length;
                  const selected = inventoryStatusFilter === status;

                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setInventoryStatusFilter(status)}
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-surface-overlay text-content ring-1 ring-line-strong'
                          : 'text-content-subtle hover:bg-surface-raised hover:text-content'
                      }`}
                    >
                      {meta?.icon}
                      {status === 'ALL' ? 'Tous les statuts' : meta?.label}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selected ? 'bg-surface-strong text-content' : 'bg-surface-raised text-content-subtle'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {inventoryActionError && <Notice tone="error" className="mb-4">{inventoryActionError}</Notice>}
              {inventoryActionSuccess && <Notice tone="success" className="mb-4">{inventoryActionSuccess}</Notice>}

              {loading && equipments.length === 0 ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-40 animate-pulse rounded-lg bg-surface-raised/50" />
                  ))}
                </div>
              ) : filteredEquipments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <Package size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">Aucun équipement ne correspond à vos critères.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-dense>
                  {filteredEquipments.map((equipment) => {
                    const categoryMeta = EQUIPMENT_CATEGORY_META[equipment.category];
                    const statusMeta = EQUIPMENT_STATUS_META[equipment.status];
                    const warranty = formatWarranty(equipment.warrantyEndDate);
                    const openTicket = hasOpenTicket(equipment.id);

                    return (
                      <div
                        key={equipment.id}
                        className="flex flex-col rounded-lg border border-line bg-surface-raised/40 p-4 transition-colors hover:border-line-strong"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${categoryMeta.classes}`}>
                              {categoryMeta.icon}
                            </div>
                            <div className="min-w-0">
                              <h2 className="truncate font-medium text-content">{equipment.name}</h2>
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-content-subtle">
                                <MapPin size={12} className="shrink-0" />
                                {equipment.location}
                              </p>
                            </div>
                          </div>
                          <Badge variant={statusMeta.variant} className="gap-1 whitespace-nowrap">
                            {statusMeta.icon}
                            {statusMeta.label}
                          </Badge>
                        </div>

                        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-[11px]">
                          <div>
                            <dt className="text-content-subtle">N° de série</dt>
                            <dd className="font-mono text-content truncate">{equipment.serialNumber}</dd>
                          </div>
                          <div>
                            <dt className="text-content-subtle">Fournisseur</dt>
                            <dd className="text-content truncate">{equipment.supplier || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-content-subtle">Date d’achat</dt>
                            <dd className="text-content">
                              {formatDate(equipment.purchaseDate)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-content-subtle">Garantie</dt>
                            <dd className={warranty.expired ? 'text-red-800 dark:text-red-400' : 'text-content'}>
                              {warranty.label}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-content-subtle">Usage / Heures</dt>
                            <dd className="text-content">
                              {equipment.usageCount} ut. / {equipment.runningHours} h
                            </dd>
                          </div>
                          <div>
                            <dt className="text-content-subtle">Prochaine préventive</dt>
                            <dd className="text-content">
                              {equipment.nextPreventiveAt
                                ? formatDate(equipment.nextPreventiveAt)
                                : 'Non planifiée'}
                            </dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-content-subtle">Cycle préventif</dt>
                            <dd className="text-content">
                              {equipment.preventiveIntervalDays ||
                              equipment.preventiveUsageThreshold ||
                              equipment.preventiveRunningHoursThreshold ? (
                                [
                                  equipment.preventiveIntervalDays
                                    ? `${equipment.preventiveIntervalDays} j`
                                    : null,
                                  equipment.preventiveUsageThreshold
                                    ? `${equipment.preventiveUsageThreshold} ut.`
                                    : null,
                                  equipment.preventiveRunningHoursThreshold
                                    ? `${equipment.preventiveRunningHoursThreshold} h`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')
                              ) : (
                                <span className="text-content-subtle">Non configuré</span>
                              )}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-4 flex flex-wrap gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-[11px]"
                            onClick={() => startIncidentFor(equipment.id, 'corrective')}
                            icon={<AlertTriangle size={13} />}
                          >
                            Panne
                          </Button>
                          {equipment.status === 'ACTIF' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-[11px] border border-line"
                              disabled={statusSavingId === equipment.id}
                              onClick={() => void handleRecordUsage(equipment)}
                              icon={
                                statusSavingId === equipment.id ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <Plus size={13} />
                                )
                              }
                            >
                              Utilisation
                            </Button>
                          )}
                          {equipment.status === 'ACTIF' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-[11px] border border-line"
                              onClick={() => startIncidentFor(equipment.id, 'preventive')}
                              icon={<CalendarPlus size={13} />}
                            >
                              Maintenance
                            </Button>
                          )}
                          {openTicket ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-[11px] text-brand-700 dark:text-brand-400 border border-brand-500/20"
                              onClick={() => openHistoryForEquipment(equipment.id)}
                              icon={<ClipboardList size={13} />}
                            >
                              Suivre
                            </Button>
                          ) : equipment.status !== 'ACTIF' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-[11px] text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                              disabled={statusSavingId === equipment.id}
                              onClick={() => void handleRestoreEquipment(equipment)}
                              icon={statusSavingId === equipment.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            >
                              Relancer
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-md border border-line px-2 py-1 text-content-subtle hover:bg-surface-overlay hover:text-content"
                            title="Historique complet"
                            onClick={() => openHistoryForEquipment(equipment.id)}
                          >
                            <History size={14} />
                          </button>
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
                  <Plus size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">Nouvel équipement</h2>
                  <p className="text-xs text-content-subtle">Ajoutez une machine à l’inventaire.</p>
                </div>
              </div>

              <form onSubmit={handleCreateEquipment} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="equipment-name" className="text-xs font-medium text-content-muted">Nom de l’équipement *</label>
                  <Input id="equipment-name"
                    required
                    value={equipmentForm.name}
                    onChange={(e) => updateEquipmentForm({ name: e.target.value })}
                    placeholder="Ex: Tapis de course Pro-4"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="equipment-serial" className="text-xs font-medium text-content-muted">N° de série *</label>
                    <Input id="equipment-serial"
                      required
                      value={equipmentForm.serialNumber}
                      onChange={(e) => updateEquipmentForm({ serialNumber: e.target.value })}
                      placeholder="SN-12345"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="equipment-category" className="text-xs font-medium text-content-muted">Catégorie *</label>
                    <select id="equipment-category"
                      className={SELECT_CLASSES}
                      value={equipmentForm.category}
                      onChange={(e) => updateEquipmentForm({ category: e.target.value as any })}
                    >
                      {Object.entries(EQUIPMENT_CATEGORY_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="equipment-location" className="text-xs font-medium text-content-muted">Emplacement *</label>
                  <Input id="equipment-location"
                    required
                    value={equipmentForm.location}
                    onChange={(e) => updateEquipmentForm({ location: e.target.value })}
                    placeholder="Ex: Zone Cardio"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="equipment-supplier" className="text-xs font-medium text-content-muted">Fournisseur</label>
                  <Input id="equipment-supplier"
                    value={equipmentForm.supplier}
                    onChange={(e) => updateEquipmentForm({ supplier: e.target.value })}
                    placeholder="Ex: TechGym"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="equipment-purchase-date" className="text-xs font-medium text-content-muted">Date d'achat</label>
                    <Input id="equipment-purchase-date"
                      type="date"
                      value={equipmentForm.purchaseDate}
                      onChange={(e) => updateEquipmentForm({ purchaseDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="equipment-warranty-end" className="text-xs font-medium text-content-muted">Fin de garantie</label>
                    <Input id="equipment-warranty-end"
                      type="date"
                      value={equipmentForm.warrantyEndDate}
                      onChange={(e) => updateEquipmentForm({ warrantyEndDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="equipment-usage-count" className="text-xs font-medium text-content-muted">Utilisations</label>
                    <Input id="equipment-usage-count"
                      type="number"
                      min={0}
                      value={equipmentForm.usageCount}
                      onChange={(e) => updateEquipmentForm({ usageCount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="equipment-running-hours" className="text-xs font-medium text-content-muted">Heures de fonct.</label>
                    <Input id="equipment-running-hours"
                      type="number"
                      min={0}
                      value={equipmentForm.runningHours}
                      onChange={(e) => updateEquipmentForm({ runningHours: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label htmlFor="equipment-preventive-interval" className="text-xs font-medium text-content-muted">Préventive (jours)</label>
                    <Input id="equipment-preventive-interval"
                      type="number"
                      min={1}
                      placeholder="Ex: 90"
                      value={equipmentForm.preventiveIntervalDays}
                      onChange={(e) => updateEquipmentForm({ preventiveIntervalDays: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="equipment-preventive-usage" className="text-xs font-medium text-content-muted">Seuil utilisations</label>
                    <Input id="equipment-preventive-usage"
                      type="number"
                      min={1}
                      placeholder="Ex: 500"
                      value={equipmentForm.preventiveUsageThreshold}
                      onChange={(e) => updateEquipmentForm({ preventiveUsageThreshold: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="equipment-preventive-hours" className="text-xs font-medium text-content-muted">Seuil heures</label>
                    <Input id="equipment-preventive-hours"
                      type="number"
                      min={1}
                      placeholder="Ex: 200"
                      value={equipmentForm.preventiveRunningHoursThreshold}
                      onChange={(e) => updateEquipmentForm({ preventiveRunningHoursThreshold: e.target.value })}
                    />
                  </div>
                </div>

                {equipmentFormError && <Notice tone="error">{equipmentFormError}</Notice>}
                {equipmentFormSuccess && <Notice tone="success">{equipmentFormSuccess}</Notice>}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={equipmentSaving}
                  icon={equipmentSaving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                >
                  Ajouter au parc
                </Button>
              </form>
            </Card>

            <div className="flex gap-3 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={16} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                Les équipements sont ajoutés au statut <strong>Actif</strong>. Leur état se met à jour
                automatiquement lors du signalement de pannes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===================== ONGLET INCIDENTS ===================== */}
      {activeTab === 'incidents' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-7">
            <Card>
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${incidentMode === 'corrective' ? 'bg-red-500/15 text-red-800 dark:text-red-300' : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'}`}>
                    {incidentMode === 'corrective' ? <AlertTriangle size={18} /> : <CalendarPlus size={18} />}
                  </div>
                  <div>
                    <h2 className="font-semibold text-content">
                      {incidentMode === 'corrective' ? 'Signaler une panne' : 'Maintenance préventive'}
                    </h2>
                    <p className="text-xs text-content-subtle">Ouvrez un ticket d'intervention technique.</p>
                  </div>
                </div>
                <div className="flex rounded-lg border border-line bg-card p-1">
                  <button
                    type="button"
                    onClick={() => setIncidentMode('corrective')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      incidentMode === 'corrective' ? 'bg-red-500/20 text-red-800 dark:text-red-300' : 'text-content-subtle hover:text-content'
                    }`}
                  >
                    Panne
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncidentMode('preventive')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      incidentMode === 'preventive' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300' : 'text-content-subtle hover:text-content'
                    }`}
                  >
                    Préventif
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmitIncident} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="incident-equipment" className="text-xs font-medium text-content-muted">Équipement concerné *</label>
                  <select id="incident-equipment"
                    className={SELECT_CLASSES}
                    required
                    value={incidentForm.equipmentId}
                    onChange={(e) => updateIncidentForm({ equipmentId: e.target.value })}
                  >
                    <option value="">Sélectionnez un équipement...</option>
                    {equipments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.serialNumber}) — {EQUIPMENT_STATUS_META[e.status].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="incident-description" className="text-xs font-medium text-content-muted">Description du problème / nature de l’entretien *</label>
                  <textarea id="incident-description"
                    className={TEXTAREA_CLASSES}
                    rows={4}
                    required
                    placeholder={incidentMode === 'corrective' ? "Décrivez les symptômes, le bruit, l’erreur affichée..." : "Nettoyage, graissage, remplacement de pièces d'usure..."}
                    value={incidentForm.description}
                    onChange={(e) => updateIncidentForm({ description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="incident-priority" className="text-xs font-medium text-content-muted">Priorité *</label>
                    <select id="incident-priority"
                      className={SELECT_CLASSES}
                      value={incidentForm.priority}
                      onChange={(e) => updateIncidentForm({ priority: e.target.value as any })}
                    >
                      {Object.entries(PRIORITY_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                  </div>
                  {incidentMode === 'preventive' ? (
                    <div className="space-y-2">
                      <label htmlFor="incident-technician" className="text-xs font-medium text-content-muted">Technicien / Prestataire</label>
                      <Input id="incident-technician"
                        placeholder="Nom du technicien"
                        value={incidentForm.technician}
                        onChange={(e) => updateIncidentForm({ technician: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label htmlFor="incident-reported-by" className="text-xs font-medium text-content-muted">Signalé par</label>
                      <Input id="incident-reported-by" disabled value={user?.email || 'Admin'} />
                    </div>
                  )}
                </div>

                {incidentMode === 'preventive' && (
                  <div className="space-y-2">
                    <label htmlFor="incident-scheduled-at" className="text-xs font-medium text-content-muted">Date et heure planifiées *</label>
                    <Input id="incident-scheduled-at"
                      type="datetime-local"
                      required
                      value={incidentForm.scheduledAt}
                      onChange={(e) => updateIncidentForm({ scheduledAt: e.target.value })}
                    />
                  </div>
                )}

                {incidentError && <Notice tone="error">{incidentError}</Notice>}
                {incidentSuccess && <Notice tone="success">{incidentSuccess}</Notice>}

                <Button
                  type="submit"
                  className={`w-full ${incidentMode === 'corrective' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  disabled={incidentLoading}
                  icon={incidentLoading ? <RefreshCw size={16} className="animate-spin" /> : <ClipboardList size={16} />}
                >
                  {incidentLoading ? 'Ouverture du ticket...' : incidentMode === 'corrective' ? 'Ouvrir le ticket de panne' : 'Planifier la maintenance'}
                </Button>
              </form>
            </Card>
          </div>

          <div className="space-y-4 xl:col-span-5">
            <Card className="h-full">
              <h3 className="mb-4 text-sm font-semibold text-content">Équipements hors service ({brokenCount + maintenanceCount})</h3>
              <div className="space-y-3">
                {equipments.filter((e) => e.status !== 'ACTIF').length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-2 rounded-full bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 size={24} />
                    </div>
                    <p className="text-xs text-content-subtle">Tous les équipements sont actifs.</p>
                  </div>
                ) : (
                  equipments
                    .filter((e) => e.status !== 'ACTIF')
                    .map((e) => {
                      const meta = EQUIPMENT_STATUS_META[e.status];
                      return (
                        <div key={e.id} className="flex items-center justify-between rounded-lg border border-line bg-card p-3">
                          <div className="flex items-center gap-3">
                            <div className={`rounded-md p-2 ${meta.classes}`}>
                              {EQUIPMENT_CATEGORY_META[e.category].icon}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-content">{e.name}</p>
                              <Badge variant={meta.variant} className="mt-1 h-4 text-[9px] px-1">{meta.label}</Badge>
                            </div>
                          </div>
                          <button
                            onClick={() => openHistoryForEquipment(e.id)}
                            className="rounded-md p-2 text-content-subtle hover:bg-surface-raised hover:text-content"
                          >
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      );
                    })
                )}
              </div>

              <div className="mt-8 space-y-4 border-t border-line pt-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-surface-raised p-2 text-content-muted">
                    <Info size={16} />
                  </div>
                  <div className="text-[11px] text-content-subtle">
                    <p className="font-medium text-content">Règle de statut :</p>
                    <p className="mt-1">Un équipement passe en <strong>En panne</strong> dès qu'un ticket correctif est ouvert. Il reste dans cet état tant que le ticket n'est pas résolu.</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ===================== ONGLET HISTORIQUE ===================== */}
      {activeTab === 'history' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          {/* Filtres et Éditeur */}
          <div className="space-y-4 xl:col-span-4">
            {editingTicketId ? (
              <Card className="ring-1 ring-brand-500/30">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                      <Hammer size={18} />
                    </div>
                    <div>
                      <h2 className="font-semibold text-content">Suivi d'intervention</h2>
                      <p className="text-xs text-content-subtle">Ticket #{shortId(editingTicketId)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingTicketId(null)}
                    className="rounded-full p-1.5 text-content-subtle hover:bg-surface-raised hover:text-content"
                  >
                    <XCircle size={20} />
                  </button>
                </div>

                {editingTicket && (
                  <div className="mb-4 rounded-lg border border-line bg-card p-3 text-[11px]">
                    <div className="mb-2 flex items-center gap-2 font-medium text-content">
                      {EQUIPMENT_CATEGORY_META[equipmentById.get(editingTicket.equipmentId)?.category || 'CARDIO'].icon}
                      {equipmentById.get(editingTicket.equipmentId)?.name}
                    </div>
                    <p className="text-content-subtle italic">« {editingTicket.description} »</p>
                  </div>
                )}

                <form onSubmit={handleSaveTicket} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="ticket-status" className="text-xs font-medium text-content-muted">Statut de l’intervention *</label>
                    <select id="ticket-status"
                      className={SELECT_CLASSES}
                      value={ticketForm.status}
                      onChange={(e) => setTicketForm((prev) => ({ ...prev, status: e.target.value as any }))}
                    >
                      {Object.entries(TICKET_STATUS_META).map(([key, meta]) => (
                        <option key={key} value={key}>{meta.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="ticket-technician" className="text-xs font-medium text-content-muted">Technicien assigné</label>
                    <div className="relative">
                      <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle" size={14} />
                      <Input id="ticket-technician"
                        className="pl-9"
                        placeholder="Nom du technicien"
                        value={ticketForm.technician}
                        onChange={(e) => setTicketForm((prev) => ({ ...prev, technician: e.target.value }))}
                      />
                    </div>
                  </div>

                  {editingTicket?.type === 'PREVENTIF' && (
                    <div className="space-y-2">
                      <label htmlFor="ticket-scheduled-at" className="text-xs font-medium text-content-muted">Date planifiée</label>
                      <Input id="ticket-scheduled-at"
                        type="datetime-local"
                        value={ticketForm.scheduledAt}
                        onChange={(e) => setTicketForm((prev) => ({ ...prev, scheduledAt: e.target.value }))}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="ticket-parts" className="text-xs font-medium text-content-muted">Pièces changées / Travaux effectués</label>
                    <textarea id="ticket-parts"
                      className={TEXTAREA_CLASSES}
                      rows={3}
                      placeholder="Détaillez l'intervention..."
                      value={ticketForm.partsReplaced}
                      onChange={(e) => setTicketForm((prev) => ({ ...prev, partsReplaced: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="ticket-cost" className="text-xs font-medium text-content-muted">Coût de l'intervention (€)</label>
                    <div className="relative">
                      <CircleDollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle" size={14} />
                      <Input id="ticket-cost"
                        className="pl-9"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0,00"
                        value={ticketForm.cost}
                        onChange={(e) => setTicketForm((prev) => ({ ...prev, cost: e.target.value }))}
                      />
                    </div>
                  </div>

                  {ticketEditError && <Notice tone="error">{ticketEditError}</Notice>}
                  {ticketEditSuccess && <Notice tone="success">{ticketEditSuccess}</Notice>}

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setEditingTicketId(null)}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="submit"
                      className="flex-[2]"
                      disabled={ticketSaving}
                      icon={ticketSaving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    >
                      Enregistrer
                    </Button>
                  </div>
                </form>
              </Card>
            ) : (
              <Card>
                <div className="mb-5 flex items-center gap-2">
                  <Search size={18} className="text-content-subtle" />
                  <h2 className="font-semibold text-content">Filtrer l'historique</h2>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="history-search" className="text-xs font-medium text-content-muted">Rechercher</label>
                    <Input id="history-search"
                      placeholder="Texte, technicien, pièces..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="history-equipment" className="text-xs font-medium text-content-muted">Équipement</label>
                    <select id="history-equipment"
                      className={SELECT_CLASSES}
                      value={historyEquipmentFilter}
                      onChange={(e) => setHistoryEquipmentFilter(e.target.value)}
                    >
                      <option value="ALL">Tous les équipements</option>
                      {equipments.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label htmlFor="history-status" className="text-xs font-medium text-content-muted">Statut</label>
                      <select id="history-status"
                        className={SELECT_CLASSES}
                        value={historyStatusFilter}
                        onChange={(e) => setHistoryStatusFilter(e.target.value as any)}
                      >
                        <option value="ALL">Tous</option>
                        {Object.entries(TICKET_STATUS_META).map(([key, meta]) => (
                          <option key={key} value={key}>{meta.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="history-type" className="text-xs font-medium text-content-muted">Type</label>
                      <select id="history-type"
                        className={SELECT_CLASSES}
                        value={historyTypeFilter}
                        onChange={(e) => setHistoryTypeFilter(e.target.value as any)}
                      >
                        <option value="ALL">Tous</option>
                        <option value="CORRECTIF">Correctif</option>
                        <option value="PREVENTIF">Préventif</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3 rounded-lg bg-card p-4 border border-line">
                    <h3 className="text-[10px] uppercase tracking-wider text-content-subtle font-bold">Résumé filtré</h3>
                    <div className="flex items-end justify-between">
                      <span className="text-xs text-content-subtle">Tickets</span>
                      <span className="text-sm font-semibold text-content">{filteredTickets.length}</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <span className="text-xs text-content-subtle">Coût estimé</span>
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(filteredTickets.reduce((s, t) => s + (Number(t.cost) || 0), 0))}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          <div className="xl:col-span-8">
            <Card className="h-full">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-content">Interventions & Maintenance</h2>
                  <p className="text-xs text-content-subtle">Suivi des réparations et coûts associés.</p>
                </div>
              </div>

              {loading && tickets.length === 0 ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-raised/50" />
                  ))}
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <History size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">Aucun ticket dans l’historique.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wider text-content-subtle">
                        <th className="pb-3 pr-4 font-medium">Équipement & Date</th>
                        <th className="pb-3 pr-4 font-medium">Description / Type</th>
                        <th className="pb-3 pr-4 font-medium">Intervenant</th>
                        <th className="pb-3 pr-4 font-medium text-right">Coût</th>
                        <th className="pb-3 pr-4 font-medium">Statut</th>
                        <th className="pb-3 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {filteredTickets.map((ticket) => {
                        const eq = equipmentById.get(ticket.equipmentId);
                        const statusMeta = TICKET_STATUS_META[ticket.status];
                        const typeMeta = TICKET_TYPE_META[ticket.type];

                        return (
                          <tr key={ticket.id} className={`group transition-colors hover:bg-surface-raised/30 ${editingTicketId === ticket.id ? 'bg-brand-500/5' : ''}`}>
                            <td className="py-4 pr-4">
                              <div className="font-medium text-content">{eq?.name || 'Inconnu'}</div>
                              <div className="mt-0.5 text-xs text-content-subtle">{formatDateTime(ticket.createdAt)}</div>
                            </td>
                            <td className="py-4 pr-4 max-w-[250px]">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${typeMeta.classes}`}>
                                  {typeMeta.label}
                                </span>
                                <Badge variant={PRIORITY_META[ticket.priority].variant} className="h-3.5 px-1 text-[9px]">
                                  {PRIORITY_META[ticket.priority].label}
                                </Badge>
                              </div>
                              <div className="line-clamp-2 text-xs text-content-muted" title={ticket.description}>
                                {ticket.description}
                              </div>
                            </td>
                            <td className="py-4 pr-4">
                              <div className="flex items-center gap-2 text-content">
                                <UserRound size={14} className="text-content-subtle" />
                                {ticket.technician || 'Non assigné'}
                              </div>
                              {ticket.partsReplaced && (
                                <div className="mt-1 text-[10px] text-content-subtle truncate max-w-[120px]">
                                  {ticket.partsReplaced}
                                </div>
                              )}
                            </td>
                            <td className="py-4 pr-4 text-right">
                              <span className={ticket.cost ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-content-subtle'}>
                                {ticket.cost != null ? formatCurrency(ticket.cost) : '—'}
                              </span>
                            </td>
                            <td className="py-4 pr-4">
                              <Badge variant={statusMeta.variant} className="gap-1">
                                {statusMeta.icon}
                                {statusMeta.label}
                              </Badge>
                            </td>
                            <td className="py-4 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openTicketEditor(ticket)}
                                icon={<Pencil size={14} />}
                              >
                                Gérer
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
        </div>
      )}
    </div>
  );
}
