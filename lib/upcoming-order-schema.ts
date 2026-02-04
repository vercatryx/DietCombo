/**
 * Sanitize (to stored) and hydrate (from stored) for clients.upcoming_order.
 * See UPCOMING_ORDER_SCHEMA.md and UPCOMING_ORDER_IMPLEMENTATION_PLAN.md.
 */

import type { OrderConfiguration, ServiceType } from './types';
import type {
  UpcomingOrderPayload,
  UpcomingOrderBoxes,
  UpcomingOrderCustom,
  UpcomingOrderFoodMeal,
  UpcomingOrderProduce,
  BoxOrderEntry,
  VendorSelection,
  MealSelection,
} from './upcoming-order-types';
import {
  isUpcomingOrderBoxes,
  isUpcomingOrderCustom,
  isUpcomingOrderFoodMeal,
  isUpcomingOrderProduce,
} from './upcoming-order-types';

type OrderConfigInput = OrderConfiguration | Record<string, unknown>;

// --- Sanitizer: UI/config -> stored payload (only allowed fields per serviceType) ---

function sanitizeBoxOrder(entry: Record<string, unknown>): BoxOrderEntry {
  return {
    ...(entry.boxTypeId != null && { boxTypeId: String(entry.boxTypeId) }),
    ...(entry.vendorId != null && { vendorId: String(entry.vendorId) }),
    ...(entry.quantity != null && { quantity: Number(entry.quantity) || 1 }),
    ...(entry.items != null && typeof entry.items === 'object' && !Array.isArray(entry.items) && { items: entry.items as Record<string, number> }),
    ...(entry.itemNotes != null && typeof entry.itemNotes === 'object' && !Array.isArray(entry.itemNotes) && { itemNotes: entry.itemNotes as Record<string, string> }),
  };
}

function toStoredBoxes(config: OrderConfigInput, serviceType: ServiceType): UpcomingOrderBoxes {
  const c = config as Record<string, unknown>;
  const boxOrdersRaw = c.boxOrders ?? c.boxes;
  const boxOrdersArray = Array.isArray(boxOrdersRaw)
    ? boxOrdersRaw
    : [];

  let boxOrders: BoxOrderEntry[];
  if (boxOrdersArray.length > 0) {
    boxOrders = boxOrdersArray.map((entry: unknown) =>
      sanitizeBoxOrder(typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {})
    );
  } else {
    // Legacy: single vendorId, boxTypeId, items, boxQuantity
    const quantity = c.boxQuantity != null ? Number(c.boxQuantity) : 1;
    boxOrders = [sanitizeBoxOrder({
      boxTypeId: c.boxTypeId,
      vendorId: c.vendorId,
      quantity: quantity >= 1 ? quantity : 1,
      items: c.items ?? {},
      itemNotes: c.itemNotes ?? {},
    })];
  }

  const out: UpcomingOrderBoxes = {
    serviceType: 'Boxes',
    boxOrders,
  };
  if (c.caseId != null && String(c.caseId).trim() !== '') out.caseId = String(c.caseId).trim();
  if (c.notes != null && String(c.notes).trim() !== '') out.notes = String(c.notes).trim();
  return out;
}

function toStoredCustom(config: OrderConfigInput, _serviceType: ServiceType): UpcomingOrderCustom {
  const c = config as Record<string, unknown>;
  const customItems = c.customItems as Array<{ name?: string; price?: number; quantity?: number }> | undefined;
  let custom_name: string | undefined;
  let custom_price: string | number | undefined;

  if (c.custom_name != null && String(c.custom_name).trim() !== '') {
    custom_name = String(c.custom_name).trim();
  }
  if (c.custom_price != null) {
    custom_price = typeof c.custom_price === 'number' ? c.custom_price : String(c.custom_price);
  }
  if ((custom_name == null || custom_price == null) && Array.isArray(customItems) && customItems.length > 0) {
    const primary = customItems.find((i) => (i.quantity ?? 0) > 0) ?? customItems[0];
    if (!custom_name && primary?.name) custom_name = String(primary.name).trim();
    if (custom_price == null && primary?.price != null) custom_price = Number(primary.price);
  }

  const out: UpcomingOrderCustom = {
    serviceType: 'Custom',
  };
  if (c.caseId != null && String(c.caseId).trim() !== '') out.caseId = String(c.caseId).trim();
  if (custom_name) out.custom_name = custom_name;
  if (custom_price !== undefined) out.custom_price = custom_price;
  if (c.vendorId != null && String(c.vendorId).trim() !== '') out.vendorId = String(c.vendorId).trim();
  if (c.deliveryDay != null && String(c.deliveryDay).trim() !== '') out.deliveryDay = String(c.deliveryDay).trim();
  if (c.notes != null && String(c.notes).trim() !== '') out.notes = String(c.notes).trim();
  return out;
}

function sanitizeVendorSelection(s: unknown): VendorSelection | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const vendorId = o.vendorId != null ? String(o.vendorId) : '';
  if (!vendorId.trim()) return null;
  const items = (o.items && typeof o.items === 'object' && !Array.isArray(o.items))
    ? (o.items as Record<string, number>)
    : {};
  const sel: VendorSelection = { vendorId: vendorId.trim(), items };
  if (o.itemNotes != null && typeof o.itemNotes === 'object' && !Array.isArray(o.itemNotes)) {
    sel.itemNotes = o.itemNotes as Record<string, string>;
  }
  return sel;
}

function sanitizeMealSelection(s: unknown): MealSelection | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const items = (o.items && typeof o.items === 'object' && !Array.isArray(o.items))
    ? (o.items as Record<string, number>)
    : {};
  const sel: MealSelection = { items };
  if (o.vendorId != null && String(o.vendorId).trim() !== '') sel.vendorId = String(o.vendorId).trim();
  if (o.itemNotes != null && typeof o.itemNotes === 'object' && !Array.isArray(o.itemNotes)) {
    sel.itemNotes = o.itemNotes as Record<string, string>;
  }
  return sel;
}

function toStoredFoodMeal(config: OrderConfigInput, serviceType: ServiceType): UpcomingOrderFoodMeal {
  const c = config as Record<string, unknown>;
  const out: UpcomingOrderFoodMeal = {
    serviceType: serviceType === 'Meal' ? 'Meal' : 'Food',
  };
  if (c.caseId != null && String(c.caseId).trim() !== '') out.caseId = String(c.caseId).trim();
  if (c.notes != null && String(c.notes).trim() !== '') out.notes = String(c.notes).trim();

  const vsRaw = c.vendorSelections;
  if (Array.isArray(vsRaw) && vsRaw.length > 0) {
    out.vendorSelections = vsRaw
      .map((s) => sanitizeVendorSelection(s))
      .filter((s): s is VendorSelection => s !== null);
  }

  const ddo = c.deliveryDayOrders;
  if (ddo && typeof ddo === 'object' && !Array.isArray(ddo)) {
    const deliveryDayOrders: Record<string, { vendorSelections: VendorSelection[] }> = {};
    for (const [day, dayVal] of Object.entries(ddo)) {
      const dayOrder = dayVal as { vendorSelections?: unknown[] };
      const arr = Array.isArray(dayOrder?.vendorSelections) ? dayOrder.vendorSelections : [];
      const selections = arr
        .map((s) => sanitizeVendorSelection(s))
        .filter((s): s is VendorSelection => s !== null);
      if (selections.length > 0) deliveryDayOrders[day] = { vendorSelections: selections };
    }
    if (Object.keys(deliveryDayOrders).length > 0) out.deliveryDayOrders = deliveryDayOrders;
  }

  const ms = c.mealSelections;
  if (ms && typeof ms === 'object' && !Array.isArray(ms)) {
    const mealSelections: Record<string, MealSelection> = {};
    for (const [mealType, val] of Object.entries(ms)) {
      const sel = sanitizeMealSelection(val);
      if (sel) mealSelections[mealType] = sel;
    }
    if (Object.keys(mealSelections).length > 0) out.mealSelections = mealSelections;
  }

  return out;
}

function toStoredProduce(config: OrderConfigInput, _serviceType: ServiceType): UpcomingOrderProduce {
  const c = config as Record<string, unknown>;
  const out: UpcomingOrderProduce = { serviceType: 'Produce' };
  if (c.caseId != null && String(c.caseId).trim() !== '') out.caseId = String(c.caseId).trim();
  if (c.billAmount != null) out.billAmount = Number(c.billAmount);
  if (c.notes != null && String(c.notes).trim() !== '') out.notes = String(c.notes).trim();
  return out;
}

/**
 * Convert UI/API order config to the strict stored payload for clients.upcoming_order.
 * Only allowed fields for the given serviceType are included.
 */
export function toStoredUpcomingOrder(
  config: OrderConfigInput | null | undefined,
  serviceType: ServiceType
): UpcomingOrderPayload | null {
  if (config == null || typeof config !== 'object') return null;

  const c = config as Record<string, unknown>;
  const st = (c.serviceType ?? serviceType) as string;

  switch (st) {
    case 'Boxes':
      return toStoredBoxes(config, serviceType as ServiceType);
    case 'Custom':
    case 'Vendor':
      return toStoredCustom(config, serviceType as ServiceType);
    case 'Food':
    case 'Meal':
      return toStoredFoodMeal(config, serviceType as ServiceType);
    case 'Produce':
      return toStoredProduce(config, serviceType as ServiceType);
    case 'Equipment':
      // Equipment not stored in upcoming order per schema
      return null;
    default:
      // Unknown type: treat as Food for backward compat
      return toStoredFoodMeal(config, 'Food');
  }
}

// --- Hydration: stored payload (or legacy) -> UI OrderConfiguration ---

function fromStoredBoxes(stored: UpcomingOrderBoxes): OrderConfiguration {
  const config: OrderConfiguration = {
    serviceType: 'Boxes',
    boxOrders: stored.boxOrders?.map((b) => ({
      ...b,
      quantity: b.quantity ?? 1,
      items: b.items ?? {},
      itemNotes: b.itemNotes ?? {},
    })) ?? [],
  };
  if (stored.caseId) config.caseId = stored.caseId;
  if (stored.notes) config.notes = stored.notes;
  // Legacy compat: set first box's vendorId/boxTypeId/items on top level for code that still reads them
  if (config.boxOrders && config.boxOrders.length > 0) {
    const first = config.boxOrders[0];
    config.vendorId = first.vendorId;
    config.boxTypeId = first.boxTypeId;
    config.items = first.items;
    config.boxQuantity = config.boxOrders.reduce((sum, b) => sum + (b.quantity ?? 1), 0);
  }
  return config;
}

function fromStoredCustom(stored: UpcomingOrderCustom): OrderConfiguration {
  const config: OrderConfiguration = {
    serviceType: 'Custom',
  };
  if (stored.caseId) config.caseId = stored.caseId;
  if (stored.custom_name) config.custom_name = stored.custom_name;
  if (stored.custom_price != null) config.custom_price = stored.custom_price;
  if (stored.vendorId) config.vendorId = stored.vendorId;
  if (stored.deliveryDay) config.deliveryDay = stored.deliveryDay;
  if (stored.notes) config.notes = stored.notes;
  // UI expects customItems array
  if (stored.custom_name || stored.custom_price != null) {
    config.customItems = [{
      name: stored.custom_name ?? 'Custom',
      price: typeof stored.custom_price === 'number' ? stored.custom_price : parseFloat(String(stored.custom_price || 0)) || 0,
      quantity: 1,
    }];
  }
  return config;
}

function fromStoredFoodMeal(stored: UpcomingOrderFoodMeal): OrderConfiguration {
  const config: OrderConfiguration = {
    serviceType: stored.serviceType as ServiceType,
  };
  if (stored.caseId) config.caseId = stored.caseId;
  if (stored.notes) config.notes = stored.notes;
  if (stored.vendorSelections && stored.vendorSelections.length > 0) {
    config.vendorSelections = stored.vendorSelections.map((s) => ({
      vendorId: s.vendorId,
      items: s.items ?? {},
      ...(s.itemNotes && Object.keys(s.itemNotes).length > 0 && { itemNotes: s.itemNotes }),
    }));
  }
  if (stored.deliveryDayOrders && Object.keys(stored.deliveryDayOrders).length > 0) {
    config.deliveryDayOrders = {};
    for (const [day, dayOrder] of Object.entries(stored.deliveryDayOrders)) {
      config.deliveryDayOrders[day] = {
        vendorSelections: (dayOrder.vendorSelections ?? []).map((s) => ({
          vendorId: s.vendorId,
          items: s.items ?? {},
          ...(s.itemNotes && Object.keys(s.itemNotes).length > 0 && { itemNotes: s.itemNotes }),
        })),
      };
    }
  }
  if (stored.mealSelections && Object.keys(stored.mealSelections).length > 0) {
    config.mealSelections = stored.mealSelections;
  }
  return config;
}

function fromStoredProduce(stored: UpcomingOrderProduce): OrderConfiguration {
  const config: OrderConfiguration = {
    serviceType: 'Produce',
  };
  if (stored.caseId) config.caseId = stored.caseId;
  if (stored.billAmount != null) config.billAmount = stored.billAmount;
  if (stored.notes) config.notes = stored.notes;
  return config;
}

/**
 * Build UI OrderConfiguration from stored upcoming_order (or legacy shape).
 * Handles legacy payloads (e.g. Boxes with only vendorId/items, Custom with only customItems).
 */
export function fromStoredUpcomingOrder(
  stored: unknown,
  serviceType: ServiceType
): OrderConfiguration | null {
  if (stored == null) return null;
  if (typeof stored !== 'object') return null;

  const o = stored as Record<string, unknown>;
  const st = (o.serviceType ?? serviceType) as string;

  if (isUpcomingOrderBoxes(stored)) return fromStoredBoxes(stored);
  if (isUpcomingOrderCustom(stored)) return fromStoredCustom(stored);
  if (isUpcomingOrderFoodMeal(stored)) return fromStoredFoodMeal(stored);
  if (isUpcomingOrderProduce(stored)) return fromStoredProduce(stored);

  // Legacy: no serviceType or unknown shape
  if (st === 'Boxes' || serviceType === 'Boxes') {
    const boxOrders = Array.isArray(o.boxOrders)
      ? o.boxOrders
      : Array.isArray(o.boxes)
        ? o.boxes
        : o.vendorId != null || o.boxTypeId != null || (o.items && typeof o.items === 'object')
          ? [{
            boxTypeId: o.boxTypeId,
            vendorId: o.vendorId,
            quantity: o.boxQuantity ?? 1,
            items: (o.items as Record<string, number>) ?? {},
            itemNotes: (o.itemNotes as Record<string, string>) ?? {},
          }]
          : [];
    return fromStoredBoxes({
      serviceType: 'Boxes',
      caseId: o.caseId as string | undefined,
      boxOrders: boxOrders as BoxOrderEntry[],
      notes: o.notes as string | undefined,
    });
  }

  if (st === 'Custom' || st === 'Vendor' || serviceType === 'Custom' || serviceType === 'Vendor') {
    const customItems = o.customItems as Array<{ name?: string; price?: number; quantity?: number }> | undefined;
    const primary = Array.isArray(customItems) && customItems.length > 0 ? customItems[0] : null;
    return fromStoredCustom({
      serviceType: 'Custom',
      caseId: o.caseId as string | undefined,
      custom_name: (o.custom_name as string) ?? primary?.name,
      custom_price: (o.custom_price as number) ?? primary?.price,
      vendorId: o.vendorId as string | undefined,
      deliveryDay: o.deliveryDay as string | undefined,
      notes: o.notes as string | undefined,
    });
  }

  if (st === 'Produce' || serviceType === 'Produce') {
    return fromStoredProduce({
      serviceType: 'Produce',
      caseId: o.caseId as string | undefined,
      billAmount: o.billAmount as number | undefined,
      notes: o.notes as string | undefined,
    });
  }

  // Default: Food/Meal
  return fromStoredFoodMeal({
    serviceType: serviceType === 'Meal' ? 'Meal' : 'Food',
    caseId: o.caseId as string | undefined,
    vendorSelections: (o.vendorSelections as VendorSelection[]) ?? [],
    deliveryDayOrders: (o.deliveryDayOrders as Record<string, { vendorSelections: VendorSelection[] }>) ?? {},
    mealSelections: (o.mealSelections as Record<string, MealSelection>) ?? {},
    notes: o.notes as string | undefined,
  });
}
