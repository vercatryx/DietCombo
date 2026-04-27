'use server';

import { randomUUID } from 'crypto';
import type {
  AppSettings,
  ClientProfile,
  ClientFullDetails,
  ServiceType,
  MenuItem,
  Vendor,
  BoxType,
  CompletedOrderWithDeliveryProof,
  DeliveryRecord,
  BillingRecord,
} from '../../lib/types';

type OrderReferenceData = { menuItems: MenuItem[]; vendors: Vendor[]; boxTypes: BoxType[] };

/** Mirrors `lib/actions` shape for meal plan edits reporting */
type MealPlanEditEntry = {
  clientId: string;
  clientName: string;
  scheduledDeliveryDate: string;
  items: { id: string; name: string; quantity: number; value: number | null }[];
};
import type { MealPlannerOrderResult } from '../../lib/meal-planner-utils';
import {
  findClient,
  upsertClient,
  getStoreSnapshot,
  DEMO_STATUSES,
  DEMO_NAVIGATORS,
  DEMO_VENDORS,
  DEMO_MENU_ITEMS,
  DEMO_BOX_TYPES,
  DEMO_CATEGORIES,
  DEMO_PRODUCE_VENDORS,
  DEMO_VENDOR_PRIMARY,
  DEMO_STATUS_ACTIVE,
  seedClients,
  replaceStore,
  getSettingsSnapshot,
  replaceSettings,
} from './demo-store';
import {
  buildSyntheticVendorOrders,
  demoVendorHandles,
  filterVendorOrdersByDeliveryDate,
} from './demo-vendor-orders';

function cloneDetails(client: ClientProfile): ClientFullDetails {
  return {
    client,
    history: [] as DeliveryRecord[],
    orderHistory: [],
    billingHistory: [] as BillingRecord[],
    activeOrder: client.activeOrder ?? null,
    upcomingOrder: null,
    submissions: [],
    mealPlanData: [],
  };
}

export async function getStatuses() {
  return DEMO_STATUSES;
}

export async function getNavigators() {
  return DEMO_NAVIGATORS;
}

export async function getVendors() {
  return DEMO_VENDORS;
}

export async function getVendor(id: string) {
  return DEMO_VENDORS.find((v) => v.id === id) || DEMO_VENDORS[0] || null;
}

export async function getOrdersByVendor(vendorId: string, deliveryDate?: string) {
  if (!demoVendorHandles(vendorId)) return [];
  const all = buildSyntheticVendorOrders();
  return filterVendorOrdersByDeliveryDate(all, deliveryDate);
}

export async function getMenuItems() {
  return DEMO_MENU_ITEMS;
}

export async function getBoxTypes() {
  return DEMO_BOX_TYPES;
}

export async function getCategories() {
  return DEMO_CATEGORIES;
}

/** Admin DefaultOrderTemplate meal planner calendar — stubs returned `undefined` and broke `counts[dateKey]` */
export async function getMealPlannerItemCountsByDate(
  _startDate: string,
  _endDate: string,
  _clientId?: string | null,
): Promise<Record<string, number>> {
  return {};
}

export async function getMealPlannerCustomItems(
  _dateKey: string,
  _clientId?: string | null,
): Promise<{
  items: { id: string; name: string; quantity: number; value: number | null; sortOrder: number }[];
  expirationDate: string | null;
  expectedTotalMeals: number | null;
}> {
  return { items: [], expirationDate: null, expectedTotalMeals: null };
}

export async function getEquipment() {
  return [];
}

export async function getSettings() {
  return getSettingsSnapshot();
}

export async function updateSettings(settings: AppSettings) {
  replaceSettings(settings);
}

export async function getMealPlanEditsByDeliveryDate(deliveryDate: string): Promise<MealPlanEditEntry[]> {
  const dateOnly = deliveryDate.trim().slice(0, 10);
  const result: MealPlanEditEntry[] = [];
  for (const c of getStoreSnapshot()) {
    if (!c.mealPlannerData?.length) continue;
    const entry = c.mealPlannerData.find((e) => (e.scheduledDeliveryDate || '').slice(0, 10) === dateOnly);
    if (!entry) continue;
    const items = Array.isArray(entry.items)
      ? entry.items.map((i, idx) => ({
          id: i.id ?? `item-${idx}`,
          name: (i.name ?? 'Item').trim(),
          quantity: Math.max(0, Number(i.quantity) || 0),
          value: i.value != null && !Number.isNaN(Number(i.value)) ? Number(i.value) : null,
        }))
      : [];
    result.push({
      clientId: c.id,
      clientName: c.fullName,
      scheduledDeliveryDate: dateOnly,
      items,
    });
  }
  return result.sort((a, b) => a.clientName.localeCompare(b.clientName));
}

export async function getMealPlanEditCountsByMonth(
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const start = startDate.trim().slice(0, 10);
  const end = endDate.trim().slice(0, 10);
  const counts: Record<string, number> = {};
  for (const c of getStoreSnapshot()) {
    if (!c.mealPlannerData?.length) continue;
    for (const day of c.mealPlannerData) {
      const dk = (day.scheduledDeliveryDate || '').slice(0, 10);
      if (!dk || dk < start || dk > end) continue;
      const hasItems = day.items.some((i) => Number(i.quantity) > 0);
      if (!hasItems) continue;
      counts[dk] = (counts[dk] ?? 0) + 1;
    }
  }
  return counts;
}

export async function getProduceVendors() {
  return DEMO_PRODUCE_VENDORS;
}

export async function getClients() {
  return getStoreSnapshot();
}

export async function getRegularClients() {
  return getStoreSnapshot().filter((c) => !c.parentClientId);
}

export async function getClient(id: string) {
  const c = findClient(id);
  return c ? { ...c } : undefined;
}

export async function getClientNamesByIds(ids: string[]) {
  const map: Record<string, string> = {};
  for (const id of ids) {
    const c = findClient(id);
    if (c) map[id] = c.fullName;
  }
  return map;
}

export async function getNavigatorLogs(_navigatorId: string) {
  return [] as { id: string; createdAt: string; unitsAdded: number }[];
}

export async function getClientsPaginated(
  _page: number,
  _pageSize: number,
  searchQuery = '',
  _filter?: 'needs-vendor',
  options?: { brooklynOnly?: boolean },
) {
  let rows = getStoreSnapshot();
  if (options?.brooklynOnly) {
    rows = rows.filter((c) => (c.uniteAccount || '').toLowerCase() === 'brooklyn');
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q),
    );
  }
  return { clients: rows, total: rows.length };
}

export async function getClientFullDetails(clientId: string): Promise<ClientFullDetails | null> {
  const c = findClient(clientId);
  return c ? cloneDetails({ ...c }) : null;
}

export async function getBatchClientDetails(clientIds: string[]) {
  const out: Record<string, ClientFullDetails | null> = {};
  for (const id of clientIds) {
    const c = findClient(id);
    out[id] = c ? cloneDetails({ ...c }) : null;
  }
  return out;
}

export async function updateClient(clientId: string, payload: Partial<ClientProfile>) {
  const cur = findClient(clientId);
  if (!cur) throw new Error('Client not found');
  const next: ClientProfile = {
    ...cur,
    ...payload,
    id: cur.id,
    updatedAt: new Date().toISOString(),
  };
  upsertClient(next);
  return next;
}

export async function addDependent(
  name: string,
  parentClientId: string,
  dob?: string | null,
  cin?: number | null,
  serviceType: ServiceType = 'Food',
  _produceVendorId?: string | null,
) {
  const parent = findClient(parentClientId);
  if (!parent) throw new Error('Parent client not found');
  const id = `demo-dep-${randomUUID().slice(0, 8)}`;
  const dep: ClientProfile = {
    ...parent,
    id,
    fullName: name.trim(),
    parentClientId,
    dob: dob ?? null,
    cin: cin ?? null,
    serviceType,
    email: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertClient(dep);
  return dep;
}

export async function addClient(data: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = `demo-cli-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const row: ClientProfile = {
    ...(data as ClientProfile),
    id,
    createdAt: now,
    updatedAt: now,
  };
  upsertClient(row);
  return row;
}

export async function getDependentsByParentId(parentId: string) {
  return getStoreSnapshot().filter((c) => c.parentClientId === parentId);
}

export async function getUpcomingOrderForClient(_clientId: string, _caseId?: string | null) {
  return null;
}

export async function getCompletedOrdersWithDeliveryProof(
  _clientId: string,
): Promise<CompletedOrderWithDeliveryProof[]> {
  return [];
}

export async function getBillingHistory(_clientId: string): Promise<BillingRecord[]> {
  return [];
}

export async function getOrderHistory(_clientId: string, _caseId?: string | null) {
  return [];
}

export async function getClientHistory(_clientId: string): Promise<DeliveryRecord[]> {
  return [];
}

export async function getRecentOrdersForClient(clientId: string, _limit?: number) {
  const c = findClient(clientId);
  return c?.activeOrder ?? null;
}

export async function getActiveOrderForClient(
  clientId: string,
  _referenceData?: OrderReferenceData | null,
) {
  const c = findClient(clientId);
  return c?.activeOrder ?? null;
}

export async function getClientBoxOrder(_clientId: string) {
  return null;
}

export async function getDefaultOrderTemplate(_serviceType?: ServiceType) {
  return {
    serviceType: (_serviceType ?? 'Food') as ServiceType,
    vendorSelections: [{ vendorId: DEMO_VENDOR_PRIMARY, items: { [DEMO_MENU_ITEMS[0].id]: 2 } }],
  };
}

export async function getDefaultApprovedMealsPerWeek() {
  return 14;
}

export async function computeDefaultApprovedMealsFromTemplate(_template: unknown, _menuItems: MenuItem[]) {
  return 14;
}

export async function isFoodOrderSameAsDefault(_order: unknown, _defaultTemplate: unknown) {
  return false;
}

export async function getDefaultMealPlanTemplateForNewClient(_clientId: string) {
  return null;
}

export async function getClientPortalPageData(clientId: string, _opts?: unknown) {
  const client = await getClient(clientId);
  if (!client) return null;

  const parentId = client.parentClientId ?? client.id;

  const [statuses, navigators, vendors, menuItems, boxTypes, categories, dependants, parentClient] =
    await Promise.all([
      getStatuses(),
      getNavigators(),
      getVendors(),
      getMenuItems(),
      getBoxTypes(),
      getCategories(),
      getDependentsByParentId(parentId),
      parentId === client.id ? Promise.resolve(client) : getClient(parentId),
    ]);

  const allHousehold = parentClient
    ? [parentClient, ...dependants]
    : [client, ...dependants];
  const householdPeople = allHousehold.filter(
    (p) => p && (p.serviceType === 'Food' || p.serviceType === 'Meal'),
  );

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const loadHouseholdMealPlan =
    client.serviceType === 'Food' ||
    (client.serviceType === 'Produce' && householdPeople.length > 0);

  const [activeOrder, previousOrders, mealPlanData] = await Promise.all([
    getActiveOrderForClient(clientId),
    getOrderHistory(clientId),
    loadHouseholdMealPlan
      ? getMealPlanForMonth(clientId, currentYear, currentMonth)
      : Promise.resolve([]),
  ]);

  return {
    client,
    householdPeople,
    statuses: statuses ?? [],
    navigators: navigators ?? [],
    vendors: vendors ?? [],
    menuItems: menuItems ?? [],
    boxTypes: boxTypes ?? [],
    categories: categories ?? [],
    activeOrder: activeOrder ?? null,
    previousOrders: previousOrders ?? [],
    mealPlanData: Array.isArray(mealPlanData) ? mealPlanData : [],
  };
}

export async function getClientProfilePageData(clientId: string) {
  const client = await getClient(clientId);
  if (!client) return null;

  const [
    statuses,
    navigators,
    vendors,
    menuItems,
    boxTypes,
    settings,
    categories,
    allClientsData,
    regularClientsData,
    dependentsData,
  ] = await Promise.all([
    getStatuses(),
    getNavigators(),
    getVendors(),
    getMenuItems(),
    getBoxTypes(),
    getSettings(),
    getCategories(),
    getClients(),
    getRegularClients(),
    !client.parentClientId ? getDependentsByParentId(client.id) : Promise.resolve([]),
  ]);

  const recent = await getRecentOrdersForClient(clientId);
  const historyData = await getClientHistory(clientId);
  const billingHistoryData = await getBillingHistory(clientId);
  const upcomingOrderDataInitial = await getUpcomingOrderForClient(clientId);
  const orderHistoryData = await getOrderHistory(clientId);

  const caseId = client.serviceType === 'Boxes' ? (client.activeOrder?.caseId ?? null) : null;

  const mealPlanData =
    client.serviceType === 'Food' ? await getClientMealPlannerData(clientId, {}) : [];

  return {
    c: client,
    s: statuses,
    n: navigators,
    v: vendors ?? [],
    m: menuItems ?? [],
    b: boxTypes ?? [],
    appSettings: settings,
    catData: categories ?? [],
    allClientsData: allClientsData ?? [],
    regularClientsData: regularClientsData ?? [],
    activeOrderData: recent,
    historyData: historyData ?? [],
    billingHistoryData: billingHistoryData ?? [],
    upcomingOrderDataInitial: upcomingOrderDataInitial,
    orderHistoryData: orderHistoryData ?? [],
    dependentsData: dependentsData ?? [],
    submissions: [],
    mealPlanData: mealPlanData ?? [],
  };
}

export async function getClientOrderEditData(clientId: string) {
  const client = await getClient(clientId);
  if (!client) return null;
  const [statuses, navigators, vendors, menuItems, boxTypes, categories, settings] = await Promise.all([
    getStatuses(),
    getNavigators(),
    getVendors(),
    getMenuItems(),
    getBoxTypes(),
    getCategories(),
    getSettings(),
  ]);
  return {
    client,
    statuses,
    navigators,
    vendors,
    menuItems,
    boxTypes,
    categories,
    settings,
  };
}

export async function getClientMealPlannerData(
  clientId: string,
  _range?: { startDate?: string; endDate?: string },
): Promise<MealPlannerOrderResult[]> {
  const c = findClient(clientId);
  if (!c?.mealPlannerData?.length) return [];
  const out: MealPlannerOrderResult[] = [];
  for (const day of c.mealPlannerData) {
    const items = day.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      value: it.value ?? null,
    }));
    out.push({
      id: `plan-${day.scheduledDeliveryDate}`,
      scheduledDeliveryDate: day.scheduledDeliveryDate,
      deliveryDay: null,
      status: 'scheduled',
      totalItems: items.reduce((s, i) => s + i.quantity, 0),
      items,
      expirationDate: null,
      expectedTotalMeals: null,
    });
  }
  return out;
}

export async function getAvailableMealPlanTemplateWithAllDates(
  _startDate: string,
  _endDate: string,
): Promise<MealPlannerOrderResult[]> {
  return [];
}

export async function getAvailableMealPlanTemplateWithAllDatesIncludingRecurring(
  _startDate: string,
  _endDate: string,
): Promise<MealPlannerOrderResult[]> {
  return [];
}

export async function getMealPlanForMonth(
  clientId: string,
  year: number,
  month: number,
  _opts?: { includePastAndExpired?: boolean; householdSize?: number },
): Promise<MealPlannerOrderResult[]> {
  const all = await getClientMealPlannerData(clientId);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return all.filter((r) => (r.scheduledDeliveryDate || '').startsWith(prefix));
}

export async function saveClientMealPlannerData(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveClientMealPlannerDataFull(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveClientFoodOrder(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveClientMealOrder(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveClientBoxOrder(..._args: unknown[]) {
  return { success: true as const };
}

export async function saveClientCustomOrder(..._args: unknown[]) {
  return { success: true as const };
}

export async function syncCurrentOrderToUpcoming(..._args: unknown[]) {
  return { success: true as const };
}

export async function getBoxQuotas() {
  return [];
}

export async function updateDeliveryProof(..._args: unknown[]) {
  return { success: true as const };
}

export async function recordClientChange(..._args: unknown[]) {
  return { success: true as const };
}

export async function logNavigatorAction(..._args: unknown[]) {
  return { success: true as const };
}

export async function deleteClient(clientId: string) {
  replaceStore(getStoreSnapshot().filter((c) => c.id !== clientId));
  return { success: true as const };
}

export async function resetRecordDemoDataset() {
  replaceStore(seedClients());
}
