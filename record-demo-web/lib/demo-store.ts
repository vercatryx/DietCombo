import type { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, AppSettings, ProduceVendor } from '../../lib/types';
import { DEMO_PERSONA_ROWS, primaryNameForProfile } from './demoPersonas';

function stripDemoPrefix(name: string) {
  return name.replace(/^DEMO\s*[—–-]\s*/i, '').trim();
}

/** Deterministic IDs for lookups */
export const DEMO_STATUS_ACTIVE = 'demo-status-active';
export const DEMO_STATUS_PAUSED = 'demo-status-paused';
export const DEMO_NAV_A = 'demo-nav-a';
export const DEMO_NAV_B = 'demo-nav-b';
export const DEMO_VENDOR_PRIMARY = 'demo-vendor-main';
export const DEMO_BOX_STANDARD = 'demo-box-standard';
export const DEMO_CAT_MEALS = 'demo-cat-meals';

export const DEMO_STATUSES: ClientStatus[] = [
  {
    id: DEMO_STATUS_ACTIVE,
    name: 'Active',
    deliveriesAllowed: true,
    isSystemDefault: true,
    requiresUnitsOnChange: false,
  },
  {
    id: DEMO_STATUS_PAUSED,
    name: 'Paused',
    deliveriesAllowed: false,
    isSystemDefault: false,
    requiresUnitsOnChange: false,
  },
];

export const DEMO_NAVIGATORS: Navigator[] = [
  { id: DEMO_NAV_A, name: 'Alex Morgan', email: 'alex@example.com', isActive: true },
  { id: DEMO_NAV_B, name: 'Jamie Chen', email: 'jamie@example.com', isActive: true },
];

export const DEMO_VENDORS: Vendor[] = [
  {
    id: DEMO_VENDOR_PRIMARY,
    name: 'Metro Kitchen Co-op',
    email: 'dispatch@example.com',
    isActive: true,
    isDefault: true,
    deliveryDays: ['Monday', 'Wednesday', 'Friday'],
    allowsMultipleDeliveries: true,
    serviceTypes: ['Food', 'Meal'],
    minimumMeals: 0,
  },
];

// ── Menu item IDs ────────────────────────────────────────────────────────────
const MENU_ID_SOUP        = 'demo-menu-soup';
const MENU_ID_SALAD       = 'demo-menu-salad';
const MENU_ID_GRAIN_BOWL  = 'demo-menu-grain-bowl';
const MENU_ID_BFAST_KIT   = 'demo-menu-bfast-kit';
const MENU_ID_FRUIT_PACK  = 'demo-menu-fruit-pack';
const MENU_ID_HYGIENE     = 'demo-menu-hygiene';
const MENU_ID_LAUNDRY     = 'demo-menu-laundry';
const MENU_ID_PAPER_GOODS = 'demo-menu-paper-goods';
const MENU_ID_BABY_KIT    = 'demo-menu-baby-kit';
const MENU_ID_CLEANING    = 'demo-menu-cleaning';

/** Static metadata for every menu item — used to build full-menu item lists. */
const ALL_ITEM_META: { id: string; name: string; value: number }[] = [
  { id: MENU_ID_SOUP,        name: 'Hot entrée · rotating',       value: 8.5 },
  { id: MENU_ID_SALAD,       name: 'Garden salad',                 value: 6   },
  { id: MENU_ID_GRAIN_BOWL,  name: 'Grain & veggie bowl',         value: 9   },
  { id: MENU_ID_BFAST_KIT,   name: 'Breakfast kit',               value: 7   },
  { id: MENU_ID_FRUIT_PACK,  name: 'Seasonal fruit pack',          value: 5.5 },
  { id: MENU_ID_HYGIENE,     name: 'Hygiene essentials pack',      value: 12  },
  { id: MENU_ID_BABY_KIT,    name: 'Infant care kit',              value: 18  },
  { id: MENU_ID_LAUNDRY,     name: 'Laundry detergent (64 loads)', value: 14  },
  { id: MENU_ID_PAPER_GOODS, name: 'Paper goods bundle',           value: 10  },
  { id: MENU_ID_CLEANING,    name: 'All-purpose cleaning kit',     value: 11  },
];

type ItemEntry = { id: string; name: string; quantity: number; value: number };

/**
 * Returns the full menu for one delivery date:
 * - `activeItems` at their given quantities (day-specific section, shown first).
 * - Every other item at quantity 0 with a `recurring-` prefix (shown in the
 *   "Alternate items" section that SavedMealPlanMonth renders when
 *   `includeRecurringInTemplate={true}`).
 */
function buildFullItemList(activeItems: ItemEntry[]): ItemEntry[] {
  const activeIds = new Set(activeItems.map((it) => it.id));
  const alts: ItemEntry[] = ALL_ITEM_META
    .filter((m) => !activeIds.has(m.id))
    .map((m) => ({ id: `recurring-${m.id}`, name: m.name, quantity: 0, value: m.value }));
  return [...activeItems, ...alts];
}

// ── Category IDs ─────────────────────────────────────────────────────────────
export const DEMO_CAT_PREPARED  = DEMO_CAT_MEALS; // keep alias so other refs still work
const DEMO_CAT_PANTRY           = 'demo-cat-pantry';
const DEMO_CAT_PERSONAL_CARE    = 'demo-cat-personal-care';
const DEMO_CAT_HOUSEHOLD        = 'demo-cat-household';

export const DEMO_CATEGORIES: ItemCategory[] = [
  { id: DEMO_CAT_PREPARED,     name: 'Prepared Meals',      sortOrder: 1 },
  { id: DEMO_CAT_PANTRY,       name: 'Pantry Staples',      sortOrder: 2 },
  { id: DEMO_CAT_PERSONAL_CARE,name: 'Personal Care',       sortOrder: 3 },
  { id: DEMO_CAT_HOUSEHOLD,    name: 'Household Essentials', sortOrder: 4 },
];

export const DEMO_MENU_ITEMS: MenuItem[] = [
  // ── Prepared Meals ──────────────────────────────────────────────────────────
  {
    id: MENU_ID_SOUP,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Hot entrée · rotating',
    value: 8.5,
    priceEach: 8.5,
    isActive: true,
    categoryId: DEMO_CAT_PREPARED,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 1,
  },
  {
    id: MENU_ID_SALAD,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Garden salad',
    value: 6,
    priceEach: 6,
    isActive: true,
    categoryId: DEMO_CAT_PREPARED,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 2,
  },
  {
    id: MENU_ID_GRAIN_BOWL,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Grain & veggie bowl',
    value: 9,
    priceEach: 9,
    isActive: true,
    categoryId: DEMO_CAT_PREPARED,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 3,
  },
  {
    id: MENU_ID_BFAST_KIT,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Breakfast kit',
    value: 7,
    priceEach: 7,
    isActive: true,
    categoryId: DEMO_CAT_PANTRY,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 4,
  },
  {
    id: MENU_ID_FRUIT_PACK,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Seasonal fruit pack',
    value: 5.5,
    priceEach: 5.5,
    isActive: true,
    categoryId: DEMO_CAT_PANTRY,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 5,
  },
  // ── Personal Care ───────────────────────────────────────────────────────────
  {
    id: MENU_ID_HYGIENE,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Hygiene essentials pack',
    value: 12,
    priceEach: 12,
    isActive: true,
    categoryId: DEMO_CAT_PERSONAL_CARE,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 6,
  },
  {
    id: MENU_ID_BABY_KIT,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Infant care kit',
    value: 18,
    priceEach: 18,
    isActive: true,
    categoryId: DEMO_CAT_PERSONAL_CARE,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 7,
  },
  // ── Household Essentials ────────────────────────────────────────────────────
  {
    id: MENU_ID_LAUNDRY,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Laundry detergent (64 loads)',
    value: 14,
    priceEach: 14,
    isActive: true,
    categoryId: DEMO_CAT_HOUSEHOLD,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 8,
  },
  {
    id: MENU_ID_PAPER_GOODS,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'Paper goods bundle',
    value: 10,
    priceEach: 10,
    isActive: true,
    categoryId: DEMO_CAT_HOUSEHOLD,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 9,
  },
  {
    id: MENU_ID_CLEANING,
    vendorId: DEMO_VENDOR_PRIMARY,
    name: 'All-purpose cleaning kit',
    value: 11,
    priceEach: 11,
    isActive: true,
    categoryId: DEMO_CAT_HOUSEHOLD,
    quotaValue: 1,
    minimumOrder: 0,
    sortOrder: 10,
  },
];

export const DEMO_BOX_TYPES: BoxType[] = [
  {
    id: DEMO_BOX_STANDARD,
    name: 'Standard pantry box',
    isActive: true,
    vendorId: DEMO_VENDOR_PRIMARY,
    priceEach: 42,
  },
];

export const DEMO_SETTINGS: AppSettings = {
  weeklyCutoffDay: 'Friday',
  weeklyCutoffTime: '17:00',
  enablePasswordlessLogin: true,
  textOnDelivery: false,
};

let settingsMutable: AppSettings = { ...DEMO_SETTINGS };

export function getSettingsSnapshot(): AppSettings {
  return { ...settingsMutable };
}

export function replaceSettings(next: AppSettings) {
  settingsMutable = { ...next };
}

export const DEMO_PRODUCE_VENDORS: ProduceVendor[] = [
  {
    id: 'demo-produce-vendor-1',
    name: 'Regional Produce Collective',
    token: 'demo-token-placeholder',
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

function iso(d: Date) {
  return d.toISOString();
}

function frac(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function columbusCoords(i: number) {
  return {
    latitude: 39.932 + frac(i) * 0.055,
    longitude: -83.045 + frac(i * 7.13) * 0.075,
  };
}

const MEAL_PLAN_DATES = [
  '2026-04-21',
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
  '2026-05-07',
];

function mkClient(row: Omit<Partial<ClientProfile>, 'id' | 'fullName'> & Pick<ClientProfile, 'id' | 'fullName'>): ClientProfile {
  const now = iso(new Date());
  const { firstName: fn, lastName: ln } = row.firstName
    ? { firstName: row.firstName, lastName: row.lastName ?? '' }
    : primaryNameForProfile(row.fullName);
  return {
    email: null,
    secondaryPhoneNumber: null,
    approvedMealsPerWeek: 14,
    parentClientId: null,
    dob: null,
    cin: null,
    authorizedAmount: 1200,
    voucherAmount: null,
    expirationDate: '2026-12-31',
    firstName: fn,
    lastName: ln,
    apt: null,
    city: 'Columbus',
    state: 'OH',
    zip: '43215',
    county: 'Franklin',
    clientIdExternal: null,
    caseIdExternal: null,
    medicaid: false,
    paused: false,
    complex: false,
    bill: true,
    delivery: true,
    doNotText: false,
    doNotTextReason: null,
    doNotTextNumbers: null,
    dislikes: null,
    mealPlannerData: null,
    uniteAccount: 'Standard',
    history: null,
    signToken: null,
    assignedDriverId: null,
    produceVendorId: null,
    notes: '',
    screeningTookPlace: true,
    screeningSigned: true,
    endDate: '2030-01-01',
    ...row,
    navigatorId: row.navigatorId ?? DEMO_NAV_A,
    statusId: row.statusId ?? DEMO_STATUS_ACTIVE,
    phoneNumber: row.phoneNumber ?? '(614) 555-1000',
    address: row.address ?? '1 Capitol Square',
    serviceType: row.serviceType ?? 'Food',
    screeningStatus: row.screeningStatus ?? 'approved',
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? now,
  };
}

/** 50 synthetic Columbus-area clients — routes, meal-plan reporting, and vendor downloads */
export function seedClients(): ClientProfile[] {
  const rows: ClientProfile[] = [];

  for (let i = 1; i <= 50; i++) {
    const id = `demo-cli-${String(i).padStart(3, '0')}`;
    const persona = DEMO_PERSONA_ROWS[i - 1];
    if (!persona) throw new Error(`demo: missing persona row for client index ${i}`);
    const fullName = stripDemoPrefix(persona.fullName);
    const streetNum = 100 + ((i * 17) % 900);
    const streetCore = persona.street.replace(/^\d+\s+/, '');
    const address = `${streetNum} ${streetCore}`;
    const { latitude, longitude } = columbusCoords(i);
    const navigatorId = i % 2 === 0 ? DEMO_NAV_B : DEMO_NAV_A;
    const { firstName: pFirst, lastName: pLast } = primaryNameForProfile(fullName);
    const email = `demo+${id}@example.invalid`;

    // All 50 clients are Food — geocoded for the routes map
    let serviceType: ClientProfile['serviceType'];
    let mealPlannerData: ClientProfile['mealPlannerData'];
    let activeOrder: ClientProfile['activeOrder'];
    let statusId = DEMO_STATUS_ACTIVE;
    let paused = false;
    let screeningStatus = 'approved' as ClientProfile['screeningStatus'];

    // All clients are Food — rotate through varied item combos so the portal
    // looks distinct per client and includes non-food essentials.
    serviceType = 'Food';

    // Three delivery-item "profiles" cycling across clients (active items only;
    // buildFullItemList appends the rest as recurring-* alternates at qty 0).
    const itemProfiles: ItemEntry[][] = [
      [
        { id: MENU_ID_SOUP,       name: 'Hot entrée · rotating',       quantity: 2 + (i % 3), value: 8.5 },
        { id: MENU_ID_SALAD,      name: 'Garden salad',                 quantity: 1 + (i % 2), value: 6   },
        { id: MENU_ID_HYGIENE,    name: 'Hygiene essentials pack',      quantity: 1,            value: 12  },
      ],
      [
        { id: MENU_ID_GRAIN_BOWL, name: 'Grain & veggie bowl',         quantity: 2 + (i % 2), value: 9   },
        { id: MENU_ID_FRUIT_PACK, name: 'Seasonal fruit pack',          quantity: 1 + (i % 3), value: 5.5 },
        { id: MENU_ID_LAUNDRY,    name: 'Laundry detergent (64 loads)', quantity: 1,            value: 14  },
        { id: MENU_ID_PAPER_GOODS,name: 'Paper goods bundle',           quantity: 1,            value: 10  },
      ],
      [
        { id: MENU_ID_SOUP,       name: 'Hot entrée · rotating',       quantity: 1 + (i % 4), value: 8.5 },
        { id: MENU_ID_BFAST_KIT,  name: 'Breakfast kit',               quantity: 1 + (i % 2), value: 7   },
        { id: MENU_ID_CLEANING,   name: 'All-purpose cleaning kit',    quantity: 1,            value: 11  },
        ...(i % 5 === 0
          ? [{ id: MENU_ID_BABY_KIT, name: 'Infant care kit', quantity: 1, value: 18 }]
          : []),
      ],
    ];

    const profile = itemProfiles[i % 3]!;
    const d0 = MEAL_PLAN_DATES[(i + 2) % MEAL_PLAN_DATES.length];
    const d1 = MEAL_PLAN_DATES[(i + 7) % MEAL_PLAN_DATES.length];
    const d2 = MEAL_PLAN_DATES[(i + 4) % MEAL_PLAN_DATES.length];

    const d1Profile = profile.slice(0, 2).map((it) => ({ ...it, quantity: Math.max(1, it.quantity - 1) }));
    const d2Profile = [profile[0]!];
    mealPlannerData = [
      { scheduledDeliveryDate: d0, items: buildFullItemList(profile) },
      { scheduledDeliveryDate: d1, items: buildFullItemList(d1Profile) },
      ...(i % 4 !== 0
        ? [{ scheduledDeliveryDate: d2, items: buildFullItemList(d2Profile) }]
        : []),
    ];

    // Build activeOrder vendorSelections from the same profile
    const orderItems: Record<string, number> = {};
    for (const it of profile) orderItems[it.id] = (orderItems[it.id] ?? 0) + it.quantity;

    activeOrder = {
      serviceType: 'Food',
      vendorSelections: [{ vendorId: DEMO_VENDOR_PRIMARY, items: orderItems }],
      deliveryDistribution: { Monday: 5, Wednesday: 5, Friday: 4 },
    };

    if (i === 8)  { statusId = DEMO_STATUS_PAUSED; paused = true; }
    if (i === 12) screeningStatus = 'waiting_approval';

    rows.push(
      mkClient({
        id,
        fullName,
        firstName: pFirst,
        lastName: pLast,
        email,
        address,
        phoneNumber: persona.phoneDisplay,
        latitude,
        longitude,
        navigatorId,
        mealPlannerData,
        activeOrder,
        serviceType,
        statusId,
        paused,
        screeningStatus,
        uniteAccount: i % 7 === 0 ? 'Brooklyn' : 'Standard',
      }),
    );
  }

  return rows;
}

let memoryClients: ClientProfile[] = seedClients();

export function getStoreSnapshot(): ClientProfile[] {
  return memoryClients.map((c) => ({ ...c, activeOrder: c.activeOrder ? structuredClone(c.activeOrder) : undefined }));
}

export function replaceStore(next: ClientProfile[]) {
  memoryClients = next;
}

export function findClient(id: string): ClientProfile | undefined {
  return memoryClients.find((c) => c.id === id);
}

export function upsertClient(next: ClientProfile) {
  const i = memoryClients.findIndex((c) => c.id === next.id);
  if (i >= 0) memoryClients[i] = next;
  else memoryClients.push(next);
}

export function resetDemoStore() {
  memoryClients = seedClients();
  replaceSettings({ ...DEMO_SETTINGS });
}
