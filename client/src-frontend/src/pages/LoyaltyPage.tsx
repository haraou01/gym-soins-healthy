import { useCallback, useState } from 'react';
import { Card, Button, Input, Badge } from '@/components/ui';
import {
  Search,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  List,
  RefreshCw,
  Plus,
  Minus,
  Coins,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from 'lucide-react';
import { loyaltyAPI } from '@/api';
import type {
  LoyaltyBalance,
  LoyaltyMovementInput,
  LoyaltyTransaction,
  LoyaltyTransactionType,
} from '@/types';

type FormMode = 'credit' | 'debit';

interface MovementForm {
  clientId: string;
  points: string;
  type: LoyaltyTransactionType;
  description: string;
}

const TYPE_LABELS: Record<LoyaltyTransactionType, string> = {
  GAIN_ACHAT: 'Gain achat',
  GAIN_CHECKIN: 'Gain check-in',
  RECOMPENSE_UTILISEE: 'Récompense utilisée',
};

const TYPE_BADGES: Record<LoyaltyTransactionType, string> = {
  GAIN_ACHAT: 'bg-green-900/20 text-green-800 dark:text-green-300 border border-green-500/30',
  GAIN_CHECKIN: 'bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-500/30',
  RECOMPENSE_UTILISEE: 'bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-500/30',
};

const TYPE_ICONS: Record<LoyaltyTransactionType, React.ReactNode> = {
  GAIN_ACHAT: <ArrowUpRight size={14} className="text-green-800 dark:text-green-400" />,
  GAIN_CHECKIN: <User size={14} className="text-blue-700 dark:text-blue-400" />,
  RECOMPENSE_UTILISEE: <ArrowDownLeft size={14} className="text-amber-800 dark:text-amber-400" />,
};

const CREDIT_TYPES: LoyaltyTransactionType[] = ['GAIN_ACHAT', 'GAIN_CHECKIN'];
const DEBIT_TYPE: LoyaltyTransactionType = 'RECOMPENSE_UTILISEE';

const EMPTY_FORM: MovementForm = {
  clientId: '',
  points: '',
  type: 'GAIN_ACHAT',
  description: '',
};

function getErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;

  if (Array.isArray(message)) {
    return message.join(', ');
  }

  return message ?? fallback;
}

export default function LoyaltyPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [account, setAccount] = useState<LoyaltyBalance | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<FormMode>('credit');
  const [form, setForm] = useState<MovementForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const lookupAccount = useCallback(async (identifier: string) => {
    const value = identifier.trim();

    if (!value) {
      setLookupError('Saisissez un identifiant client ou un email');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setAccount(null);
    setTransactions([]);

    try {
      const [balanceResponse, transactionsResponse] = await Promise.all([
        loyaltyAPI.getBalance(value),
        loyaltyAPI.getTransactions(value),
      ]);

      setAccount(balanceResponse.data);
      setTransactions(transactionsResponse.data);
      setSearchTerm(balanceResponse.data.clientId);
      setForm((prev) => ({ ...prev, clientId: balanceResponse.data.clientId }));
      setFormError(null);
      setFormSuccess(null);
    } catch (error) {
      setLookupError(
        getErrorMessage(error, `Aucun compte de fidélité pour « ${value} »`),
      );
    } finally {
      setLookupLoading(false);
    }
  }, []);

  const handleLookup = (event: React.FormEvent) => {
    event.preventDefault();
    void lookupAccount(searchTerm);
  };

  const switchMode = (mode: FormMode) => {
    setFormMode(mode);
    setForm((prev) => ({
      ...prev,
      type: mode === 'credit' ? 'GAIN_ACHAT' : DEBIT_TYPE,
    }));
    setFormError(null);
    setFormSuccess(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const clientId = form.clientId.trim();
    const points = Number(form.points);

    if (!clientId) {
      setFormError("L'identifiant client est requis");
      return;
    }

    if (!Number.isInteger(points) || points <= 0) {
      setFormError('Le nombre de points doit être un entier strictement positif');
      return;
    }

    setSubmitting(true);

    try {
      if (formMode === 'debit') {
        const { data: current } = await loyaltyAPI.getBalance(clientId);

        if (current.pointsBalance < points) {
          setFormError(
            `Solde insuffisant : ${current.pointsBalance} point(s) disponible(s), ${points} demandé(s).`,
          );
          return;
        }
      }

      const payload: LoyaltyMovementInput = {
        clientId,
        points,
        type: formMode === 'credit' ? form.type : DEBIT_TYPE,
        description: form.description.trim() || undefined,
      };

      const { data } =
        formMode === 'credit'
          ? await loyaltyAPI.creditPoints(payload)
          : await loyaltyAPI.debitPoints(payload);

      setAccount(data.account);
      setSearchTerm(data.account.clientId);
      setForm((prev) => ({ ...prev, clientId: data.account.clientId, points: '', description: '' }));
      setFormSuccess(
        formMode === 'credit'
          ? `+${points} point(s) crédité(s) avec succès`
          : `−${points} point(s) débité(s) avec succès`,
      );

      const { data: refreshedTransactions } = await loyaltyAPI.getTransactions(
        data.account.clientId,
      );
      setTransactions(refreshedTransactions);
    } catch (error) {
      setFormError(getErrorMessage(error, "Erreur lors de l'opération"));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormError(null);
    setFormSuccess(null);
    setForm({ ...EMPTY_FORM, clientId: account?.clientId ?? form.clientId });
  };

  const pointsValue = Number(form.points) || 0;
  const insufficientBalance =
    formMode === 'debit' && account !== null && pointsValue > account.pointsBalance;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-content">Programme de Fidélité</h1>
        <p className="text-content-muted">
          Consultation des soldes, crédit / débit de points et historique des mouvements.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 space-y-6">
          {/* Recherche du compte */}
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <Search size={18} className="text-brand-700 dark:text-brand-500" />
              <h2 className="font-semibold text-content">Rechercher un compte</h2>
            </div>

            <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-2">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ID client ou email..."
                aria-label="Identifiant client ou email"
                className="flex-1"
              />
              <Button type="submit" variant="default" disabled={lookupLoading}>
                {lookupLoading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Recherche...
                  </>
                ) : (
                  'Rechercher'
                )}
              </Button>
            </form>

            {lookupError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{lookupError}</span>
              </div>
            )}
          </Card>

          {/* Solde */}
          {account && (
            <Card>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold text-content">
                    <Wallet size={18} className="text-brand-700 dark:text-brand-500" />
                    Compte de fidélité
                  </h2>
                  <p className="mt-1 text-sm text-content-muted">
                    Client : <span className="font-mono text-content">{account.clientId}</span>
                    {account.clientEmail ? ` · ${account.clientEmail}` : ''}
                  </p>
                </div>
                <Badge variant="success" className="px-3 py-1 text-sm">
                  {account.pointsBalance} points
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-dense>
                <div className="rounded-lg border border-line bg-surface-raised/50 p-4">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-content-muted">
                    <TrendingUp size={14} className="text-green-800 dark:text-green-400" />
                    Total gagné
                  </div>
                  <div className="text-2xl font-bold text-green-800 dark:text-green-400">
                    +{account.totalEarned} pts
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-surface-raised/50 p-4">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-content-muted">
                    <TrendingDown size={14} className="text-red-800 dark:text-red-400" />
                    Total dépensé
                  </div>
                  <div className="text-2xl font-bold text-red-800 dark:text-red-400">
                    −{account.totalSpent} pts
                  </div>
                </div>

                <div className="rounded-lg border border-brand-500/30 bg-brand-900/20 p-4">
                  <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-brand-700 dark:text-brand-400">
                    <Coins size={14} />
                    Solde actuel
                  </div>
                  <div className="text-2xl font-bold text-brand-700 dark:text-brand-400">
                    {account.pointsBalance} pts
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Historique */}
          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-content">
                <List size={18} className="text-brand-700 dark:text-brand-500" />
                Historique des transactions
              </h2>
              <Button
                variant="outline"
                size="sm"
                disabled={!account || lookupLoading}
                onClick={() => account && void lookupAccount(account.clientId)}
              >
                <RefreshCw size={14} className={lookupLoading ? 'animate-spin' : ''} />
                Actualiser
              </Button>
            </div>

            {transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-content-subtle">
                <List size={40} className="mb-2 opacity-30" />
                <p className="text-sm">
                  {account
                    ? 'Aucune transaction pour ce client'
                    : 'Recherchez un client pour afficher ses mouvements'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-content-muted">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 text-right font-medium">Points</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="border-b border-line/50 transition-colors hover:bg-surface-raised/30"
                      >
                        <td className="whitespace-nowrap py-3 text-xs text-content-muted">
                          {new Date(transaction.createdAt).toLocaleString('fr-FR')}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="default"
                            className={TYPE_BADGES[transaction.type]}
                          >
                            <span className="mr-1">{TYPE_ICONS[transaction.type]}</span>
                            {TYPE_LABELS[transaction.type]}
                          </Badge>
                        </td>
                        <td
                          className={`py-3 text-right font-mono font-semibold ${
                            transaction.points > 0 ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'
                          }`}
                        >
                          {transaction.points > 0 ? '+' : ''}
                          {transaction.points} pts
                        </td>
                        <td className="py-3 text-content">
                          {transaction.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Crédit / Débit */}
        <div className="xl:col-span-5">
          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-content">
                {formMode === 'credit' ? (
                  <>
                    <Plus size={18} className="text-green-800 dark:text-green-400" />
                    Créditer des points
                  </>
                ) : (
                  <>
                    <Minus size={18} className="text-red-800 dark:text-red-400" />
                    Débiter des points
                  </>
                )}
              </h2>

              <div className="flex rounded-md border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => switchMode('credit')}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    formMode === 'credit'
                      ? 'bg-green-600/20 text-green-800 dark:text-green-300'
                      : 'text-content-muted hover:text-content'
                  }`}
                >
                  Crédit
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('debit')}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    formMode === 'debit'
                      ? 'bg-red-600/20 text-red-800 dark:text-red-300'
                      : 'text-content-muted hover:text-content'
                  }`}
                >
                  Débit
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <label
                  htmlFor="loyalty-client"
                  className="text-xs font-medium text-content-muted"
                >
                  Client
                </label>
                <Input
                  id="loyalty-client"
                  value={form.clientId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, clientId: event.target.value }))
                  }
                  placeholder="ID client"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="loyalty-points"
                  className="text-xs font-medium text-content-muted"
                >
                  Nombre de points
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="loyalty-points"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={form.points}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, points: event.target.value }))
                    }
                    placeholder="0"
                    className="w-32"
                  />
                  <span className="text-xs text-content-subtle">points</span>

                  {formMode === 'debit' && account && (
                    <span className="ml-auto text-xs text-content-muted">
                      Disponible :{' '}
                      <span className="font-mono text-content">
                        {account.pointsBalance}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {formMode === 'credit' && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-content-muted">
                    Motif du crédit
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {CREDIT_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, type }))}
                        className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                          form.type === type
                            ? 'border-brand-500 bg-brand-600/20 text-brand-700 dark:text-brand-300'
                            : 'border-line-strong bg-surface-raised text-content-muted hover:border-line-strong hover:text-content'
                        }`}
                      >
                        {TYPE_ICONS[type]}
                        {TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formMode === 'debit' && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                  {TYPE_ICONS[DEBIT_TYPE]}
                  <span>Type appliqué : {TYPE_LABELS[DEBIT_TYPE]}</span>
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="loyalty-description"
                  className="text-xs font-medium text-content-muted"
                >
                  Description
                </label>
                <Input
                  id="loyalty-description"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Ex : achat boutique, check-in, récompense..."
                  maxLength={255}
                />
              </div>

              {insufficientBalance && !formError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                  Solde insuffisant pour ce débit.
                </div>
              )}

              {formError && (
                <div className="rounded-md border border-red-500/30 bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
                  {formError}
                </div>
              )}

              {formSuccess && (
                <div className="rounded-md border border-green-500/30 bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-400">
                  {formSuccess}
                </div>
              )}

              <Button
                type="submit"
                variant={formMode === 'credit' ? 'default' : 'destructive'}
                size="lg"
                className="w-full"
                disabled={submitting || insufficientBalance || pointsValue <= 0 || !form.clientId.trim()}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Traitement...
                  </>
                ) : formMode === 'credit' ? (
                  'Créditer les points'
                ) : (
                  'Débiter les points'
                )}
              </Button>

              <button
                type="button"
                onClick={resetForm}
                className="w-full text-xs text-content-subtle transition-colors hover:text-content"
              >
                Réinitialiser le formulaire
              </button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
