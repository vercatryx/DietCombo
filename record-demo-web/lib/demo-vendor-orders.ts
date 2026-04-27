/**
 * Synthetic vendor orders for the record-demo aggregate vendor view
 * (`/vendors/cccccccc-cccc-cccc-cccc-cccccccccccc`) and matching API routes.
 */

import { getStoreSnapshot, DEMO_MENU_ITEMS, DEMO_BOX_STANDARD, DEMO_VENDOR_PRIMARY } from './demo-store';

/** Same id as production “all vendors” aggregate — demo vendors index redirects here */
export const RECORD_DEMO_AGGREGATE_VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const DELIVERY_DATES = [
  '2026-04-22',
  '2026-04-23',
  '2026-04-24',
  '2026-04-25',
  '2026-04-28',
  '2026-04-29',
  '2026-04-30',
  '2026-05-01',
  '2026-05-02',
  '2026-05-05',
  '2026-05-06',
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function totalFoodItems(items: { quantity?: string | number }[]): number {
  let n = 0;
  for (const it of items) {
    n += parseInt(String(it.quantity ?? 0), 10) || 0;
  }
  return n;
}

function totalBoxItems(items: Record<string, unknown>): number {
  let n = 0;
  for (const v of Object.values(items)) {
    if (typeof v === 'number') n += v;
    else if (v && typeof v === 'object' && 'quantity' in (v as object))
      n += parseInt(String((v as { quantity?: unknown }).quantity ?? 0), 10) || 0;
    else n += parseInt(String(v), 10) || 0;
  }
  return n;
}

/** Full synthetic order list for the aggregate vendor (matches VendorDetail / CSV expectations). */
export function buildSyntheticVendorOrders(): any[] {
  const menuSoup = DEMO_MENU_ITEMS[0];
  const menuSalad = DEMO_MENU_ITEMS[1];
  const out: any[] = [];

  for (const c of getStoreSnapshot()) {
    if (c.parentClientId) continue;

    if (c.serviceType === 'Produce') continue;

    if (c.serviceType === 'Boxes') {
      const dk = DELIVERY_DATES[hashId(c.id) % DELIVERY_DATES.length];
      out.push({
        id: `demo-vord-box-${c.id}`,
        vendor_id: RECORD_DEMO_AGGREGATE_VENDOR_ID,
        client_id: c.id,
        service_type: 'Boxes',
        scheduled_delivery_date: dk,
        created_at: new Date().toISOString(),
        boxSelection: {
          box_type_id: DEMO_BOX_STANDARD,
          quantity: 1,
          items: {
            [menuSoup.id]: 2,
            [menuSalad.id]: 1,
          },
        },
      });
      continue;
    }

    if (c.serviceType !== 'Food' && c.serviceType !== 'Meal') continue;

    const noDate = c.id === 'demo-cli-001' || c.id === 'demo-cli-002';
    const dk = noDate ? null : DELIVERY_DATES[hashId(c.id + 'x') % DELIVERY_DATES.length];

    const qSoup = 1 + (hashId(c.id) % 4);
    const qSalad = 1 + (hashId(c.id + 'y') % 3);

    out.push({
      id: `demo-vord-food-${c.id}`,
      vendor_id: RECORD_DEMO_AGGREGATE_VENDOR_ID,
      client_id: c.id,
      service_type: 'Food',
      scheduled_delivery_date: dk,
      created_at: new Date().toISOString(),
      items: [
        {
          id: `${c.id}-oi-soup`,
          menu_item_id: menuSoup.id,
          quantity: qSoup,
          menuItemName: menuSoup.name,
        },
        {
          id: `${c.id}-oi-salad`,
          menu_item_id: menuSalad.id,
          quantity: qSalad,
          menuItemName: menuSalad.name,
        },
      ],
    });
  }

  return out;
}

export function filterVendorOrdersByDeliveryDate(orders: any[], deliveryDate?: string): any[] {
  if (!deliveryDate) return orders;
  if (deliveryDate === 'no-date') {
    return orders.filter((o) => !o.scheduled_delivery_date);
  }
  const key = deliveryDate.slice(0, 10);
  return orders.filter((o) => {
    if (!o.scheduled_delivery_date) return false;
    const raw = o.scheduled_delivery_date;
    const cal = typeof raw === 'string' ? raw.slice(0, 10) : String(raw).slice(0, 10);
    return cal === key;
  });
}

export type DemoDateSummaryRow = { date_key: string; order_count: number; total_items: number };

function summarizeOrders(orders: any[]): DemoDateSummaryRow[] {
  const buckets = new Map<string, { order_count: number; total_items: number }>();

  for (const o of orders) {
    const dateKey = o.scheduled_delivery_date
      ? String(o.scheduled_delivery_date).slice(0, 10)
      : 'no-date';

    let itemTotal = 0;
    if (o.service_type === 'Food' && Array.isArray(o.items)) {
      itemTotal = totalFoodItems(o.items);
    } else if (o.service_type === 'Boxes' && o.boxSelection?.items) {
      itemTotal = totalBoxItems(o.boxSelection.items as Record<string, unknown>);
    }

    const cur = buckets.get(dateKey) ?? { order_count: 0, total_items: 0 };
    cur.order_count += 1;
    cur.total_items += itemTotal;
    buckets.set(dateKey, cur);
  }

  const rows: DemoDateSummaryRow[] = [];
  for (const [date_key, v] of buckets) {
    rows.push({ date_key, order_count: v.order_count, total_items: v.total_items });
  }
  rows.sort((a, b) => {
    if (a.date_key === 'no-date') return 1;
    if (b.date_key === 'no-date') return -1;
    return b.date_key.localeCompare(a.date_key);
  });
  return rows;
}

/** Response body for GET .../orders/summary?since= — matches production RPC shape */
export function buildVendorOrderSummarySince(sinceDate: string): { rows: DemoDateSummaryRow[]; total_dates: number } {
  const all = buildSyntheticVendorOrders();
  const fullSummary = summarizeOrders(all);
  const since = sinceDate.trim().slice(0, 10);
  const rows = fullSummary.filter((r) => r.date_key === 'no-date' || r.date_key >= since);
  return { rows, total_dates: fullSummary.length };
}

/** Legacy full summary array (no `since`) */
export function buildVendorOrderSummaryAll(): DemoDateSummaryRow[] {
  return summarizeOrders(buildSyntheticVendorOrders());
}

export function demoVendorHandles(vendorId: string): boolean {
  return vendorId === RECORD_DEMO_AGGREGATE_VENDOR_ID || vendorId === DEMO_VENDOR_PRIMARY;
}
