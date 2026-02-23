# Implementation Plan: Adopt UPCOMING_ORDER_SCHEMA in the App

This plan adapts the app to the **exact schema** described in `UPCOMING_ORDER_SCHEMA.md` for the client’s “upcoming order” payload. In the codebase this is stored in **`clients.active_order`** (the schema doc calls the logical concept `clients.upcoming_order`; we keep the existing column name unless you add a DB migration to rename it).

---

## 1. Current State vs Schema

| Aspect | Current app | Schema (UPCOMING_ORDER_SCHEMA.md) |
|--------|--------------|-----------------------------------|
| **Storage** | `clients.active_order` (JSONB) + sync to `upcoming_orders` table | Client JSON column only (full replace); schema doc says “not the upcoming_orders table” for *this* payload shape. We keep syncing to the table for order processing. |
| **Save behavior** | Whole `activeOrder` object saved as-is | **Full replace**; only allowed fields per `serviceType` are stored; all other fields stripped. |
| **Boxes** | `boxOrders` + legacy `vendorId`, `boxTypeId`, `items`, etc. | Only `serviceType`, `caseId`, `boxOrders`, `notes`. Each box: `boxTypeId`, `vendorId`, `quantity`, `items`, `itemNotes`. |
| **Custom** | `customItems[]`, `vendorId` in various places | Only `serviceType`, `caseId`, `custom_name`, `custom_price`, `vendorId`, `deliveryDay`, `notes`. Single “custom” item per payload. |
| **Food / Meal** | `vendorSelections`, `deliveryDayOrders`, `mealSelections` (partial), no `itemNotes` in types | Only `serviceType`, `caseId`, `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `notes`. Vendor/meal selections include optional `itemNotes`. |

---

## 2. Goals

1. **Strict payload shapes**  
   When writing to `clients.active_order`, persist only the fields allowed for the current `serviceType` (Boxes, Custom, or Food/Meal).

2. **Single source of truth**  
   The client row’s JSON column is the canonical “upcoming order” for that client. The `upcoming_orders` table remains for processing and backward compatibility; sync will be driven from this sanitized payload.

3. **Backward compatibility**  
   - **Read path**: Continue to support existing data (e.g. legacy `boxes`/`vendorId`/`items`, `customItems`). Normalize on load into the schema shapes where possible and into UI shape for existing code.  
   - **Write path**: Before save, normalize UI state into schema shape, then sanitize (strip disallowed fields) and write.

4. **Column rename (done)**  
   The DB column has been renamed `active_order` → `upcoming_order` to match the schema doc. Prisma maps it as `activeOrder` → `@map("upcoming_order")`. All Supabase and script references use the `upcoming_order` column name.

---

## 3. Implementation Phases

### Phase 1: Types and sanitizers (no DB change)

**3.1 Add schema-aligned TypeScript types** (`lib/types.ts` or new `lib/upcoming-order-types.ts`)

- **Boxes**
  - `UpcomingOrderBoxes`: `{ serviceType: 'Boxes', caseId?: string, boxOrders: BoxOrderEntry[], notes?: string }`
  - `BoxOrderEntry`: `{ boxTypeId?: string, vendorId?: string, quantity?: number, items?: Record<string, number>, itemNotes?: Record<string, string> }`
- **Custom**
  - `UpcomingOrderCustom`: `{ serviceType: 'Custom', caseId?: string, custom_name?: string, custom_price?: string | number, vendorId?: string, deliveryDay?: string, notes?: string }`
- **Food / Meal**
  - `UpcomingOrderFoodMeal`: `{ serviceType: 'Food' | 'Meal', caseId?: string, vendorSelections?: VendorSelection[], deliveryDayOrders?: Record<string, { vendorSelections: VendorSelection[] }>, mealSelections?: Record<string, MealSelection>, notes?: string }`
  - `VendorSelection`: `{ vendorId: string, items: Record<string, number>, itemNotes?: Record<string, string> }`
  - `MealSelection`: `{ vendorId?: string, items: Record<string, number>, itemNotes?: Record<string, string> }`

Add a discriminated union and a type guard:

- `UpcomingOrderPayload = UpcomingOrderBoxes | UpcomingOrderCustom | UpcomingOrderFoodMeal`
- `isUpcomingOrderBoxes(p)`, `isUpcomingOrderCustom(p)`, `isUpcomingOrderFoodMeal(p)` (or one `getUpcomingOrderKind(p)`).

**3.2 Sanitizer: “to stored payload”**

Implement a function that takes the current UI/API order config (e.g. `OrderConfiguration` or a superset) and returns a payload that conforms to the schema for that `serviceType`:

- **Boxes**: Output only `serviceType`, `caseId`, `boxOrders` (each element only `boxTypeId`, `vendorId`, `quantity`, `items`, `itemNotes`), `notes`. Strip `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `custom_name`, `custom_price`, `vendorId` (top-level), `deliveryDay`, `customItems`, legacy `boxes`/`items`/`boxTypeId`/`boxQuantity` after mapping to `boxOrders`.
- **Custom**: Output only `serviceType`, `caseId`, `custom_name`, `custom_price`, `vendorId`, `deliveryDay`, `notes`. Strip food/meal/box fields. Map from existing UI: e.g. first/primary `customItems` entry or existing `custom_name`/`custom_price`/`vendorId`/`deliveryDay` if already present.
- **Food / Meal**: Output only `serviceType`, `caseId`, `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `notes`. Strip box and custom fields. Ensure `vendorSelections` and `deliveryDayOrders`/`mealSelections` entries use the `VendorSelection`/`MealSelection` shape (including optional `itemNotes`).

Signature idea: `toStoredUpcomingOrder(config: OrderConfiguration | any, serviceType: ServiceType): UpcomingOrderPayload`.

**3.3 Hydration: “from stored payload” to UI**

Implement a function that takes a stored payload (or legacy `active_order`) and returns the shape the UI expects (e.g. `OrderConfiguration`-like):

- **Boxes**: Map `boxOrders` to UI; if payload is legacy (e.g. single `vendorId`/`boxTypeId`/`items`), build a single-element `boxOrders` array (already partially done in `ClientProfile`).
- **Custom**: Map `custom_name`/`custom_price`/`vendorId`/`deliveryDay` into `customItems` (e.g. one item) and any other fields the UI uses.
- **Food / Meal**: Pass through `vendorSelections`, `deliveryDayOrders`, `mealSelections`; ensure `itemNotes` is present where the UI expects it.

Signature idea: `fromStoredUpcomingOrder(stored: unknown, serviceType: ServiceType): OrderConfiguration` (or a superset).

Use these in the single place(s) that read `client.activeOrder` for the profile/order UI so the rest of the app keeps working with the existing UI shape.

---

### Phase 2: Use sanitizer on every write to `active_order`

**2.1 Single write path**

Ensure all writes to `clients.active_order` go through one path (e.g. `updateClient(..., activeOrder)` and the internal update inside `syncCurrentOrderToUpcoming` when it writes to `clients`).

**2.2 Apply sanitizer before DB write**

- When building the payload for `updateClient` or for the “draft persistence” step in `syncCurrentOrderToUpcoming`, call `toStoredUpcomingOrder(currentOrderConfig, client.serviceType)` and pass the result as `active_order` (or `upcoming_order` if renamed).
- Do **not** merge with existing JSON; replace the column value entirely with this sanitized object (already “full replace” today; we just restrict keys).

**2.3 Produce and Equipment**

- **Produce**: Schema says equipment/other flows are separate. Keep not syncing Produce to `upcoming_orders`; for `active_order`, either define a minimal Produce shape (e.g. `serviceType`, `caseId`, `billAmount`, `notes` only) or keep current behavior and add a small Produce branch in the sanitizer that strips non-Produce fields. Prefer aligning with schema if you add a “Produce” branch there later.
- **Equipment**: Not stored in upcoming order per schema; exclude from sanitizer or treat as “no upcoming order” for this column.

---

### Phase 3: Use hydration on every read of `active_order`

**3.1 Centralize reads**

Identify every place that reads `client.activeOrder` (or `data.client.activeOrder`) to populate the order UI (e.g. ClientProfile initial load, loadData, hydrateFromInitialData). Ensure they all use the same “hydration” step.

**3.2 Apply hydration**

- After fetching the client (or the payload from DB), call `fromStoredUpcomingOrder(client.activeOrder, client.serviceType)` and use the return value as the order config for the UI.
- This keeps existing UI components unchanged while stored data moves to schema-only fields.

---

### Phase 4: Sync to `upcoming_orders` table from sanitized payload

**4.1 Keep sync, feed it sanitized data**

- Continue syncing from the client’s order config to the `upcoming_orders` table (and related tables) for processing.
- After applying the sanitizer, the “current order config” used for sync should be the **sanitized** payload (or the UI shape derived from it). So: either pass the sanitized payload through the same logic that today builds `upcoming_orders` rows, or keep building from the UI shape that was filled by hydration (so sync still sees a consistent structure).

**4.2 Avoid double-write of raw then sanitized**

Today `syncCurrentOrderToUpcoming` sometimes updates `clients.active_order` with the raw `client.activeOrder`. Change that to:

- Build sanitized = `toStoredUpcomingOrder(client.activeOrder, client.serviceType)`.
- Write `active_order = sanitized`.
- Run the rest of sync using either the sanitized payload or the hydrated UI shape, so the table and the client column stay aligned.

---

### Phase 5: Custom order mapping (UI ↔ schema)

**5.1 UI → stored (save)**

- **customItems** (array) → pick a “primary” item (e.g. first, or the one with quantity > 0). Set `custom_name` from that item’s name (or a concatenation); `custom_price` from that item’s price (or a representative value). Keep `vendorId` and `deliveryDay` from existing fields. If there are multiple custom items, either concatenate name and sum/average price for a single `custom_name`/`custom_price`, or document that only one is stored per schema.

**5.2 Stored → UI (load)**

- Map `custom_name`/`custom_price`/`vendorId`/`deliveryDay` into `customItems` (e.g. one entry) and any other fields the Custom UI expects so lists and totals still work.

---

### Phase 6: Boxes – align with schema only

- **Stored**: Only `boxOrders` (no top-level `vendorId`/`boxTypeId`/`items`/`boxQuantity`). Sanitizer: build `boxOrders` from UI (already have `orderConfig.boxOrders`); drop legacy fields from output.
- **Read**: Hydration already promotes `boxOrders` and migrates legacy to `boxOrders`; ensure hydration only exposes schema fields when building the stored payload and that UI still receives `boxOrders` + any legacy compat it needs.

---

### Phase 7: Food/Meal – add `itemNotes` where missing

- In types: add `itemNotes?: Record<string, string>` to the relevant selection types (e.g. in `OrderConfiguration` for `vendorSelections` and `deliveryDayOrders`).
- In sanitizer: when building `VendorSelection`/`MealSelection`, include `itemNotes` if present.
- In hydration: ensure `itemNotes` is passed through. UI already uses `itemNotes` in some places; ensure all paths that read from stored payload surface it.

---

### Phase 8: Optional – rename column to `upcoming_order`

- Add migration: `ALTER TABLE clients RENAME COLUMN active_order TO upcoming_order;`
- Update Prisma: `active_order` → `upcoming_order` (and `activeOrder` → `upcomingOrder` in the model).
- Grep and replace all reads/writes of `active_order`/`activeOrder` for this column to use the new name. Keep the same strict shapes; only the column name changes.

---

## 4. File-level checklist

| Area | Action |
|------|--------|
| **lib/types.ts** (or **lib/upcoming-order-types.ts**) | Add `UpcomingOrderBoxes`, `UpcomingOrderCustom`, `UpcomingOrderFoodMeal`, `VendorSelection`, `MealSelection`, `BoxOrderEntry`, `UpcomingOrderPayload`, type guards. |
| **lib/upcoming-order-schema.ts** (new) | Implement `toStoredUpcomingOrder()`, `fromStoredUpcomingOrder()`. Optionally `validateUpcomingOrderPayload()`. |
| **lib/actions.ts** | In `updateClient`, before setting `payload.active_order`, set it to `toStoredUpcomingOrder(data.activeOrder, data.serviceType || client.serviceType)`. In `syncCurrentOrderToUpcoming`, build sanitized payload and write that to `clients.active_order`; use same payload (or hydrated) for building `upcoming_orders` rows. |
| **components/clients/ClientProfile.tsx** | Where initial/load data sets `orderConfig` from `data.client.activeOrder` or from `upcoming_orders`, run `fromStoredUpcomingOrder(client.activeOrder, client.serviceType)` and set order config from that. |
| **components/clients/ClientList.tsx** | Any place that reads `client.activeOrder` for display can keep using it if hydration is applied at the data source (e.g. in getClient); or pass through a pre-hydrated config. Prefer hydrating at fetch so list view gets same shape. |
| **Other callers of getClient / activeOrder** | Ensure they either receive already-hydrated order config or call `fromStoredUpcomingOrder` once when preparing UI state. |

---

## 5. Testing and rollout

1. **Unit tests** for `toStoredUpcomingOrder` and `fromStoredUpcomingOrder` for all three service types and for legacy payloads (e.g. Boxes with only `vendorId`/`items`, Custom with only `customItems`).
2. **Integration**: Create/edit clients for Boxes, Custom, and Food/Meal; verify `clients.active_order` contains only schema-allowed keys and that UI still shows and edits correctly.
3. **Sync**: Verify that after save, `upcoming_orders` (and related tables) still get the expected rows and items, and that process-weekly-orders (or equivalent) still works.
4. **Backward compatibility**: Load old clients with legacy `active_order`; confirm they hydrate and display, and that a save then writes a schema-only payload.

---

## 6. Summary

- **Schema source**: `UPCOMING_ORDER_SCHEMA.md` (payload in client JSON column; full replace; only allowed fields per `serviceType`).
- **App storage**: Keep using `clients.active_order` (or rename to `upcoming_order` in Phase 8).
- **New code**: Types + `toStoredUpcomingOrder` + `fromStoredUpcomingOrder`; use them on every write and read of that column.
- **Existing behavior**: Sync to `upcoming_orders` table unchanged in flow, but fed from sanitized (or hydrated) payload so client column and table stay aligned.
- **Custom/Boxes/Food**: Custom mapping for single `custom_name`/`custom_price`; Boxes only `boxOrders`; Food/Meal with `itemNotes` and optional `mealSelections`.

This gives you schema-aligned storage and a clear path to adopt the suggested improvements in the app without breaking existing flows.
