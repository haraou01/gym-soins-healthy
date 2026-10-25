import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Beef,
  Carrot,
  CheckCircle2,
  ChefHat,
  ClipboardList,
  CookingPot,
  Flame,
  Info,
  Leaf,
  Minus,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Soup,
  Trash2,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';

import { Badge, Button, Card, FeatureGate, Input, Notice, StatCard } from '@/components/ui';
import { healthyFoodAPI } from '@/api';
import { formatCurrency, getApiErrorMessage } from '@/lib/utils';
import type {
  CreateDishInput,
  Dish,
  DishCategory,
  DishIngredientLine,
  DishType,
  Ingredient,
  IngredientUnit,
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
  KitchenOrderType,
} from '@/types';

type FoodTab = 'ingredients' | 'dishes' | 'orders';
type OrderFilter = 'ACTIVE' | 'SERVI' | 'ANNULE' | 'ALL';

interface IngredientFormState {
  name: string;
  unit: IngredientUnit;
  stockQuantity: string;
  alertThreshold: string;
}

interface DishFormState {
  name: string;
  description: string;
  price: string;
  type: DishType;
  category: DishCategory;
  isAvailable: boolean;
  isCustomizable: boolean;
}

interface OrderLineDraft {
  dishId: string;
  quantity: string;
}

const INGREDIENT_UNIT_META: Record<
  IngredientUnit,
  { label: string; short: string }
> = {
  GRAMMES: { label: 'Grammes', short: 'g' },
  UNITE: { label: 'Unités', short: 'u' },
  ML: { label: 'Millilitres', short: 'ml' },
};

const DISH_TYPE_META: Record<
  DishType,
  { label: string; classes: string; icon: ReactNode }
> = {
  PRET: {
    label: 'Prêt à servir',
    classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: <CheckCircle2 size={15} />,
  },
  SUR_COMMANDE: {
    label: 'Sur commande',
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    icon: <Flame size={15} />,
  },
};

const DISH_CATEGORY_LABELS: Record<DishCategory, string> = {
  ENTREE: 'Entrée',
  PLAT: 'Plat',
  DESSERT: 'Dessert',
  BOISSON: 'Boisson',
  SNACK: 'Snack',
  AUTRE: 'Autre',
};

const ORDER_STATUS_META: Record<
  KitchenOrderStatus,
  { label: string; variant: 'default' | 'warning' | 'success' | 'danger'; icon: ReactNode }
> = {
  EN_ATTENTE: {
    label: 'En attente',
    variant: 'warning',
    icon: <ClipboardList size={14} />,
  },
  EN_PREPARATION: {
    label: 'En préparation',
    variant: 'default',
    icon: <ChefHat size={14} />,
  },
  PRET: {
    label: 'Prêt',
    variant: 'success',
    icon: <CheckCircle2 size={14} />,
  },
  SERVI: {
    label: 'Servi',
    variant: 'success',
    icon: <UtensilsCrossed size={14} />,
  },
  ANNULE: {
    label: 'Annulé',
    variant: 'danger',
    icon: <XCircle size={14} />,
  },
};

const ORDER_TYPE_META: Record<KitchenOrderType, { label: string }> = {
  SUR_PLACE: { label: 'Sur place' },
  A_EMPORTER: { label: 'À emporter' },
};

/** Transitions autorisées par le backend. */
const ORDER_TRANSITIONS: Record<KitchenOrderStatus, KitchenOrderStatus[]> = {
  EN_ATTENTE: ['EN_PREPARATION', 'ANNULE'],
  EN_PREPARATION: ['PRET', 'ANNULE'],
  PRET: ['SERVI', 'ANNULE'],
  SERVI: [],
  ANNULE: [],
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const TABS: { id: FoodTab; label: string; icon: ReactNode }[] = [
  { id: 'ingredients', label: 'Stocks & Ingrédients', icon: <Carrot size={16} /> },
  { id: 'dishes', label: 'Plats & Recettes', icon: <Soup size={16} /> },
  { id: 'orders', label: 'Cuisine (KDS)', icon: <ChefHat size={16} /> },
];

const SELECT_CLASSES =
  'h-10 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-content placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-brand-500';

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

const quantityFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 3,
});

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

function formatQuantity(value: number): string {
  return quantityFormatter.format(Number.isFinite(value) ? value : 0);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function createIngredientForm(): IngredientFormState {
  return {
    name: '',
    unit: 'GRAMMES',
    stockQuantity: '',
    alertThreshold: '',
  };
}

function createDishForm(): DishFormState {
  return {
    name: '',
    description: '',
    price: '',
    type: 'PRET',
    category: 'PLAT',
    isAvailable: true,
    isCustomizable: false,
  };
}

function orderTotal(items: KitchenOrderItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export default function HealthyFoodPage() {
  const [activeTab, setActiveTab] = useState<FoodTab>('ingredients');

  /* --------------------------- Données globales -------------------------- */
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kdsRealtime, setKdsRealtime] = useState(false);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const [ingredientsRes, dishesRes, ordersRes] = await Promise.all([
        healthyFoodAPI.getIngredients(),
        healthyFoodAPI.getDishes(),
        healthyFoodAPI.getOrders(),
      ]);
      setIngredients(ingredientsRes.data);
      setDishes(
        dishesRes.data.map((dish) => ({
          ...dish,
          ingredients: dish.ingredients ?? [],
        })),
      );
      setOrders(ordersRes.data);
    } catch (error) {
      setLoadError(
        getApiErrorMessage(error, 'Impossible de charger les données cuisine.'),
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await healthyFoodAPI.getOrders();
      setOrders(data);
    } catch (error) {
      setLoadError(
        getApiErrorMessage(error, 'Impossible de rafraîchir les commandes KDS.'),
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // KDS : fallback polling uniquement si le SSE n'est pas connecté.
  useEffect(() => {
    if (activeTab !== 'orders' || kdsRealtime) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchOrders(true);
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [activeTab, fetchOrders, kdsRealtime]);

  // KDS : SSE authentifié par ticket court, reconnexion avec backoff.
  useEffect(() => {
    if (activeTab !== 'orders') {
      setKdsRealtime(false);
      return;
    }

    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (closed) {
        return;
      }

      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt += 1;
      retryTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      try {
        const { data } = await healthyFoodAPI.createKdsStreamTicket();

        if (closed) {
          return;
        }

        source = new EventSource(
          `${API_BASE_URL}/api/v1/healthy-food/kds/stream?ticket=${encodeURIComponent(data.ticket)}`,
        );

        source.onopen = () => {
          attempt = 0;
          setKdsRealtime(true);
          void fetchOrders(true);
        };

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as {
              eventType?: string;
            };

            if (payload.eventType && payload.eventType !== 'ping') {
              void fetchOrders(true);
            }
          } catch {
            // Ignore les messages non JSON / keep-alive.
          }
        };

        source.onerror = () => {
          setKdsRealtime(false);
          source?.close();
          source = null;
          scheduleReconnect();
        };
      } catch {
        setKdsRealtime(false);
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      closed = true;
      source?.close();
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      setKdsRealtime(false);
    };
  }, [activeTab, fetchOrders]);

  const lowStock = useMemo(
    () =>
      ingredients.filter(
        (ingredient) => ingredient.stockQuantity <= ingredient.alertThreshold,
      ),
    [ingredients],
  );
  const activeOrders = useMemo(
    () =>
      orders.filter(
        (order) => order.status !== 'SERVI' && order.status !== 'ANNULE',
      ),
    [orders],
  );

  const availableDishes = useMemo(
    () => dishes.filter((dish) => dish.isAvailable !== false),
    [dishes],
  );

  /* ----------------------------- Ingrédients ---------------------------- */
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientForm, setIngredientForm] = useState<IngredientFormState>(
    createIngredientForm,
  );
  const [ingredientSaving, setIngredientSaving] = useState(false);
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [ingredientSuccess, setIngredientSuccess] = useState<string | null>(null);
  const [ingredientActionError, setIngredientActionError] = useState<string | null>(null);
  const [ingredientActionSuccess, setIngredientActionSuccess] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  const filteredIngredients = useMemo(() => {
    const term = ingredientSearch.trim().toLowerCase();
    return ingredients.filter(
      (ingredient) => !term || ingredient.name.toLowerCase().includes(term),
    );
  }, [ingredients, ingredientSearch]);

  const updateIngredientForm = (patch: Partial<IngredientFormState>) => {
    setIngredientForm((prev) => ({ ...prev, ...patch }));
    setIngredientError(null);
    setIngredientSuccess(null);
  };

  const handleCreateIngredient = async (e: FormEvent) => {
    e.preventDefault();
    setIngredientError(null);
    setIngredientSuccess(null);

    const name = ingredientForm.name.trim();
    const stock = Number(ingredientForm.stockQuantity);
    const threshold =
      ingredientForm.alertThreshold.trim() === ''
        ? 0
        : Number(ingredientForm.alertThreshold);

    if (!name) {
      setIngredientError('Veuillez renseigner le nom de l’ingrédient.');
      return;
    }
    if (!Number.isFinite(stock) || stock < 0) {
      setIngredientError('Le stock initial doit être un nombre positif.');
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      setIngredientError('Le seuil d’alerte doit être un nombre positif.');
      return;
    }

    setIngredientSaving(true);
    try {
      const { data } = await healthyFoodAPI.createIngredient({
        name,
        unit: ingredientForm.unit,
        stockQuantity: stock,
        alertThreshold: threshold,
      });
      setIngredients((prev) =>
        [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setIngredientForm(createIngredientForm());
      setIngredientSuccess(`« ${data.name} » a été ajouté au stock.`);
    } catch (error) {
      setIngredientError(
        getApiErrorMessage(error, 'Impossible de créer cet ingrédient.'),
      );
    } finally {
      setIngredientSaving(false);
    }
  };

  const openAdjust = (ingredient: Ingredient) => {
    setAdjustingId(ingredient.id);
    setAdjustValue(String(ingredient.stockQuantity));
    setIngredientActionError(null);
    setIngredientActionSuccess(null);
  };

  const handleAdjustStock = async (ingredient: Ingredient) => {
    const value = Number(adjustValue);
    if (!Number.isFinite(value) || value < 0) {
      setIngredientActionError('Le stock doit être un nombre positif.');
      return;
    }

    setAdjustSaving(true);
    setIngredientActionError(null);
    setIngredientActionSuccess(null);
    try {
      const { data } = await healthyFoodAPI.updateIngredient(ingredient.id, {
        stockQuantity: value,
      });
      setIngredients((prev) =>
        prev.map((item) => (item.id === data.id ? data : item)),
      );
      setAdjustingId(null);
      setIngredientActionSuccess(
        `Stock de « ${data.name} » mis à jour : ${formatQuantity(data.stockQuantity)} ${INGREDIENT_UNIT_META[data.unit].short}.`,
      );
    } catch (error) {
      setIngredientActionError(
        getApiErrorMessage(error, 'Impossible de mettre à jour le stock.'),
      );
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleDeleteIngredient = async (ingredient: Ingredient) => {
    if (
      !window.confirm(
        `Supprimer « ${ingredient.name} » du stock ? Cette action est irréversible.`,
      )
    ) {
      return;
    }

    setIngredientActionError(null);
    setIngredientActionSuccess(null);
    try {
      await healthyFoodAPI.deleteIngredient(ingredient.id);
      setIngredients((prev) => prev.filter((item) => item.id !== ingredient.id));
      setIngredientActionSuccess(`« ${ingredient.name} » a été supprimé.`);
    } catch (error) {
      setIngredientActionError(
        getApiErrorMessage(error, 'Impossible de supprimer cet ingrédient.'),
      );
    }
  };

  /* ------------------------------- Plats -------------------------------- */
  const [dishForm, setDishForm] = useState<DishFormState>(createDishForm);
  const [dishSaving, setDishSaving] = useState(false);
  const [dishError, setDishError] = useState<string | null>(null);
  const [dishSuccess, setDishSuccess] = useState<string | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [recipeIngredientId, setRecipeIngredientId] = useState('');
  const [recipeQuantity, setRecipeQuantity] = useState('');
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeSuccess, setRecipeSuccess] = useState<string | null>(null);

  const selectedDish = selectedDishId
    ? dishes.find((dish) => dish.id === selectedDishId) || null
    : null;

  const updateDishForm = (patch: Partial<DishFormState>) => {
    setDishForm((prev) => ({ ...prev, ...patch }));
    setDishError(null);
    setDishSuccess(null);
  };

  const handleCreateDish = async (e: FormEvent) => {
    e.preventDefault();
    setDishError(null);
    setDishSuccess(null);

    const name = dishForm.name.trim();
    const price = Number(dishForm.price);

    if (!name) {
      setDishError('Veuillez renseigner le nom du plat.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setDishError('Le prix doit être un nombre positif.');
      return;
    }

    const payload: CreateDishInput = {
      name,
      description: dishForm.description.trim() || undefined,
      price,
      type: dishForm.type,
      category: dishForm.category,
      isAvailable: dishForm.isAvailable,
      isCustomizable: dishForm.isCustomizable,
    };

    setDishSaving(true);
    try {
      const { data } = await healthyFoodAPI.createDish(payload);
      const dish: Dish = { ...data, ingredients: data.ingredients ?? [] };
      setDishes((prev) =>
        [...prev, dish].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDishForm(createDishForm());
      setDishSuccess(`« ${dish.name} » a été ajouté à la carte.`);
    } catch (error) {
      setDishError(getApiErrorMessage(error, 'Impossible de créer ce plat.'));
    } finally {
      setDishSaving(false);
    }
  };

  const openRecipe = (dish: Dish) => {
    setSelectedDishId(dish.id);
    setRecipeIngredientId('');
    setRecipeQuantity('');
    setRecipeError(null);
    setRecipeSuccess(null);
  };

  const handleAddRecipeLine = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDish) return;

    const quantity = Number(recipeQuantity);
    if (!recipeIngredientId) {
      setRecipeError('Veuillez sélectionner un ingrédient.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRecipeError('La quantité doit être supérieure à zéro.');
      return;
    }

    setRecipeSaving(true);
    setRecipeError(null);
    setRecipeSuccess(null);
    try {
      await healthyFoodAPI.addDishIngredient(selectedDish.id, {
        ingredientId: recipeIngredientId,
        quantityNeeded: quantity,
      });
      const { data } = await healthyFoodAPI.getDishes();
      setDishes(
        data.map((dish) => ({ ...dish, ingredients: dish.ingredients ?? [] })),
      );
      setRecipeIngredientId('');
      setRecipeQuantity('');
      setRecipeSuccess('Recette mise à jour.');
    } catch (error) {
      setRecipeError(
        getApiErrorMessage(error, 'Impossible de modifier la recette.'),
      );
    } finally {
      setRecipeSaving(false);
    }
  };

  const handleRemoveRecipeLine = async (line: DishIngredientLine) => {
    if (!selectedDish) return;
    setRecipeError(null);
    setRecipeSuccess(null);
    try {
      await healthyFoodAPI.removeDishIngredient(
        selectedDish.id,
        line.ingredientId,
      );
      setDishes((prev) =>
        prev.map((dish) =>
          dish.id === selectedDish.id
            ? {
                ...dish,
                ingredients: dish.ingredients.filter(
                  (item) => item.id !== line.id,
                ),
              }
            : dish,
        ),
      );
      setRecipeSuccess('Ingrédient retiré de la recette.');
    } catch (error) {
      setRecipeError(
        getApiErrorMessage(error, 'Impossible de retirer cet ingrédient.'),
      );
    }
  };

  const handleDeleteDish = async (dish: Dish) => {
    if (!window.confirm(`Retirer « ${dish.name} » de la carte ?`)) {
      return;
    }

    setDishError(null);
    setDishSuccess(null);
    try {
      await healthyFoodAPI.deleteDish(dish.id);
      setDishes((prev) => prev.filter((item) => item.id !== dish.id));
      if (selectedDishId === dish.id) {
        setSelectedDishId(null);
      }
      setDishSuccess(`« ${dish.name} » a été retiré de la carte.`);
    } catch (error) {
      setDishError(
        getApiErrorMessage(error, 'Impossible de supprimer ce plat.'),
      );
    }
  };

  /* ----------------------------- Commandes ------------------------------ */
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('ACTIVE');
  const [orderClientId, setOrderClientId] = useState('');
  const [orderType, setOrderType] = useState<KitchenOrderType>('SUR_PLACE');
  const [orderLines, setOrderLines] = useState<OrderLineDraft[]>([
    { dishId: '', quantity: '1' },
  ]);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);

  const orderDraftTotal = useMemo(
    () =>
      orderLines.reduce((sum, line) => {
        const dish = dishes.find((item) => item.id === line.dishId);
        const quantity = Number(line.quantity);
        if (!dish || !Number.isFinite(quantity)) return sum;
        return sum + dish.price * quantity;
      }, 0),
    [orderLines, dishes],
  );

  const filteredOrders = useMemo(() => {
    switch (orderFilter) {
      case 'ACTIVE':
        return activeOrders;
      case 'SERVI':
        return orders.filter((order) => order.status === 'SERVI');
      case 'ANNULE':
        return orders.filter((order) => order.status === 'ANNULE');
      default:
        return orders;
    }
  }, [orders, activeOrders, orderFilter]);

  const boardColumns = useMemo(
    () =>
      (['EN_ATTENTE', 'EN_PREPARATION', 'PRET'] as KitchenOrderStatus[]).map(
        (status) => ({
          status,
          orders: activeOrders
            .filter((order) => order.status === status)
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            ),
        }),
      ),
    [activeOrders],
  );

  const updateOrderLine = (index: number, patch: Partial<OrderLineDraft>) => {
    setOrderLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
    setOrderError(null);
    setOrderSuccess(null);
  };

  const addOrderLine = () => {
    setOrderLines((prev) => [...prev, { dishId: '', quantity: '1' }]);
  };

  const removeOrderLine = (index: number) => {
    setOrderLines((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );
  };

  const handleCreateOrder = async (e: FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const clientId = orderClientId.trim();
    if (!clientId) {
      setOrderError('Veuillez renseigner l’identifiant du client.');
      return;
    }

    const items = orderLines
      .filter((line) => line.dishId)
      .map((line) => ({
        dishId: line.dishId,
        quantity: Number(line.quantity),
      }));

    if (items.length === 0) {
      setOrderError('Ajoutez au moins un plat à la commande.');
      return;
    }
    if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setOrderError('Chaque quantité doit être un entier supérieur à zéro.');
      return;
    }
    if (new Set(items.map((item) => item.dishId)).size !== items.length) {
      setOrderError('Un plat ne peut apparaître qu’une seule fois.');
      return;
    }

    setOrderSaving(true);
    try {
      const { data } = await healthyFoodAPI.createOrder({
        clientId,
        type: orderType,
        items,
      });
      setOrders((prev) => [data, ...prev]);
      setOrderClientId('');
      setOrderLines([{ dishId: '', quantity: '1' }]);
      setOrderSuccess(
        `Commande #${shortId(data.id)} envoyée en cuisine (${formatCurrency(orderTotal(data.items))}).`,
      );
      const ingredientsRes = await healthyFoodAPI.getIngredients();
      setIngredients(ingredientsRes.data);
    } catch (error) {
      setOrderError(
        getApiErrorMessage(error, 'Impossible de créer cette commande.'),
      );
    } finally {
      setOrderSaving(false);
    }
  };

  const handleTransition = async (
    order: KitchenOrder,
    status: KitchenOrderStatus,
  ) => {
    setTransitioningId(order.id);
    setBoardError(null);
    try {
      const { data } = await healthyFoodAPI.updateOrderStatus(order.id, status);
      setOrders((prev) =>
        prev.map((item) => (item.id === data.id ? data : item)),
      );
    } catch (error) {
      setBoardError(
        getApiErrorMessage(error, 'Impossible de changer le statut.'),
      );
    } finally {
      setTransitioningId(null);
    }
  };

  const renderOrderCard = (order: KitchenOrder) => {
    const statusMeta = ORDER_STATUS_META[order.status];
    const transitions = ORDER_TRANSITIONS[order.status];

    return (
      <div
        key={order.id}
        className="rounded-lg border border-line bg-surface-raised/40 p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-content">
              {order.clientId}
            </p>
            <p className="mt-0.5 text-[10px] text-content-subtle">
              #{shortId(order.id)} · {ORDER_TYPE_META[order.type].label} ·{' '}
              {formatTime(order.createdAt)}
            </p>
          </div>
          <Badge variant={statusMeta.variant} className="gap-1 text-[9px]">
            {statusMeta.icon}
            {statusMeta.label}
          </Badge>
        </div>

        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[11px]">
          {order.items.map((item) => (
            <li key={`${order.id}-${item.dishId}`} className="flex justify-between gap-2">
              <span className="truncate text-content">
                {item.quantity} × {item.dishName}
              </span>
              <span className="shrink-0 text-content-subtle">
                {formatCurrency(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs font-semibold text-content">
            {formatCurrency(orderTotal(order.items))}
          </span>
          <div className="flex gap-1">
            {transitions.length === 0 ? (
              <span className="text-[10px] text-content-subtle">Clôturée</span>
            ) : (
              transitions.map((next) => (
                <Button
                  key={next}
                  variant={next === 'ANNULE' ? 'ghost' : 'outline'}
                  size="sm"
                  className={`h-7 px-2 text-[10px] ${
                    next === 'ANNULE'
                      ? 'text-red-800 dark:text-red-400 border border-red-500/20'
                      : ''
                  }`}
                  disabled={transitioningId === order.id}
                  onClick={() => void handleTransition(order, next)}
                  icon={
                    transitioningId === order.id ? (
                      <RefreshCw size={11} className="animate-spin" />
                    ) : next === 'ANNULE' ? (
                      <XCircle size={11} />
                    ) : (
                      <ArrowRight size={11} />
                    )
                  }
                >
                  {next === 'ANNULE'
                    ? 'Annuler'
                    : ORDER_STATUS_META[next].label}
                </Button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const dishIcon = (type: DishType): ReactNode =>
    type === 'PRET' ? <CheckCircle2 size={20} /> : <CookingPot size={20} />;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/30 to-brand-500/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
            <Leaf size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-content sm:text-3xl">
              Cuisine Healthy
            </h1>
            <p className="text-sm text-content-muted">
              Stocks, recettes et préparation des commandes.
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
          label="Ingrédients"
          value={ingredients.length}
          hint={`${lowStock.length} sous le seuil`}
          icon={<Carrot size={22} />}
          tone="emerald"
        />
        <StatCard
          label="Plats à la carte"
          value={dishes.length}
          hint={`${dishes.filter((d) => d.type === 'PRET').length} prêts à servir`}
          icon={<Soup size={22} />}
          tone="brand"
        />
        <StatCard
          label="Commandes en cours"
          value={activeOrders.length}
          hint={`${orders.filter((o) => o.status === 'PRET').length} prêtes`}
          icon={<ChefHat size={22} />}
          tone="amber"
        />
        <StatCard
          label="Chiffre du jour"
          value={formatCurrency(
            orders
              .filter(
                (order) =>
                  order.status !== 'ANNULE' &&
                  new Date(order.createdAt).toDateString() ===
                    new Date().toDateString(),
              )
              .reduce((sum, order) => sum + orderTotal(order.items), 0),
          )}
          hint={`${orders.filter((o) => o.status === 'SERVI').length} servies`}
          icon={<ShoppingBag size={22} />}
          tone="purple"
        />
      </div>

      {loadError && <Notice tone="error">{loadError}</Notice>}

      {/* Onglets */}
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((tab) => {
          const button = (
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
              {tab.id === 'ingredients' && lowStock.length > 0 && (
                <span className="rounded-full border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-[10px] text-red-800 dark:text-red-400">
                  {lowStock.length}
                </span>
              )}
              {tab.id === 'orders' && activeOrders.length > 0 && (
                <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-content-muted">
                  {activeOrders.length}
                </span>
              )}
            </button>
          );

          return tab.id === 'orders' ? (
            <FeatureGate key={tab.id} feature="healthy_food">
              {button}
            </FeatureGate>
          ) : (
            button
          );
        })}
      </div>

      {/* ============================ INGRÉDIENTS ========================== */}
      {activeTab === 'ingredients' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-8">
            <Card>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
                    size={16}
                  />
                  <Input
                    className="pl-9"
                    placeholder="Rechercher un ingrédient..."
                    value={ingredientSearch}
                    onChange={(e) => setIngredientSearch(e.target.value)}
                  />
                </div>
                {lowStock.length > 0 && (
                  <Badge variant="danger" className="gap-1">
                    <AlertTriangle size={12} />
                    {lowStock.length} alerte(s) de stock
                  </Badge>
                )}
              </div>

              {ingredientActionError && (
                <Notice tone="error" className="mb-4">
                  {ingredientActionError}
                </Notice>
              )}
              {ingredientActionSuccess && (
                <Notice tone="success" className="mb-4">
                  {ingredientActionSuccess}
                </Notice>
              )}

              {loading && ingredients.length === 0 ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-lg bg-surface-raised/50"
                    />
                  ))}
                </div>
              ) : filteredIngredients.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <Package size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">
                    Aucun ingrédient dans le stock.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredIngredients.map((ingredient) => {
                    const unit = INGREDIENT_UNIT_META[ingredient.unit];
                    const isLow =
                      ingredient.stockQuantity <= ingredient.alertThreshold;
                    const isAdjusting = adjustingId === ingredient.id;

                    return (
                      <div
                        key={ingredient.id}
                        className={`rounded-lg border p-4 transition-colors ${
                          isLow
                            ? 'border-red-500/30 bg-red-500/5'
                            : 'border-line bg-surface-raised/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-4">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                              isLow
                                ? 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300'
                                : 'border-line-strong bg-surface-raised text-content-muted'
                            }`}
                          >
                            {isLow ? <AlertTriangle size={18} /> : <Carrot size={18} />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-content">
                                {ingredient.name}
                              </span>
                              {isLow && (
                                <Badge variant="danger" className="gap-1 text-[10px]">
                                  <AlertTriangle size={10} />
                                  Stock bas
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-content-subtle">
                              Seuil d’alerte : {formatQuantity(ingredient.alertThreshold)}{' '}
                              {unit.short}
                            </p>
                          </div>

                          <div className="text-right">
                            <p
                              className={`text-lg font-semibold ${
                                isLow ? 'text-red-800 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {formatQuantity(ingredient.stockQuantity)}{' '}
                              <span className="text-xs font-normal text-content-subtle">
                                {unit.short}
                              </span>
                            </p>
                          </div>

                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => openAdjust(ingredient)}
                              className="rounded-md p-2 text-content-subtle hover:bg-surface-overlay hover:text-content"
                              title="Ajuster le stock"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteIngredient(ingredient)}
                              className="rounded-md p-2 text-content-subtle hover:bg-red-500/10 hover:text-red-800 dark:text-red-400"
                              title="Supprimer"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>

                        {isAdjusting && (
                          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end">
                            <div className="flex-1 space-y-2">
                              <label className="text-[11px] font-medium text-content-muted">
                                Nouveau stock ({unit.short})
                              </label>
                              <Input
                                type="number"
                                min={0}
                                step="0.001"
                                value={adjustValue}
                                onChange={(e) => setAdjustValue(e.target.value)}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAdjustingId(null)}
                              >
                                Annuler
                              </Button>
                              <Button
                                size="sm"
                                disabled={adjustSaving}
                                onClick={() => void handleAdjustStock(ingredient)}
                                icon={
                                  adjustSaving ? (
                                    <RefreshCw size={13} className="animate-spin" />
                                  ) : (
                                    <CheckCircle2 size={13} />
                                  )
                                }
                              >
                                Enregistrer
                              </Button>
                            </div>
                          </div>
                        )}
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
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <Plus size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">
                    Nouvel ingrédient
                  </h2>
                  <p className="text-xs text-content-subtle">
                    Ajoutez une référence au stock.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateIngredient} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="ingredient-name" className="text-xs font-medium text-content-muted">
                    Nom *
                  </label>
                  <Input id="ingredient-name"
                    required
                    placeholder="Ex: Quinoa"
                    value={ingredientForm.name}
                    onChange={(e) =>
                      updateIngredientForm({ name: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="ingredient-unit" className="text-xs font-medium text-content-muted">
                    Unité *
                  </label>
                  <select id="ingredient-unit"
                    className={SELECT_CLASSES}
                    value={ingredientForm.unit}
                    onChange={(e) =>
                      updateIngredientForm({
                        unit: e.target.value as IngredientUnit,
                      })
                    }
                  >
                    {Object.entries(INGREDIENT_UNIT_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label htmlFor="ingredient-stock" className="text-xs font-medium text-content-muted">
                      Stock initial *
                    </label>
                    <Input id="ingredient-stock"
                      type="number"
                      min={0}
                      step="0.001"
                      required
                      value={ingredientForm.stockQuantity}
                      onChange={(e) =>
                        updateIngredientForm({ stockQuantity: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="ingredient-alert-threshold" className="text-xs font-medium text-content-muted">
                      Seuil d’alerte
                    </label>
                    <Input id="ingredient-alert-threshold"
                      type="number"
                      min={0}
                      step="0.001"
                      value={ingredientForm.alertThreshold}
                      onChange={(e) =>
                        updateIngredientForm({ alertThreshold: e.target.value })
                      }
                    />
                  </div>
                </div>

                {ingredientError && <Notice tone="error">{ingredientError}</Notice>}
                {ingredientSuccess && (
                  <Notice tone="success">{ingredientSuccess}</Notice>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={ingredientSaving}
                  icon={
                    ingredientSaving ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Plus size={16} />
                    )
                  }
                >
                  Ajouter au stock
                </Button>
              </form>
            </Card>

            {lowStock.length > 0 && (
              <Card className="border-red-500/30">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-red-800 dark:text-red-400" />
                  <h2 className="text-sm font-semibold text-content">
                    Réapprovisionnement
                  </h2>
                </div>
                <ul className="space-y-2">
                  {lowStock.map((ingredient) => (
                    <li
                      key={ingredient.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-content">{ingredient.name}</span>
                      <span className="text-red-800 dark:text-red-400">
                        {formatQuantity(ingredient.stockQuantity)} /{' '}
                        {formatQuantity(ingredient.alertThreshold)}{' '}
                        {INGREDIENT_UNIT_META[ingredient.unit].short}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ============================ PLATS =============================== */}
      {activeTab === 'dishes' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
          <div className="space-y-4 xl:col-span-7">
            <Card>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-content">Carte du jour</h2>
                  <p className="text-xs text-content-subtle">
                    {dishes.length} plat(s) · recettes et prix.
                  </p>
                </div>
                <Badge variant="default" className="gap-1">
                  <UtensilsCrossed size={12} />
                  Menu
                </Badge>
              </div>

              {dishError && (
                <Notice tone="error" className="mb-4">
                  {dishError}
                </Notice>
              )}
              {dishSuccess && (
                <Notice tone="success" className="mb-4">
                  {dishSuccess}
                </Notice>
              )}

              {loading && dishes.length === 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-40 animate-pulse rounded-lg bg-surface-raised/50"
                    />
                  ))}
                </div>
              ) : dishes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-20 text-center">
                  <Soup size={32} className="mx-auto mb-3 text-content-subtle" />
                  <p className="text-content-subtle">Aucun plat à la carte.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {dishes.map((dish) => {
                    const typeMeta = DISH_TYPE_META[dish.type];
                    const isSelected = selectedDishId === dish.id;

                    return (
                      <div
                        key={dish.id}
                        className={`flex flex-col rounded-lg border p-4 transition-colors ${
                          isSelected
                            ? 'border-brand-500/40 bg-brand-500/5'
                            : 'border-line bg-surface-raised/40 hover:border-line-strong'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${typeMeta.classes}`}
                          >
                            {dishIcon(dish.type)}
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => openRecipe(dish)}
                              className="rounded-md p-1.5 text-content-subtle hover:bg-surface-overlay hover:text-content"
                              title="Éditer la recette"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteDish(dish)}
                              className="rounded-md p-1.5 text-content-subtle hover:bg-red-500/10 hover:text-red-800 dark:text-red-400"
                              title="Retirer de la carte"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <h3 className="mt-3 truncate font-medium text-content">
                          {dish.name}
                        </h3>
                        {dish.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-content-subtle">
                            {dish.description}
                          </p>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(dish.price)}
                          </span>
                          <Badge
                            variant={dish.isAvailable ? 'default' : 'danger'}
                            className="text-[10px]"
                          >
                            {dish.isAvailable ? typeMeta.label : 'Indisponible'}
                          </Badge>
                        </div>

                        <div className="mt-3 border-t border-line pt-3 text-[11px] text-content-subtle">
                          {DISH_CATEGORY_LABELS[dish.category]} ·{' '}
                          {dish.ingredients.length === 0
                            ? 'Aucune recette renseignée'
                            : `${dish.ingredients.length} ingrédient(s)`}
                          {dish.isCustomizable && ' · personnalisable'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {selectedDish && (
              <Card className="ring-1 ring-brand-500/30">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                      <CookingPot size={18} />
                    </div>
                    <div>
                      <h2 className="font-semibold text-content">
                        Recette · {selectedDish.name}
                      </h2>
                      <p className="text-xs text-content-subtle">
                        Quantités consommées par portion.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDishId(null)}
                    className="rounded-full p-1.5 text-content-subtle hover:bg-surface-raised hover:text-content"
                  >
                    <XCircle size={20} />
                  </button>
                </div>

                {selectedDish.ingredients.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line py-8 text-center text-xs text-content-subtle">
                    Aucun ingrédient. Ajoutez la première ligne ci-dessous.
                  </p>
                ) : (
                  <ul className="divide-y divide-line/60">
                    {selectedDish.ingredients.map((line) => (
                      <li
                        key={line.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <span className="flex items-center gap-2 text-sm text-content">
                          <Beef size={14} className="text-content-subtle" />
                          {line.ingredient?.name ||
                            ingredients.find((i) => i.id === line.ingredientId)
                              ?.name ||
                            'Ingrédient'}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-content-muted">
                            {formatQuantity(line.quantityNeeded)}{' '}
                            {line.ingredient
                              ? INGREDIENT_UNIT_META[line.ingredient.unit].short
                              : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveRecipeLine(line)}
                            className="rounded-md p-1.5 text-content-subtle hover:bg-red-500/10 hover:text-red-800 dark:text-red-400"
                            title="Retirer"
                          >
                            <Minus size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <form
                  onSubmit={handleAddRecipeLine}
                  className="mt-4 space-y-3 border-t border-line pt-4"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
                    <div className="space-y-2">
                      <label className="text-[11px] font-medium text-content-muted">
                        Ingrédient
                      </label>
                      <select
                        className={SELECT_CLASSES}
                        value={recipeIngredientId}
                        onChange={(e) => setRecipeIngredientId(e.target.value)}
                      >
                        <option value="">Sélectionner...</option>
                        {ingredients.map((ingredient) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name} (
                            {INGREDIENT_UNIT_META[ingredient.unit].short})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-medium text-content-muted">
                        Quantité
                      </label>
                      <Input
                        type="number"
                        min={0.001}
                        step="0.001"
                        placeholder="0"
                        value={recipeQuantity}
                        onChange={(e) => setRecipeQuantity(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      size="md"
                      disabled={recipeSaving}
                      icon={
                        recipeSaving ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <Plus size={15} />
                        )
                      }
                    >
                      Ajouter
                    </Button>
                  </div>

                  {recipeError && <Notice tone="error">{recipeError}</Notice>}
                  {recipeSuccess && (
                    <Notice tone="success">{recipeSuccess}</Notice>
                  )}
                </form>
              </Card>
            )}
          </div>

          <div className="space-y-4 xl:col-span-5">
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300">
                  <Plus size={18} />
                </div>
                <div>
                  <h2 className="font-semibold text-content">Nouveau plat</h2>
                  <p className="text-xs text-content-subtle">
                    Ajoutez une création à la carte.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateDish} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-content-muted">
                    Nom du plat *
                  </label>
                  <Input
                    required
                    placeholder="Ex: Bowl quinoa & saumon"
                    value={dishForm.name}
                    onChange={(e) => updateDishForm({ name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-content-muted">
                    Description
                  </label>
                  <textarea
                    className={TEXTAREA_CLASSES}
                    rows={3}
                    placeholder="Ingrédients principaux, allergènes..."
                    value={dishForm.description}
                    onChange={(e) =>
                      updateDishForm({ description: e.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">
                      Prix (€) *
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      placeholder="12,50"
                      value={dishForm.price}
                      onChange={(e) => updateDishForm({ price: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">
                      Type *
                    </label>
                    <select
                      className={SELECT_CLASSES}
                      value={dishForm.type}
                      onChange={(e) =>
                        updateDishForm({ type: e.target.value as DishType })
                      }
                    >
                      <option value="PRET">Prêt à servir</option>
                      <option value="SUR_COMMANDE">Sur commande</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-content-muted">
                      Catégorie *
                    </label>
                    <select
                      className={SELECT_CLASSES}
                      value={dishForm.category}
                      onChange={(e) =>
                        updateDishForm({
                          category: e.target.value as DishCategory,
                        })
                      }
                    >
                      <option value="ENTREE">Entrée</option>
                      <option value="PLAT">Plat</option>
                      <option value="DESSERT">Dessert</option>
                      <option value="BOISSON">Boisson</option>
                      <option value="SNACK">Snack</option>
                      <option value="AUTRE">Autre</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-raised/40 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line-strong bg-card accent-brand-600 focus:ring-brand-500"
                      checked={dishForm.isAvailable}
                      onChange={(e) =>
                        updateDishForm({ isAvailable: e.target.checked })
                      }
                    />
                    <span className="text-xs text-content">
                      Disponible à la commande
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-raised/40 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line-strong bg-card accent-brand-600 focus:ring-brand-500"
                      checked={dishForm.isCustomizable}
                      onChange={(e) =>
                        updateDishForm({ isCustomizable: e.target.checked })
                      }
                    />
                    <span className="text-xs text-content">
                      Plat personnalisable par le client
                    </span>
                  </label>
                </div>

                {dishError && <Notice tone="error">{dishError}</Notice>}
                {dishSuccess && <Notice tone="success">{dishSuccess}</Notice>}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={dishSaving}
                  icon={
                    dishSaving ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Plus size={16} />
                    )
                  }
                >
                  Ajouter à la carte
                </Button>
              </form>
            </Card>

            <div className="flex gap-3 rounded-lg border border-line bg-surface-raised/30 p-4 text-xs text-content-muted">
              <Info size={16} className="mt-0.5 shrink-0 text-content-subtle" />
              <p>
                Les quantités de la recette sont déduites du stock à chaque
                commande. Une rupture bloque la validation de la commande.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============================ COMMANDES ============================ */}
      {activeTab === 'orders' && (
        <FeatureGate feature="healthy_food">
          <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12" data-dense>
            <div className="space-y-4 xl:col-span-7">
              <Card>
                <div className="mb-5 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300">
                    <ShoppingBag size={18} />
                  </div>
                  <div>
                    <h2 className="font-semibold text-content">
                      Nouvelle commande
                    </h2>
                    <p className="text-xs text-content-subtle">
                      Envoyez les plats directement en cuisine.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleCreateOrder} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-content-muted">
                        Identifiant client *
                      </label>
                      <Input
                        required
                        placeholder="Ex: CLIENT-001"
                        value={orderClientId}
                        onChange={(e) => {
                          setOrderClientId(e.target.value);
                          setOrderError(null);
                          setOrderSuccess(null);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-content-muted">
                        Type de service *
                      </label>
                      <select
                        className={SELECT_CLASSES}
                        value={orderType}
                        onChange={(e) =>
                          setOrderType(e.target.value as KitchenOrderType)
                        }
                      >
                        <option value="SUR_PLACE">Sur place</option>
                        <option value="A_EMPORTER">À emporter</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-content-muted">
                        Plats commandés *
                      </label>
                      <button
                        type="button"
                        onClick={addOrderLine}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        <Plus size={13} />
                        Ajouter une ligne
                      </button>
                    </div>

                    {orderLines.map((line, index) => (
                      <div
                        key={`order-line-${index}`}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center"
                      >
                        <select
                          className={`${SELECT_CLASSES} flex-1`}
                          value={line.dishId}
                          onChange={(e) =>
                            updateOrderLine(index, { dishId: e.target.value })
                          }
                        >
                          <option value="">Sélectionner un plat...</option>
                          {availableDishes.map((dish) => (
                            <option key={dish.id} value={dish.id}>
                              {dish.name} — {formatCurrency(dish.price)}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="w-20"
                            value={line.quantity}
                            onChange={(e) =>
                              updateOrderLine(index, {
                                quantity: e.target.value,
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() => removeOrderLine(index)}
                            disabled={orderLines.length === 1}
                            className="rounded-md p-2 text-content-subtle hover:bg-red-500/10 hover:text-red-800 dark:text-red-400 disabled:pointer-events-none disabled:opacity-40"
                            title="Retirer la ligne"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-line bg-surface-raised/40 px-4 py-3">
                    <span className="text-xs text-content-muted">Total commande</span>
                    <span className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(orderDraftTotal)}
                    </span>
                  </div>

                  {orderError && <Notice tone="error">{orderError}</Notice>}
                  {orderSuccess && <Notice tone="success">{orderSuccess}</Notice>}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={orderSaving || availableDishes.length === 0}
                    icon={
                      orderSaving ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <ChefHat size={16} />
                      )
                    }
                  >
                    Envoyer en cuisine
                  </Button>
                </form>
              </Card>
            </div>

            <div className="space-y-4 xl:col-span-5">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-content">Service</h2>
                    <p className="text-xs text-content-subtle">
                      {kdsRealtime
                        ? 'Commandes actives · temps réel SSE.'
                        : 'Commandes actives · fallback polling 10 s.'}
                    </p>
                  </div>
                  <Badge variant="warning" className="gap-1">
                    <Flame size={12} />
                    {activeOrders.length}
                  </Badge>
                </div>

                {boardError && (
                  <Notice tone="error" className="mb-3">
                    {boardError}
                  </Notice>
                )}

                <div className="space-y-4">
                  {boardColumns.map((column) => (
                    <div key={column.status}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-content-subtle">
                          {ORDER_STATUS_META[column.status].label}
                        </span>
                        <span className="rounded-full bg-surface-raised px-1.5 text-[10px] text-content-subtle">
                          {column.orders.length}
                        </span>
                      </div>
                      {column.orders.length === 0 ? (
                        <p className="rounded-md border border-dashed border-line py-3 text-center text-[10px] text-content-subtle">
                          Aucune commande
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {column.orders.map(renderOrderCard)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-content">
                  Historique des commandes
                </h2>
                <p className="text-xs text-content-subtle">
                  Toutes les commandes enregistrées.
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['ACTIVE', 'En cours'],
                    ['SERVI', 'Servies'],
                    ['ANNULE', 'Annulées'],
                    ['ALL', 'Toutes'],
                  ] as [OrderFilter, string][]
                ).map(([filter, label]) => {
                  const selected = orderFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setOrderFilter(filter)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-surface-overlay text-content ring-1 ring-line-strong'
                          : 'text-content-subtle hover:bg-surface-raised hover:text-content'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line py-16 text-center">
                <ChefHat size={30} className="mx-auto mb-3 text-content-subtle" />
                <p className="text-sm text-content-subtle">
                  Aucune commande dans cette vue.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wider text-content-subtle">
                      <th className="pb-3 pr-4 font-medium">Commande</th>
                      <th className="pb-3 pr-4 font-medium">Client</th>
                      <th className="pb-3 pr-4 font-medium">Contenu</th>
                      <th className="pb-3 pr-4 font-medium text-right">Total</th>
                      <th className="pb-3 pr-4 font-medium">Statut</th>
                      <th className="pb-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredOrders.map((order) => {
                      const statusMeta = ORDER_STATUS_META[order.status];
                      const transitions = ORDER_TRANSITIONS[order.status];

                      return (
                        <tr
                          key={order.id}
                          className="transition-colors hover:bg-surface-raised/30"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-mono text-xs text-content">
                              #{shortId(order.id)}
                            </div>
                            <div className="mt-0.5 text-[10px] text-content-subtle">
                              {formatDateTime(order.createdAt)}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="text-xs text-content">
                              {order.clientId}
                            </div>
                            <div className="mt-0.5 text-[10px] text-content-subtle">
                              {ORDER_TYPE_META[order.type].label}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="max-w-[220px] space-y-0.5 text-[11px] text-content-muted">
                              {order.items.map((item) => (
                                <div
                                  key={`${order.id}-hist-${item.dishId}`}
                                  className="truncate"
                                >
                                  {item.quantity} × {item.dishName}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(orderTotal(order.items))}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant={statusMeta.variant} className="gap-1">
                              {statusMeta.icon}
                              {statusMeta.label}
                            </Badge>
                          </td>
                          <td className="py-3 text-right">
                            {transitions.length === 0 ? (
                              <span className="text-[10px] text-content-subtle">—</span>
                            ) : (
                              <div className="flex justify-end gap-1">
                                {transitions
                                  .filter((next) => next !== 'ANNULE')
                                  .map((next) => (
                                    <Button
                                      key={next}
                                      variant="ghost"
                                      size="sm"
                                      className="text-[10px] border border-line"
                                      disabled={transitioningId === order.id}
                                      onClick={() =>
                                        void handleTransition(order, next)
                                      }
                                      icon={<ArrowRight size={11} />}
                                    >
                                      {ORDER_STATUS_META[next].label}
                                    </Button>
                                  ))}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-[10px] text-red-800 dark:text-red-400 border border-red-500/20"
                                  disabled={transitioningId === order.id}
                                  onClick={() =>
                                    void handleTransition(order, 'ANNULE')
                                  }
                                  icon={<XCircle size={11} />}
                                >
                                  Annuler
                                </Button>
                              </div>
                            )}
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
        </FeatureGate>
      )}
    </div>
  );
}
