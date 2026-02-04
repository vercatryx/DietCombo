/**
 * Types for the portable Orders & Billing module.
 * Use as-is or merge into your app's lib/types.
 */

// ----- Order status (must match DB enum/values) -----
export type OrderStatus =
    | 'pending'
    | 'confirmed'
    | 'completed'
    | 'waiting_for_proof'
    | 'billing_pending'
    | 'billing_successful'
    | 'billing_failed'
    | 'cancelled';

// ----- Billing list: one row per client per week -----
export interface BillingRequest {
    clientId: string;
    clientName: string;
    /** ISO date string for Sunday of the week */
    weekStart: string;
    /** ISO date string for Saturday of the week */
    weekEnd: string;
    /** Display string e.g. "Jan 5 - Jan 11, 2025" */
    weekRange: string;
    /** Food / Meal / Boxes / Custom (excludes Equipment) */
    orders: any[];
    /** Equipment orders; shown and totalled separately */
    equipmentOrders: any[];
    totalAmount: number;
    orderCount: number;
    readyForBilling: boolean;
    billingCompleted: boolean;
    billingStatus: 'success' | 'failed' | 'pending';
    equipmentTotalAmount: number;
    equipmentOrderCount: number;
    equipmentReadyForBilling: boolean;
    equipmentBillingCompleted: boolean;
    equipmentBillingStatus: 'success' | 'failed' | 'pending';
}

// ----- Minimal client profile for BillingDetail page -----
export interface ClientProfileMinimal {
    id: string;
    fullName: string;
    email?: string | null;
    address?: string;
    phoneNumber?: string;
}

// ----- Order detail view (returned by getOrderById) -----
export interface OrderDetail {
    id: string;
    orderNumber: number | null;
    clientId: string;
    clientName: string;
    clientAddress: string;
    clientEmail: string;
    clientPhone: string;
    serviceType: string;
    caseId: string | null;
    status: string;
    scheduledDeliveryDate: string | null;
    actualDeliveryDate: string | null;
    deliveryProofUrl: string;
    totalValue: number;
    totalItems: number | null;
    notes: string | null;
    createdAt: string;
    lastUpdated: string;
    updatedBy: string | null;
    /** Parsed vendor/box/equipment details for display */
    orderDetails?: any;
}
