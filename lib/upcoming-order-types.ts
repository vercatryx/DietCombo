/**
 * Schema-aligned types for clients.upcoming_order (upcoming order payload).
 * See UPCOMING_ORDER_SCHEMA.md and UPCOMING_ORDER_IMPLEMENTATION_PLAN.md.
 */

// --- Boxes ---

export interface BoxOrderEntry {
  boxTypeId?: string;
  vendorId?: string;
  quantity?: number;
  items?: Record<string, number>;
  itemNotes?: Record<string, string>;
}

export interface UpcomingOrderBoxes {
  serviceType: 'Boxes';
  caseId?: string;
  boxOrders: BoxOrderEntry[];
  notes?: string;
}

// --- Custom ---

export interface UpcomingOrderCustom {
  serviceType: 'Custom';
  caseId?: string;
  custom_name?: string;
  custom_price?: string | number;
  vendorId?: string;
  deliveryDay?: string;
  notes?: string;
}

// --- Food / Meal ---

export interface VendorSelection {
  vendorId: string;
  items: Record<string, number>;
  itemNotes?: Record<string, string>;
}

export interface MealSelection {
  vendorId?: string;
  items: Record<string, number>;
  itemNotes?: Record<string, string>;
}

export interface UpcomingOrderFoodMeal {
  serviceType: 'Food' | 'Meal';
  caseId?: string;
  vendorSelections?: VendorSelection[];
  deliveryDayOrders?: Record<string, { vendorSelections: VendorSelection[] }>;
  mealSelections?: Record<string, MealSelection>;
  notes?: string;
}

// --- Produce (minimal; not in main schema doc but we support it in upcoming_order) ---

export interface UpcomingOrderProduce {
  serviceType: 'Produce';
  caseId?: string;
  billAmount?: number;
  notes?: string;
}

// --- Discriminated union ---

export type UpcomingOrderPayload =
  | UpcomingOrderBoxes
  | UpcomingOrderCustom
  | UpcomingOrderFoodMeal
  | UpcomingOrderProduce;

// --- Type guards ---

export function isUpcomingOrderBoxes(
  p: unknown
): p is UpcomingOrderBoxes {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as { serviceType?: string }).serviceType === 'Boxes'
  );
}

export function isUpcomingOrderCustom(
  p: unknown
): p is UpcomingOrderCustom {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as { serviceType?: string }).serviceType === 'Custom'
  );
}

export function isUpcomingOrderFoodMeal(
  p: unknown
): p is UpcomingOrderFoodMeal {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as { serviceType?: string; service_type?: string };
  const s = o.serviceType ?? o.service_type;
  return s === 'Food' || s === 'Meal';
}

export function isUpcomingOrderProduce(
  p: unknown
): p is UpcomingOrderProduce {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as { serviceType?: string }).serviceType === 'Produce'
  );
}

export type UpcomingOrderKind = 'Boxes' | 'Custom' | 'Food' | 'Meal' | 'Produce' | null;

export function getUpcomingOrderKind(p: unknown): UpcomingOrderKind {
  if (!p || typeof p !== 'object') return null;
  const s = (p as { serviceType?: string }).serviceType;
  if (s === 'Boxes') return 'Boxes';
  if (s === 'Custom') return 'Custom';
  if (s === 'Food') return 'Food';
  if (s === 'Meal') return 'Meal';
  if (s === 'Produce') return 'Produce';
  return null;
}
