/**
 * Types partagés pour le frontend GymSoinsHealthy
 * Synchronisés avec le backend NestJS (RBAC, licences, modules)
 */

/** Rôles RBAC du backend */
export type UserRole = 'SUPER_ADMIN' | 'RECEPTIONIST' | 'COACH' | 'THERAPIST' | 'CHEF';

/** Modules (feature flags) gérés par la licence backend */
export type LicensedFeature =
  | 'gym'
  | 'care'
  | 'shop'
  | 'healthy_food'
  | 'maintenance'
  | 'booking'
  | 'loyalty';

/** Informations utilisateur authentifié */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  permissions: string[];
}

/** Données de licence retournées par le backend */
export interface LicenseInfo {
  valid: boolean;
  modules: LicensedFeature[];
  hardwareId?: string;
  expiresAt?: string;
}

/** Réponse de login */
export interface LoginResponse {
  access_token: string;
  role: UserRole;
  permissions: string[];
  user: { id: string; email: string };
}

/** Types du module Shop (point de vente) */
export type ProductCategory = 'COMPLEMENT' | 'ACCESSOIRE' | 'BOISSON' | 'AUTRE';
export type PaymentMethod = 'ESPECES' | 'CARTE' | 'POINTS_FIDELITE';
export type SaleStatus = 'COMPLETED' | 'CANCELLED';

export interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string;
  price: number;
  stockQuantity: number;
  category: ProductCategory;
  isService: boolean;
  isActive: boolean;
}

export interface SaleItem {
  id?: string;
  saleId?: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  lineTotal?: number;
  product?: Product;
}

export interface Sale {
  id: string;
  clientId?: string;
  clientName?: string;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  createdAt: string;
  items: SaleItem[];
}

export interface SaleReceiptLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface SaleReceipt {
  success: true;
  saleId: string;
  clientId: string | null;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  totalAmount: number;
  createdAt: string;
  items: SaleReceiptLine[];
}

/** Types du module Care (soins, packs multi-séances, séances) */
export type CareServiceType = 'UNITAIRE' | 'PACK';
export type ClientCarePackageStatus = 'ACTIF' | 'EPUISE' | 'EXPIRE';

export interface CareService {
  id: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  price: number;
  type: CareServiceType;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCareServiceInput {
  title: string;
  description?: string;
  durationMinutes: number;
  price: number;
  type: CareServiceType;
}

export interface ClientCarePackage {
  id: string;
  clientId: string;
  careServiceId: string;
  totalSessions: number;
  remainingSessions: number;
  status: ClientCarePackageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AssignPackageInput {
  clientId: string;
  careServiceId: string;
  totalSessions: number;
}

export interface CareSession {
  id: string;
  clientId: string;
  careServiceId: string;
  therapistId: string;
  timestamp: string;
  notes?: string | null;
  packageId?: string | null;
  createdAt: string;
}

export interface ConsumeSessionInput {
  clientId: string;
  careServiceId: string;
  therapistId: string;
  timestamp?: string;
  notes?: string;
}

export interface CareSessionResult {
  session: CareSession;
  remainingSessions: number;
  packageId: string;
}

/** Types du module Booking (planification centralisée) */
export type BookingResourceType = 'GYM_CLASS' | 'CARE_SESSION' | 'EQUIPMENT';
export type BookingStatus = 'CONFIRME' | 'ANNULE' | 'TERMINE';

export interface Booking {
  id: string;
  clientId: string;
  resourceType: BookingResourceType;
  resourceId: string;
  practitionerOrCoachId: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingInput {
  clientId: string;
  resourceType: BookingResourceType;
  resourceId: string;
  practitionerOrCoachId: string;
  startTime: string;
  endTime: string;
}

/** Types du module Maintenance (inventaire, pannes, interventions) */
export type EquipmentCategory =
  | 'CARDIO'
  | 'MUSCULATION'
  | 'FUNCTIONAL'
  | 'CABINE_SOIN'
  | 'TOURNQUIET';

export type EquipmentStatus = 'ACTIF' | 'EN_PANNE' | 'EN_MAINTENANCE';

export interface Equipment {
  id: string;
  name: string;
  serialNumber: string;
  category: EquipmentCategory;
  location: string;
  status: EquipmentStatus;
  purchaseDate?: string | null;
  supplier?: string | null;
  warrantyEndDate?: string | null;
  usageCount: number;
  runningHours: number;
  preventiveIntervalDays?: number | null;
  preventiveUsageThreshold?: number | null;
  preventiveRunningHoursThreshold?: number | null;
  lastPreventiveAt?: string | null;
  nextPreventiveAt?: string | null;
  usageAtLastPreventive: number;
  runningHoursAtLastPreventive: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEquipmentInput {
  name: string;
  serialNumber: string;
  category: EquipmentCategory;
  location: string;
  purchaseDate?: string;
  supplier?: string;
  warrantyEndDate?: string;
  usageCount?: number;
  runningHours?: number;
  preventiveIntervalDays?: number;
  preventiveUsageThreshold?: number;
  preventiveRunningHoursThreshold?: number;
}

export interface UpdateEquipmentInput {
  name?: string;
  serialNumber?: string;
  category?: EquipmentCategory;
  location?: string;
  supplier?: string;
  status?: EquipmentStatus;
  purchaseDate?: string;
  warrantyEndDate?: string;
  usageCount?: number;
  runningHours?: number;
  preventiveIntervalDays?: number;
  preventiveUsageThreshold?: number;
  preventiveRunningHoursThreshold?: number;
}

export interface RecordEquipmentUsageInput {
  usageIncrement?: number;
  runningHoursIncrement?: number;
  reportedByUserId?: string;
}

export interface RecordEquipmentUsageResult {
  equipment: Equipment;
  preventiveTicket?: MaintenanceTicket;
}

export type MaintenancePriority = 'BASSE' | 'MOYENNE' | 'URGENTE';
export type MaintenanceTicketStatus = 'OUVERT' | 'EN_COURS' | 'RESOLU';
export type MaintenanceTicketType = 'CORRECTIF' | 'PREVENTIF';

export interface MaintenanceTicket {
  id: string;
  equipmentId: string;
  reportedByUserId: string;
  description: string;
  type: MaintenanceTicketType;
  priority: MaintenancePriority;
  status: MaintenanceTicketStatus;
  scheduledAt?: string | null;
  technician?: string | null;
  partsReplaced?: string | null;
  cost?: number | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportIncidentInput {
  equipmentId: string;
  reportedByUserId: string;
  description: string;
  priority?: MaintenancePriority;
}

export interface SchedulePreventiveInput {
  equipmentId: string;
  reportedByUserId: string;
  description: string;
  priority?: MaintenancePriority;
  scheduledAt: string;
  technician?: string;
}

export interface UpdateTicketInput {
  status?: MaintenanceTicketStatus;
  cost?: number;
  resolvedAt?: string;
  technician?: string;
  partsReplaced?: string;
  scheduledAt?: string;
}

export interface MaintenanceCostSummary {
  totalTickets: number;
  totalCost: number;
  resolvedTickets: number;
  openTickets: number;
}

/** Types du module Loyalty (programme de fidélité) */
export type LoyaltyTransactionType = 'GAIN_ACHAT' | 'GAIN_CHECKIN' | 'RECOMPENSE_UTILISEE';

export interface LoyaltyBalance {
  id: string;
  clientId: string;
  clientEmail?: string | null;
  pointsBalance: number;
  totalEarned: number;
  totalSpent: number;
}

export interface LoyaltyTransaction {
  id: string;
  loyaltyAccountId: string;
  points: number;
  type: LoyaltyTransactionType;
  description?: string | null;
  createdAt: string;
}

export interface LoyaltyMovementInput {
  clientId: string;
  clientEmail?: string;
  points: number;
  type?: LoyaltyTransactionType;
  description?: string;
}

/** Types du module Gym (abonnements, tourniquet) */
export type SubscriptionType =
  | 'PASS_JOURNALIER'
  | 'MENSUEL'
  | 'ANNUEL'
  | 'CARNET_SEANCES';

export type SubscriptionStatus = 'ACTIF' | 'SUSPENDU' | 'EXPIRE';

export interface Subscription {
  id: string;
  clientId: string;
  type: SubscriptionType;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  remainingSessions: number;
  createdAt: string;
  updatedAt: string;
}

export type AccessMethod = 'RFID' | 'QR_CODE' | 'BIOMETRIE' | 'MANUEL';
export type AccessDirection = 'ENTREE' | 'SORTIE';

export interface AccessLog {
  id: string;
  clientId: string;
  direction: AccessDirection;
  timestamp: string;
  method: AccessMethod;
  granted: boolean;
  reason?: string | null;
  createdAt: string;
}

export interface CheckInResult {
  granted: boolean;
  reason?: string;
  accessLog?: AccessLog;
  subscription?: Subscription;
}

export interface CreateSubscriptionInput {
  clientId: string;
  type: SubscriptionType;
  startDate: string;
  endDate: string;
  remainingSessions?: number;
}

export interface AccessRequestInput {
  clientId: string;
  method: AccessMethod;
}

/** Types du module Healthy Food (ingrédients, plats, KDS) */
export type IngredientUnit = 'GRAMMES' | 'UNITE' | 'ML';

export interface Ingredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  stockQuantity: number;
  alertThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export type DishType = 'PRET' | 'SUR_COMMANDE';
export type DishCategory =
  | 'ENTREE'
  | 'PLAT'
  | 'DESSERT'
  | 'BOISSON'
  | 'SNACK'
  | 'AUTRE';

export interface DishIngredientLine {
  id: string;
  dishId: string;
  ingredientId: string;
  quantityNeeded: number;
  ingredient?: Ingredient;
}

export interface Dish {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  isCustomizable: boolean;
  category: DishCategory;
  isAvailable: boolean;
  type: DishType;
  ingredients: DishIngredientLine[];
  createdAt: string;
  updatedAt: string;
}

export type KitchenOrderStatus =
  | 'EN_ATTENTE'
  | 'EN_PREPARATION'
  | 'PRET'
  | 'SERVI'
  | 'ANNULE';

export type KitchenOrderType = 'SUR_PLACE' | 'A_EMPORTER';

export interface KitchenOrderItem {
  id?: string;
  dishId: string;
  dishName: string;
  quantity: number;
  unitPrice: number;
}

export interface KitchenOrder {
  id: string;
  clientId: string;
  status: KitchenOrderStatus;
  type: KitchenOrderType;
  items: KitchenOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateIngredientInput {
  name: string;
  unit: IngredientUnit;
  stockQuantity: number;
  alertThreshold?: number;
}

export interface UpdateIngredientInput {
  name?: string;
  unit?: IngredientUnit;
  stockQuantity?: number;
  alertThreshold?: number;
}

export interface CreateDishInput {
  name: string;
  description?: string;
  price: number;
  isCustomizable?: boolean;
  category?: DishCategory;
  isAvailable?: boolean;
  type: DishType;
}

export interface UpdateDishInput {
  name?: string;
  description?: string;
  price?: number;
  isCustomizable?: boolean;
  category?: DishCategory;
  isAvailable?: boolean;
  type?: DishType;
}

export interface AddDishIngredientInput {
  ingredientId: string;
  quantityNeeded: number;
}

export interface CreateKitchenOrderInput {
  clientId: string;
  type: KitchenOrderType;
  items: { dishId: string; quantity: number }[];
}

/** Types du module Settings (configuration globale & whitelabel) */
export interface TaxRate {
  id: string;
  label: string;
  rate: number;
}

export interface CancellationPolicy {
  freeCancellationHours: number;
  lateCancellationFeePercent: number;
  noShowFeePercent: number;
  notes?: string;
}

export interface BrandingSettings {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  currency: string;
  locale: string;
}

export interface AppSettings extends BrandingSettings {
  id: string;
  taxRates: TaxRate[];
  cancellationPolicy: CancellationPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface TaxRateInput {
  id?: string;
  label: string;
  rate: number;
}

export interface UpdateSettingsInput {
  gymName?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  currency?: string;
  locale?: string;
  taxRates?: TaxRateInput[];
  cancellationPolicy?: Partial<CancellationPolicy>;
}

/** Configuration d'un élément de menu latéral */
export interface MenuItem {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  requiredFeature?: LicensedFeature;
  requiredRole?: UserRole[];
  badge?: string;
}

/** État global de l'application */
export interface AppState {
  user: AuthUser | null;
  license: LicenseInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
