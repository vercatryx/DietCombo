# Portable Orders & Billing Module

This folder contains **orders** and **billing** pages and all backend logic needed to run them in another Next.js app. It assumes the **same database structure** (Supabase): `orders`, `order_items`, `order_vendor_selections`, `order_box_selections`, `billing_records`, `clients`, `vendors`, `menu_items`, `box_types`, `equipment`, `item_categories`, `meal_items` (or `breakfast_items` for meal items).

**Integrated into this app:** The live implementation lives in the main app: `lib/actions-orders-billing.ts`, `lib/types-orders-billing.ts`, `lib/utils-week.ts`, `app/orders/`, `app/billing/`, `app/clients/[id]/billing/`, `app/api/update-order-billing-status/`, and `components/orders/`, `components/billing/`, `components/clients/BillingDetail`. DB compatibility: uses `@/lib/supabase`; meal items from `breakfast_items`; order proof from `proof_of_delivery_url` (or legacy fields); `last_updated` for order lastUpdated.

---

## What’s included

| Area | Contents |
|------|----------|
| **App routes** | `app/orders/`, `app/billing/`, `app/clients/[id]/billing/` |
| **API** | `app/api/update-order-billing-status/route.ts` (POST) |
| **Components** | `OrdersList`, `OrderDetailView`, `BillingList`, `BillingDetail` + CSS modules |
| **Lib** | `actions-orders-billing.ts`, `utils-week.ts`, `types-orders-billing.ts` |

---

## How to move into another app

1. **Copy the folder**  
   Copy the entire `portable-orders-billing` tree into your app (e.g. under the project root).

2. **Merge into your app structure**  
   - Merge `app/` into your `app/` (orders, billing, clients/[id]/billing, api).
   - Merge `components/` into your `components/`.
   - Merge `lib/` into your `lib/` (or keep a subfolder and fix imports).

3. **Fix imports**  
   - Replace `@/lib/...` and `@/components/...` with your app’s alias (e.g. `@/lib` → `@/lib`).
   - In **lib/actions-orders-billing.ts** set the Supabase client:
     - Use your existing `supabase` and `createClient` from e.g. `@/lib/supabase`.
     - Or keep the inline `createClient` and ensure `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

4. **Session/layout**  
   - `app/orders/layout.tsx` uses `verifySession()` and redirects by role.  
   - Implement `verifySession` in your app (e.g. in `lib/session.ts`) so it returns something like `{ role?: string; userId?: string }`.  
   - Adjust redirects if your auth uses different property names.

5. **Optional: reference data**  
   - Actions use `getMenuItems`, `getVendors`, `getBoxTypes`, `getEquipment`, `getCategories`, `getMealItems`.  
   - Either export these from your existing `lib/actions` (or equivalent) and import them in `actions-orders-billing.ts`, or use the **inline fallbacks** in that file (see comments there).

---

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL` – Supabase project URL  
- `SUPABASE_SERVICE_ROLE_KEY` – Service role key (for server-side access; optional but recommended for orders/billing so RLS doesn’t hide rows)

---

## Database assumptions (same as source app)

- **orders**: `id`, `client_id`, `service_type`, `status`, `order_number`, `scheduled_delivery_date`, `actual_delivery_date`, `total_value`, `total_items`, `notes`, `proof_of_delivery_image` (or `delivery_proof_url`), `creation_id`, `billing_notes`, etc.
- **order_vendor_selections** / **order_box_selections** / **order_items**: linked by `order_id`, `vendor_selection_id`, etc.
- **billing_records**: `id`, `client_id`, `order_id`, `amount`, `status`, `remarks`, etc.
- **clients**: at least `id`, `full_name`, `address`, `email`, `phone_number` for display.
- **vendors**, **menu_items**, **box_types**, **equipment**, **item_categories**, **meal_items**: used for order detail and billing history labels.

---

## Routes after integration

- **Orders list**: `/orders`  
- **Order detail**: `/orders/[id]`  
- **Billing list (by week)**: `/billing`  
- **Client billing history**: `/clients/[id]/billing`

The **update billing status** endpoint is `POST /api/update-order-billing-status` (body: `{ orderIds: string[], status: 'billing_pending' | 'billing_successful' | 'billing_failed', billingNotes?: string }`).
