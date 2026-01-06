
export type OrderStatus = 'pending' | 'confirmed' | 'completed' | 'waiting_for_proof' | 'billing_pending' | 'cancelled';

export type ServiceType = 'Food' | 'Boxes' | 'Equipment';

export interface ClientProfile {
  id: string;
  fullName: string;
  email: string | null;
  address: string;
  phoneNumber: string;
  secondaryPhoneNumber?: string | null;
  navigatorId: string;
  endDate: string; // ISO Date
  screeningTookPlace: boolean;
  screeningSigned: boolean;
  screeningStatus?: 'not_started' | 'waiting_approval' | 'approved' | 'rejected';
  notes: string;
  statusId: string;
  serviceType: ServiceType;

  // Food Specific
  approvedMealsPerWeek?: number;

  // Dependent relationship - if set, this client is a dependent of another client
  parentClientId?: string | null;

  // Dependent-specific fields
  dob?: string | null; // Date of birth (ISO Date string)
  cin?: number | null; // CIN number

  // Authorization fields
  authorizedAmount?: number | null;
  expirationDate?: string | null; // ISO Date string (DATE type in database)

  // Order Configuration (Active Request)
  activeOrder?: OrderConfiguration;

  // New fields from dietfantasy
  firstName?: string | null;
  lastName?: string | null;
  apt?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  clientIdExternal?: string | null;
  caseIdExternal?: string | null;
  medicaid?: boolean;
  paused?: boolean;
  complex?: boolean;
  bill?: boolean;
  delivery?: boolean;
  dislikes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  geocodedAt?: string | null; // ISO Date string
  billings?: any; // JSON data
  visits?: any; // JSON data
  signToken?: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface OrderConfiguration {
  serviceType: ServiceType;
  // Case ID for the specific service request (required to proceed)
  caseId?: string;

  // Previously single vendor/menuSelections, now supporting multi-vendor for Food
  vendorSelections?: {
    vendorId: string;
    items: { [itemId: string]: number }; // itemId -> quantity
  }[];

  // Multi-day food orders: organized by delivery day
  deliveryDayOrders?: {
    [day: string]: {
      vendorSelections: {
        vendorId: string;
        items: { [itemId: string]: number };
      }[];
    };
  };

  lastUpdated?: string;
  updatedBy?: string; // Admin ID or Name

  // For Boxes (still typically single vendor per box type, but keeping flexible)
  vendorId?: string; // Vendor ID for Boxes service
  boxTypeId?: string;
  boxQuantity?: number;
  items?: { [itemId: string]: number }; // itemId -> quantity (for box contents)
  itemPrices?: { [itemId: string]: number }; // itemId -> price (for box item pricing)

  // Delivery Schedule Configuration
  deliveryDistribution?: { [dayOfWeek: string]: number }; // e.g. "Monday": 5

  // Display Helpers
  orderNumber?: number;
  proofOfDelivery?: string;
}

export interface DeliveryRecord {
  id: string;
  clientId: string;
  vendorId: string; // Still per-vendor for delivery records
  serviceType: ServiceType;
  deliveryDate: string; // ISO Date

  // Snapshot of what was delivered
  itemsSummary: string; // JSON or text summary

  proofOfDeliveryImage: string; // Path or URL
  createdAt: string;
}

// Configuration Entities
export interface ClientStatus {
  id: string;
  name: string;
  isSystemDefault?: boolean;
  deliveriesAllowed: boolean;
  requiresUnitsOnChange?: boolean; // If true, navigators will be prompted to add units when switching to this status
}

export interface Vendor {
  id: string;
  name: string;
  email?: string | null;
  password?: string | null; // Hashed password, optional and typically not returned in queries
  isActive: boolean;
  deliveryDays: string[]; // e.g. ["Monday", "Thursday"]
  allowsMultipleDeliveries: boolean;
  serviceTypes: ServiceType[]; // Vendor can support multiple service types
  minimumMeals?: number; // Minimum meals/value required when ordering from this vendor (default 0, meaning no minimum)
  cutoffHours?: number; // Hours before delivery cutoff
}

export interface ItemCategory {
  id: string;
  name: string;
  setValue?: number | null; // Required quota value for this category (enforces exact amount)
}

export interface MenuItem {
  id: string;
  vendorId: string;
  name: string;
  value: number;
  priceEach?: number;
  isActive: boolean;
  categoryId?: string | null;
  quotaValue?: number; // How much this item counts towards a quota (default 1)
  minimumOrder?: number; // Minimum order quantity required for this product (default 0, meaning no minimum)
}

export interface BoxQuota {
  id: string;
  boxTypeId: string;
  categoryId: string;
  targetValue: number;
}

export interface BoxType {
  id: string;
  name: string;
  vendorId?: string | null; // Single vendor ownership
  isActive: boolean;
  priceEach?: number; // Price per box unit
  quotas?: BoxQuota[];
}

export interface Navigator {
  id: string;
  name: string;
  email?: string | null;
  password?: string | null; // Optional, hashed
  isActive: boolean;
}

export interface Nutritionist {
  id: string;
  name: string;
  email?: string | null;
}

export interface Equipment {
  id: string;
  name: string;
  price: number;
  vendorId?: string | null; // Vendor that owns this equipment item
}

export interface AppSettings {
  weeklyCutoffDay: string; // e.g. "Friday"
  weeklyCutoffTime: string; // e.g. "17:00"
  reportEmail?: string; // Email address for delivery simulation reports
  enablePasswordlessLogin?: boolean;
}

export interface OrderHistoryLog {
  id: string;
  clientId: string;
  who: string;
  summary: string;
  timestamp: string;
}

export interface BillingRecord {
  id: string;
  clientId: string;
  clientName?: string;
  status: 'success' | 'failed' | 'pending' | 'request sent';
  remarks: string;
  navigator: string;
  amount: number;
  createdAt: string;
  orderId?: string;
  deliveryDate?: string; // Delivery date from the associated order (actual_delivery_date or scheduled_delivery_date)
}

export interface CompletedOrderWithDeliveryProof {
  id: string;
  clientId: string;
  serviceType: ServiceType;
  caseId?: string;
  status: string;
  scheduledDeliveryDate?: string;
  actualDeliveryDate?: string;
  deliveryProofUrl: string;
  totalValue?: number;
  totalItems?: number;
  notes?: string;
  createdAt: string;
  lastUpdated: string;
  updatedBy: string;
  orderNumber?: number; // Numeric ID for display
  orderDetails?: {
    serviceType: ServiceType;
    vendorSelections?: {
      vendorId: string;
      vendorName: string;
      items: {
        id: string;
        menuItemId: string;
        menuItemName: string;
        quantity: number;
        unitValue: number;
        totalValue: number;
      }[];
    }[];
    vendorId?: string;
    vendorName?: string;
    boxTypeId?: string;
    boxTypeName?: string;
    boxQuantity?: number;
    totalItems?: number;
    totalValue: number;
    notes?: string;
  };
}

export interface DatabaseSchema {
  clients: ClientProfile[];
  statuses: ClientStatus[];
  vendors: Vendor[];
  menuItems: MenuItem[];
  boxTypes: BoxType[];
  navigators: Navigator[];
  deliveryHistory: DeliveryRecord[];
  orderHistory: OrderHistoryLog[];
  billingHistory: BillingRecord[];
  settings: AppSettings;
}

export interface ClientFullDetails {
  client: ClientProfile;
  history: DeliveryRecord[];
  orderHistory: OrderHistoryLog[];
  billingHistory: BillingRecord[];
  activeOrder: any; // Using any to match existing usage in ClientProfile, but ideally typed
  upcomingOrder: any;
}

