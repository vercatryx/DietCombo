import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/**
 * Public API: Process orders
 *
 * GET/POST /api/process-orders
 *
 * 1. Queries meal_planner_custom_items where expiration_date equals the scan date
 * 2. Fetches related meal_planner_orders
 * 3. Queries clients.upcoming_order for each client_id
 * 4. Fetches meal_planner_order_items for each meal_planner_order
 * 5. Consolidates items from upcoming_order + meal_planner_order_items and creates orders records
 *
 * Response includes:
 * - counts (meal_planner_orders, orders_created)
 * - errors (if any)
 * - scannedAt timestamp
 */

type ConsolidatedItem = {
  vendor_id: string | null;
  menu_item_id: string | null;
  meal_item_id: string | null;
  quantity: number;
  custom_name: string | null;
  custom_price: number | null;
};

function extractItemsFromUpcomingOrder(upcomingOrder: unknown): ConsolidatedItem[] {
  const items: ConsolidatedItem[] = [];
  const uo = typeof upcomingOrder === 'string' ? (() => { try { return JSON.parse(upcomingOrder); } catch { return {}; } })() : (upcomingOrder as Record<string, unknown>) ?? {};
  const vendorSelections = (uo.vendorSelections as Array<{ vendorId?: string; items?: Record<string, number> }>) ?? [];
  for (const vs of vendorSelections) {
    const vendorId = vs.vendorId ?? null;
    const itemMap = vs.items ?? {};
    for (const [menuItemId, qty] of Object.entries(itemMap)) {
      if (qty > 0) items.push({ vendor_id: vendorId, menu_item_id: menuItemId, meal_item_id: null, quantity: qty, custom_name: null, custom_price: null });
    }
  }
  const mealSelections = (uo.mealSelections as Record<string, { vendorId?: string; items?: Record<string, number> }>) ?? {};
  for (const meal of Object.values(mealSelections)) {
    const vendorId = meal?.vendorId ?? null;
    const itemMap = meal?.items ?? {};
    for (const [menuItemId, qty] of Object.entries(itemMap)) {
      if (qty > 0) items.push({ vendor_id: vendorId, menu_item_id: menuItemId, meal_item_id: null, quantity: qty, custom_name: null, custom_price: null });
    }
  }
  const deliveryDayOrders = (uo.deliveryDayOrders as Record<string, { vendorSelections?: Array<{ vendorId?: string; items?: Record<string, number> }> }>) ?? {};
  for (const day of Object.values(deliveryDayOrders)) {
    const vsList = (day as { vendorSelections?: Array<{ vendorId?: string; items?: Record<string, number> }> })?.vendorSelections ?? [];
    for (const vs of vsList) {
      const vendorId = vs.vendorId ?? null;
      const itemMap = vs.items ?? {};
      for (const [menuItemId, qty] of Object.entries(itemMap)) {
        if (qty > 0) items.push({ vendor_id: vendorId, menu_item_id: menuItemId, meal_item_id: null, quantity: qty, custom_name: null, custom_price: null });
      }
    }
  }
  return items;
}

async function getNextOrderNumbers(supabase: any, count: number): Promise<number[]> {
  const { data } = await supabase.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle();
  const max = (data as { order_number?: number } | null)?.order_number ?? 99999;
  const base = Math.max(max + 1, 100000);
  return Array.from({ length: count }, (_, i) => base + i);
}
async function scanOrderTables() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Default vendor (one-vendor app): is_default = true, or first vendor
  let defaultVendorId: string | null = null;
  const { data: defaultVendor } = await supabase.from('vendors').select('id').eq('is_default', true).maybeSingle();
  if (defaultVendor?.id) {
    defaultVendorId = defaultVendor.id as string;
  } else {
    const { data: firstVendor } = await supabase.from('vendors').select('id').limit(1).maybeSingle();
    if (firstVendor?.id) defaultVendorId = firstVendor.id as string;
  }

  const scanDate = new Date().toISOString().slice(0, 10);

  // 1. Query meal_planner_custom_items where expiration_date equals the scan date
  const { data: customItems, error: customError } = await supabase
    .from('meal_planner_custom_items')
    .select('calendar_date, client_id')
    .eq('expiration_date', scanDate);

  if (customError) {
    throw new Error(`meal_planner_custom_items scan failed: ${customError.message}`);
  }

  const rows = customItems ?? [];
  const datesWithDefault = new Set<string>();
  const dateClientPairs = new Set<string>();
  for (const r of rows) {
    const dateStr = r.calendar_date ? String(r.calendar_date).slice(0, 10) : null;
    if (!dateStr) continue;
    if (r.client_id == null || r.client_id === '') {
      datesWithDefault.add(dateStr);
    } else {
      dateClientPairs.add(`${dateStr}|${r.client_id}`);
    }
  }

  const qualifyingDates = [...new Set([...datesWithDefault, ...dateClientPairs].map((k) => (k.includes('|') ? k.split('|')[0] : k)))];
  if (qualifyingDates.length === 0) {
    return {
      counts: { meal_planner_orders: 0, orders_created: 0 },
      orders: [],
      errors: [],
      scannedAt: new Date().toISOString(),
    };
  }

  // 2. Fetch related meal_planner_orders for those (date, client) combinations (only unprocessed to avoid duplicates)
  const { data: ordersData, error: ordersError } = await supabase
    .from('meal_planner_orders')
    .select('*')
    .in('scheduled_delivery_date', qualifyingDates)
    .is('processed_order_id', null)
    .order('scheduled_delivery_date', { ascending: false });

  if (ordersError) {
    throw new Error(`meal_planner_orders scan failed: ${ordersError.message}`);
  }

  const allOrders = ordersData ?? [];
  const mealPlannerOrders = allOrders.filter((order: { scheduled_delivery_date: string | null; client_id: string; processed_order_id?: string | null }) => {
    const dateStr = order.scheduled_delivery_date ? String(order.scheduled_delivery_date).slice(0, 10) : null;
    if (!dateStr) return false;
    if (datesWithDefault.has(dateStr)) return true;
    if (!dateClientPairs.has(`${dateStr}|${order.client_id}`)) return false;
    // Idempotency: skip already processed — order was already created for this meal planner order
    const processedId = order.processed_order_id;
    if (processedId != null && String(processedId).trim() !== '') return false;
    return true;
  });

  if (mealPlannerOrders.length === 0) {
    return {
      counts: { meal_planner_orders: 0, orders_created: 0 },
      orders: [],
      errors: [],
      scannedAt: new Date().toISOString(),
    };
  }

  const clientIds = [...new Set(mealPlannerOrders.map((o: { client_id: string }) => o.client_id))];
  const mpoIds = mealPlannerOrders.map((o: { id: string }) => o.id);
  const mpoIdSet = new Set(mpoIds);

  // 3 & 4. Fetch clients (upcoming_order, full_name) + meal_planner_order_items in parallel
  async function fetchClients(): Promise<{ upcomingByClient: Map<string, unknown>; clientNameById: Map<string, string> }> {
    const upcomingByClient = new Map<string, unknown>();
    const clientNameById = new Map<string, string>();
    if (clientIds.length === 0) return { upcomingByClient, clientNameById };
    const clientIdSet = new Set(clientIds);
    const r = await supabase.from('clients').select('id, upcoming_order, full_name').in('id', clientIds);
    if (!r.error) {
      const rows = (r.data ?? []) as unknown as Array<{ id: string; upcoming_order?: unknown; full_name?: string | null }>;
      rows.forEach((c) => {
        upcomingByClient.set(String(c.id), c.upcoming_order);
        clientNameById.set(String(c.id), c.full_name ?? '');
      });
      return { upcomingByClient, clientNameById };
    }
    const rAll = await supabase.from('clients').select('id, upcoming_order, full_name');
    if (!rAll.error && rAll.data) {
      const rows = rAll.data as unknown as Array<{ id: string; upcoming_order?: unknown; full_name?: string | null }>;
      rows.filter((c) => clientIdSet.has(String(c.id))).forEach((c) => {
        upcomingByClient.set(String(c.id), c.upcoming_order);
        clientNameById.set(String(c.id), c.full_name ?? '');
      });
    } else {
      throw new Error(`clients scan failed: ${(rAll as { error?: { message?: string } }).error?.message}`);
    }
    return { upcomingByClient, clientNameById };
  }

  async function fetchMpoItems() {
    const r = await supabase.from('meal_planner_order_items').select('meal_planner_order_id, menu_item_id, meal_item_id, quantity, custom_name, custom_price').in('meal_planner_order_id', mpoIds);
    if (!r.error) return r.data as unknown as Array<{ meal_planner_order_id: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number; custom_name: string | null; custom_price: unknown }>;
    const rAll = await supabase.from('meal_planner_order_items').select('meal_planner_order_id, menu_item_id, meal_item_id, quantity, custom_name, custom_price');
    if (!rAll.error && rAll.data) {
      return (rAll.data as unknown as Array<{ meal_planner_order_id: string }>).filter((row) => mpoIdSet.has(row.meal_planner_order_id)) as Array<{ meal_planner_order_id: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number; custom_name: string | null; custom_price: unknown }>;
    }
    throw new Error(`meal_planner_order_items scan failed: ${r.error?.message}`);
  }

  const [{ upcomingByClient, clientNameById }, mpoItemsData] = await Promise.all([fetchClients(), fetchMpoItems()]);

  const itemsByMpoId = new Map<string, Array<{ menu_item_id: string | null; meal_item_id: string | null; quantity: number; custom_name: string | null; custom_price: number | null }>>();
  for (const row of mpoItemsData) {
    const r = row as { meal_planner_order_id: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number; custom_name: string | null; custom_price: unknown };
    const list = itemsByMpoId.get(r.meal_planner_order_id) ?? [];
    list.push({
      menu_item_id: r.menu_item_id ?? null,
      meal_item_id: r.meal_item_id ?? null,
      quantity: r.quantity ?? 1,
      custom_name: r.custom_name ?? null,
      custom_price: r.custom_price != null ? Number(r.custom_price) : null,
    });
    itemsByMpoId.set(r.meal_planner_order_id, list);
  }

  // Fetch default order template (Food) for when client.upcoming_order is empty
  let defaultTemplateItems: ConsolidatedItem[] = [];
  const { data: settingsData } = await supabase.from('settings').select('value').eq('key', 'default_order_template').maybeSingle();
  if (settingsData?.value) {
    try {
      const parsed = typeof settingsData.value === 'string' ? JSON.parse(settingsData.value) : settingsData.value;
      const foodTemplate = parsed?.Food ?? (parsed?.serviceType === 'Food' ? parsed : null);
      if (foodTemplate) {
        defaultTemplateItems = extractItemsFromUpcomingOrder(foodTemplate);
      }
    } catch {
      /* ignore parse error */
    }
  }

  const errors: string[] = [];
  const ordersWithItems: Array<{
    order_id: string;
    client_id: string;
    client_name: string;
    vendor_selection_id: string;
    expiration_date: string;
    item_counts: number;
    items: ConsolidatedItem[];
  }> = [];

  // 5. Build payloads for orders to create (no DB writes yet)
  type OrderPayload = { mpo: { id: string; client_id: string; case_id: string | null; scheduled_delivery_date: string | null; delivery_day: string | null; total_value: number | null; notes: string | null }; orderId: string; orderNumber: number; allItems: ConsolidatedItem[] };
  const toCreate: OrderPayload[] = [];

  for (const mpo of mealPlannerOrders) {
    const mpoTyped = mpo as { id: string; client_id: string; case_id: string | null; scheduled_delivery_date: string | null; delivery_day: string | null; total_value: number | null; notes: string | null };
    const upcomingOrder = upcomingByClient.get(mpoTyped.client_id);
    let itemsFromUpcoming = extractItemsFromUpcomingOrder(upcomingOrder);
    if (itemsFromUpcoming.length === 0 && defaultTemplateItems.length > 0) {
      itemsFromUpcoming = defaultTemplateItems;
    }
    const mpoItems = itemsByMpoId.get(mpoTyped.id) ?? [];
    const itemsFromMealPlanner: ConsolidatedItem[] = mpoItems.map((i) => ({
      vendor_id: null,
      menu_item_id: i.menu_item_id,
      meal_item_id: i.meal_item_id,
      quantity: i.quantity,
      custom_name: i.custom_name,
      custom_price: i.custom_price,
    }));
    const allItems = [...itemsFromUpcoming, ...itemsFromMealPlanner];
    if (allItems.length === 0) continue;
    const totalItems = allItems.reduce((sum, i) => sum + i.quantity, 0);
    toCreate.push({
      mpo: { ...mpoTyped },
      orderId: randomUUID(),
      orderNumber: 0,
      allItems,
    });
  }

  if (toCreate.length === 0) {
    return {
      counts: { meal_planner_orders: mealPlannerOrders.length, orders_created: 0 },
      orders: [],
      errors: errors.length > 0 ? errors : undefined,
      scannedAt: new Date().toISOString(),
    };
  }

  if (defaultVendorId == null) {
    errors.push('No vendor found. Add a vendor (or set one as default) in the vendors table.');
    return {
      counts: { meal_planner_orders: mealPlannerOrders.length, orders_created: 0 },
      orders: [],
      errors,
      scannedAt: new Date().toISOString(),
    };
  }

  const orderNumbers = await getNextOrderNumbers(supabase, toCreate.length);
  toCreate.forEach((o, i) => { o.orderNumber = orderNumbers[i]; });

  const ordersPayload = toCreate.map((o) => {
    const orderVendorId = o.allItems.find((i) => i.vendor_id != null)?.vendor_id ?? defaultVendorId;
    return {
      id: o.orderId,
      client_id: o.mpo.client_id,
      service_type: 'Food',
      case_id: o.mpo.case_id ?? null,
      status: 'pending',
      scheduled_delivery_date: o.mpo.scheduled_delivery_date ?? null,
      delivery_day: o.mpo.delivery_day ?? null,
      total_value: o.mpo.total_value ?? null,
      total_items: o.allItems.reduce((s, i) => s + i.quantity, 0),
      notes: o.mpo.notes ?? null,
      order_number: o.orderNumber,
      vendor_id: orderVendorId,
    };
  });

  const { error: ordersInsertErr } = await supabase.from('orders').insert(ordersPayload);
  if (ordersInsertErr) {
    errors.push(`orders batch insert failed: ${ordersInsertErr.message}`);
    return {
      counts: { meal_planner_orders: mealPlannerOrders.length, orders_created: 0 },
      orders: [],
      errors,
      scannedAt: new Date().toISOString(),
    };
  }

  // Build order_vendor_selections (one per order) and order_items so every new order has vendor selections.
  const allVsPayload: Array<{ id: string; order_id: string; vendor_id: string }> = [];
  const allItemsPayload: Array<{ id: string; vendor_selection_id: string; quantity: number; menu_item_id?: string; meal_item_id?: string; custom_name?: string; custom_price?: number }> = [];

  for (const o of toCreate) {
    const firstVendorId = o.allItems.find((i) => i.vendor_id != null)?.vendor_id ?? defaultVendorId!;
    const vsId = randomUUID();
    const itemCounts = o.allItems.reduce((s, i) => s + i.quantity, 0);
    ordersWithItems.push({
      order_id: o.orderId,
      client_id: o.mpo.client_id,
      client_name: clientNameById.get(o.mpo.client_id) ?? '',
      vendor_selection_id: vsId,
      expiration_date: scanDate,
      item_counts: itemCounts,
      items: o.allItems,
    });
    // One order_vendor_selection per order — required for every new order
    allVsPayload.push({ id: vsId, order_id: o.orderId, vendor_id: firstVendorId });
    for (const item of o.allItems) {
      const p: { id: string; vendor_selection_id: string; quantity: number; menu_item_id?: string; meal_item_id?: string; custom_name?: string; custom_price?: number } = {
        id: randomUUID(),
        vendor_selection_id: vsId,
        quantity: item.quantity,
      };
      if (item.menu_item_id != null) p.menu_item_id = item.menu_item_id;
      if (item.meal_item_id != null) p.meal_item_id = item.meal_item_id;
      if (item.custom_name != null) p.custom_name = item.custom_name;
      if (item.custom_price != null) p.custom_price = item.custom_price;
      allItemsPayload.push(p);
    }
  }

  // Insert order_vendor_selections for every new order (required for orders to be valid).
  if (allVsPayload.length > 0) {
    const { error: vsErr } = await supabase.from('order_vendor_selections').insert(allVsPayload);
    if (vsErr) {
      errors.push(`order_vendor_selections batch insert failed: ${vsErr.message}`);
      return {
        counts: { meal_planner_orders: mealPlannerOrders.length, orders_created: 0 },
        orders: [],
        errors,
        scannedAt: new Date().toISOString(),
      };
    }
  }
  if (allItemsPayload.length > 0) {
    const itemsErr = await supabase.from('order_items').insert(allItemsPayload);
    if (itemsErr.error) errors.push(`order_items batch insert failed: ${itemsErr.error.message}`);
  }

  // Mark meal_planner_orders as processed so re-running this endpoint does not create duplicate orders
  for (const o of toCreate) {
    const { error: updateErr } = await supabase
      .from('meal_planner_orders')
      .update({
        processed_order_id: o.orderId,
        processed_at: new Date().toISOString(),
      })
      .eq('id', o.mpo.id);
    if (updateErr) errors.push(`meal_planner_orders update failed for ${o.mpo.id}: ${updateErr.message}`);
  }

  return {
    counts: {
      meal_planner_orders: mealPlannerOrders.length,
      orders_created: toCreate.length,
    },
    orders: ordersWithItems,
    errors: errors.length > 0 ? errors : undefined,
    scannedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const scan = await scanOrderTables();
    return NextResponse.json({
      success: true,
      message: 'Scan completed: meal_planner_orders processed, orders created from consolidated items',
      ...scan,
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    console.error('[process-orders] GET error:', error);
    return NextResponse.json({
      success: false,
      error: message,
      scannedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const scan = await scanOrderTables();
    return NextResponse.json({
      success: true,
      message: 'Scan completed: meal_planner_orders processed, orders created from consolidated items',
      ...scan,
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    console.error('[process-orders] POST error:', error);
    return NextResponse.json({
      success: false,
      error: message,
      scannedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
