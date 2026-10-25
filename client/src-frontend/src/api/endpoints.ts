import api from './client';
import type {
  AccessLog,
  AccessRequestInput,
  AppSettings,
  BrandingSettings,
  AddDishIngredientInput,
  AssignPackageInput,
  Booking,
  BookingResourceType,
  CareService,
  CareSession,
  CareSessionResult,
  CheckInResult,
  ClientCarePackage,
  ConsumeSessionInput,
  CreateBookingInput,
  CreateCareServiceInput,
  CreateDishInput,
  CreateEquipmentInput,
  CreateIngredientInput,
  CreateKitchenOrderInput,
  CreateSubscriptionInput,
  Dish,
  DishIngredientLine,
  Equipment,
  Ingredient,
  KitchenOrder,
  KitchenOrderStatus,
  KdsStreamTicket,
  LoginResponse,
  MaintenanceCostSummary,
  MaintenanceTicket,
  RecordEquipmentUsageInput,
  RecordEquipmentUsageResult,
  ReportIncidentInput,
  SchedulePreventiveInput,
  Subscription,
  UpdateSettingsInput,
  SubscriptionStatus,
  UpdateDishInput,
  UpdateEquipmentInput,
  UpdateIngredientInput,
  UpdateTicketInput,
  LoyaltyBalance,
  LoyaltyMovementInput,
  LoyaltyTransaction,
  PaymentMethod,
  Product,
  ProductCategory,
  Sale,
  SaleReceipt,
  TenantSummary,
} from '@/types';

export const authAPI = {
  login: (email: string, password: string, tenantId?: string) =>
    api.post<LoginResponse>('/api/v1/auth/login', {
      email,
      password,
      ...(tenantId ? { tenantId } : {}),
    }),

  register: (data: {
    email: string;
    password: string;
    username: string;
    tenantName?: string;
  }) => api.post<LoginResponse>('/api/v1/auth/register', data),

  getTenants: () => api.get<TenantSummary[]>('/api/v1/auth/tenants'),

  switchTenant: (tenantId: string) =>
    api.post<LoginResponse>('/api/v1/auth/switch-tenant', { tenantId }),

  refresh: (refreshToken: string) =>
    api.post<LoginResponse>('/api/v1/auth/refresh', { refreshToken }),

  logout: () => api.post('/api/v1/auth/logout'),
};

export const licenseAPI = {
  getFeatures: (licenseKey?: string, hardwareId?: string) =>
    api.get<{ modules: string[] }>('/api/v1/license/features', {
      headers: {
        ...(licenseKey ? { 'x-license-key': licenseKey } : {}),
        ...(hardwareId ? { 'x-hardware-id': hardwareId } : {}),
      },
    }),
};

export const shopAPI = {
  getProducts: () => api.get<Product[]>('/api/v1/shop'),

  createProduct: (data: {
    name: string;
    sku: string;
    description?: string;
    price: number;
    category: ProductCategory;
    isService?: boolean;
  }) => api.post<Product>('/api/v1/shop', data),

  getLowStock: () => api.get<Product[]>('/api/v1/shop/stock/low'),

  createSale: (data: {
    clientId?: string;
    items: { productId: string; quantity: number }[];
    paymentMethod: PaymentMethod;
  }) => api.post<Sale>('/api/v1/shop/sales', data),

  processSale: (data: {
    clientId?: string;
    items: { productId: string; quantity: number }[];
    paymentMethod?: PaymentMethod;
  }) => api.post<SaleReceipt>('/api/v1/shop/sales/process', data),

  getSales: () => api.get<Sale[]>('/api/v1/shop/sales'),

  getSalesByClient: (clientId: string) =>
    api.get<Sale[]>(`/api/v1/shop/sales/client/${clientId}`),
};

export const careAPI = {
  getServices: () => api.get<CareService[]>('/api/v1/care/services'),

  createService: (data: CreateCareServiceInput) =>
    api.post<CareService>('/api/v1/care/services', data),

  assignPackage: (data: AssignPackageInput) =>
    api.post<ClientCarePackage>('/api/v1/care/packages/assign', data),

  getPackagesByClient: (clientId: string) =>
    api.get<ClientCarePackage[]>(
      `/api/v1/care/packages/client/${encodeURIComponent(clientId)}`,
    ),

  consumeSession: (data: ConsumeSessionInput) =>
    api.post<CareSessionResult>('/api/v1/care/sessions/consume', data),

  getSessionsByClient: (clientId: string) =>
    api.get<CareSession[]>(
      `/api/v1/care/sessions/client/${encodeURIComponent(clientId)}`,
    ),

  getSessionsByTherapist: (therapistId: string) =>
    api.get<CareSession[]>(
      `/api/v1/care/sessions/therapist/${encodeURIComponent(therapistId)}`,
    ),
};

export const bookingAPI = {
  create: (data: CreateBookingInput) =>
    api.post<Booking>('/api/v1/bookings', data),

  getAll: () => api.get<Booking[]>('/api/v1/bookings'),

  cancel: (id: string) =>
    api.delete<Booking>(`/api/v1/bookings/${encodeURIComponent(id)}`),

  getByClient: (clientId: string) =>
    api.get<Booking[]>(
      `/api/v1/bookings/client/${encodeURIComponent(clientId)}`,
    ),

  getByResource: (resourceType: BookingResourceType, resourceId: string) =>
    api.get<Booking[]>(
      `/api/v1/bookings/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
    ),

  getByPractitioner: (practitionerId: string) =>
    api.get<Booking[]>(
      `/api/v1/bookings/practitioner/${encodeURIComponent(practitionerId)}`,
    ),
};

export const maintenanceAPI = {
  getEquipments: () =>
    api.get<Equipment[]>('/api/v1/maintenance/equipments'),

  createEquipment: (data: CreateEquipmentInput) =>
    api.post<Equipment>('/api/v1/maintenance/equipments', data),

  updateEquipment: (id: string, data: UpdateEquipmentInput) =>
    api.put<Equipment>(
      `/api/v1/maintenance/equipments/${encodeURIComponent(id)}`,
      data,
    ),

  recordUsage: (id: string, data: RecordEquipmentUsageInput) =>
    api.post<RecordEquipmentUsageResult>(
      `/api/v1/maintenance/equipments/${encodeURIComponent(id)}/usage`,
      data,
    ),

  deleteEquipment: (id: string) =>
    api.delete(`/api/v1/maintenance/equipments/${encodeURIComponent(id)}`),

  getTickets: () =>
    api.get<MaintenanceTicket[]>('/api/v1/maintenance/tickets'),

  getTicketsByEquipment: (equipmentId: string) =>
    api.get<MaintenanceTicket[]>(
      `/api/v1/maintenance/tickets/equipment/${encodeURIComponent(equipmentId)}`,
    ),

  reportIncident: (data: ReportIncidentInput) =>
    api.post<MaintenanceTicket>('/api/v1/maintenance/tickets', data),

  schedulePreventive: (data: SchedulePreventiveInput) =>
    api.post<MaintenanceTicket>(
      '/api/v1/maintenance/tickets/preventive',
      data,
    ),

  runPreventive: () =>
    api.post<{ createdTickets: MaintenanceTicket[] }>(
      '/api/v1/maintenance/preventive/run',
    ),

  updateTicket: (id: string, data: UpdateTicketInput) =>
    api.put<MaintenanceTicket>(
      `/api/v1/maintenance/tickets/${encodeURIComponent(id)}`,
      data,
    ),

  deleteTicket: (id: string) =>
    api.delete(`/api/v1/maintenance/tickets/${encodeURIComponent(id)}`),

  getCostSummary: () =>
    api.get<MaintenanceCostSummary>(
      '/api/v1/maintenance/tickets/cost-summary',
    ),
};

export const loyaltyAPI = {
  getAccounts: () => api.get<LoyaltyBalance[]>('/api/v1/loyalty'),

  /** `identifier` accepte un ID client ou un email. */
  getBalance: (identifier: string) =>
    api.get<LoyaltyBalance>(`/api/v1/loyalty/balance/${encodeURIComponent(identifier)}`),

  /** `identifier` accepte un ID client ou un email. */
  getTransactions: (identifier: string) =>
    api.get<LoyaltyTransaction[]>(
      `/api/v1/loyalty/transactions/${encodeURIComponent(identifier)}`,
    ),

  creditPoints: (data: LoyaltyMovementInput) =>
    api.post<{ account: LoyaltyBalance; transaction: LoyaltyTransaction }>(
      '/api/v1/loyalty/credit',
      data,
    ),

  debitPoints: (data: LoyaltyMovementInput) =>
    api.post<{ account: LoyaltyBalance; transaction: LoyaltyTransaction }>(
      '/api/v1/loyalty/debit',
      data,
    ),
};

export const gymAPI = {
  getSubscriptions: () =>
    api.get<Subscription[]>('/api/v1/gym/subscriptions'),

  getSubscription: (id: string) =>
    api.get<Subscription>(
      `/api/v1/gym/subscriptions/${encodeURIComponent(id)}`,
    ),

  createSubscription: (data: CreateSubscriptionInput) =>
    api.post<Subscription>('/api/v1/gym/subscriptions', data),

  updateSubscription: (id: string, status: SubscriptionStatus) =>
    api.put<Subscription>(
      `/api/v1/gym/subscriptions/${encodeURIComponent(id)}`,
      { status },
    ),

  getActiveSubscription: (clientId: string) =>
    api.get<Subscription>(
      `/api/v1/gym/subscriptions/${encodeURIComponent(clientId)}/active`,
    ),

  getAccessLogs: (limit = 50) =>
    api.get<AccessLog[]>('/api/v1/gym/access-logs', { params: { limit } }),

  checkIn: (data: AccessRequestInput) =>
    api.post<CheckInResult>('/api/v1/gym/check-in', data),

  checkOut: (data: AccessRequestInput) =>
    api.post<CheckInResult>('/api/v1/gym/check-out', data),
};

export const healthyFoodAPI = {
  getIngredients: () =>
    api.get<Ingredient[]>('/api/v1/healthy-food/ingredients'),

  getLowStockIngredients: () =>
    api.get<Ingredient[]>('/api/v1/healthy-food/ingredients/low-stock'),

  createIngredient: (data: CreateIngredientInput) =>
    api.post<Ingredient>('/api/v1/healthy-food/ingredients', data),

  updateIngredient: (id: string, data: UpdateIngredientInput) =>
    api.patch<Ingredient>(
      `/api/v1/healthy-food/ingredients/${encodeURIComponent(id)}`,
      data,
    ),

  deleteIngredient: (id: string) =>
    api.delete(`/api/v1/healthy-food/ingredients/${encodeURIComponent(id)}`),

  getDishes: () => api.get<Dish[]>('/api/v1/healthy-food/dishes'),

  getDish: (id: string) =>
    api.get<Dish>(`/api/v1/healthy-food/dishes/${encodeURIComponent(id)}`),

  createDish: (data: CreateDishInput) =>
    api.post<Dish>('/api/v1/healthy-food/dishes', data),

  updateDish: (id: string, data: UpdateDishInput) =>
    api.patch<Dish>(
      `/api/v1/healthy-food/dishes/${encodeURIComponent(id)}`,
      data,
    ),

  deleteDish: (id: string) =>
    api.delete(`/api/v1/healthy-food/dishes/${encodeURIComponent(id)}`),

  getDishIngredients: (dishId: string) =>
    api.get<DishIngredientLine[]>(
      `/api/v1/healthy-food/dishes/${encodeURIComponent(dishId)}/ingredients`,
    ),

  addDishIngredient: (dishId: string, data: AddDishIngredientInput) =>
    api.post<DishIngredientLine>(
      `/api/v1/healthy-food/dishes/${encodeURIComponent(dishId)}/ingredients`,
      data,
    ),

  removeDishIngredient: (dishId: string, ingredientId: string) =>
    api.delete(
      `/api/v1/healthy-food/dishes/${encodeURIComponent(dishId)}/ingredients/${encodeURIComponent(ingredientId)}`,
    ),

  getOrders: (status?: KitchenOrderStatus) =>
    api.get<KitchenOrder[]>('/api/v1/healthy-food/orders', {
      params: status ? { status } : undefined,
    }),

  getOrdersByClient: (clientId: string) =>
    api.get<KitchenOrder[]>(
      `/api/v1/healthy-food/orders/client/${encodeURIComponent(clientId)}`,
    ),

  createOrder: (data: CreateKitchenOrderInput) =>
    api.post<KitchenOrder>('/api/v1/healthy-food/orders', data),

  updateOrderStatus: (id: string, status: KitchenOrderStatus) =>
    api.put<KitchenOrder>(
      `/api/v1/healthy-food/orders/${encodeURIComponent(id)}/status`,
      { status },
    ),

  createKdsStreamTicket: () =>
    api.post<KdsStreamTicket>('/api/v1/healthy-food/kds/stream-ticket'),
};

export const settingsAPI = {
  /** Branding public : chargé au démarrage, avant authentification. */
  getBranding: () =>
    api.get<BrandingSettings>('/api/v1/settings/branding'),

  /** Configuration complète (TVA, annulation) — réservée aux administrateurs. */
  get: () => api.get<AppSettings>('/api/v1/settings'),

  update: (data: UpdateSettingsInput) =>
    api.put<AppSettings>('/api/v1/settings', data),
};
