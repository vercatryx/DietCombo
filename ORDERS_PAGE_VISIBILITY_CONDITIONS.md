# Orders Page Visibility Conditions Analysis

## Overview
This document explains the conditions required for orders to appear in the orders table on the `/orders` page.

## Location of Logic
The filtering logic is implemented in the `getOrdersPaginated` function located in `lib/actions.ts` (lines 4905-5013). This function is called by the `OrdersList` component (`components/orders/OrdersList.tsx`).

## Required Conditions

For an order to appear in the `/orders` page table, it must satisfy **ALL** of the following conditions:

### 1. Must Exist in the `orders` Table
- The order must be in the `orders` table (not just in `upcoming_orders`)
- Orders in `upcoming_orders` are not displayed on this page
- Orders are typically moved from `upcoming_orders` to `orders` when they are processed (e.g., via the weekly order processing workflow)

### 2. Status Must NOT Be `'billing_pending'`
```typescript
.neq('status', 'billing_pending')
```
- Orders with status `'billing_pending'` are excluded
- These orders are intended to be shown only on the billing page
- All other statuses are allowed: `'pending'`, `'confirmed'`, `'completed'`, `'waiting_for_proof'`, `'cancelled'`, `'scheduled'`, etc.

### 3. Must Have a Scheduled Delivery Date
```typescript
.not('scheduled_delivery_date', 'is', null)
```
- The `scheduled_delivery_date` field must NOT be null
- This ensures only orders with a scheduled delivery date are shown
- Orders without a scheduled delivery date are excluded

## Code Reference

```typescript:4905:4918:lib/actions.ts
export async function getOrdersPaginated(page: number, pageSize: number, filter?: 'needs-vendor') {
    // For the Orders tab, show orders from the orders table
    // Exclude billing_pending orders (those should only show on billing page)
    // Only show scheduled orders (orders with scheduled_delivery_date)
    let query = supabase
        .from('orders')
        .select(`
            *,
            clients (
                full_name
            )
        `, { count: 'exact' })
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null);
```

## Summary Table

| Condition | Requirement | Reason |
|-----------|-------------|--------|
| **Table** | Must be in `orders` table | Only processed orders are shown |
| **Status** | Must NOT be `'billing_pending'` | Billing pending orders belong on billing page |
| **Scheduled Date** | `scheduled_delivery_date` must NOT be null | Only scheduled orders are relevant for the orders page |

## Additional Notes

### Optional Filter: `needs-vendor`
If the `filter` parameter is set to `'needs-vendor'`, additional filtering is applied:
- Only Boxes orders are considered
- Only orders with box selections that have `vendor_id` set to `null` are shown
- This is used for identifying orders that need vendor assignment

### Order Processing Flow
1. Orders typically start in `upcoming_orders` table
2. When processed (e.g., via `/api/process-weekly-orders`), they are:
   - Copied to the `orders` table
   - Assigned a `scheduled_delivery_date`
   - Given a status (usually `'pending'` initially)
3. Once in the `orders` table with a scheduled date and non-billing-pending status, they will appear on `/orders` page

## Example Scenarios

### ✅ Will Appear
- Order in `orders` table with `status = 'pending'` and `scheduled_delivery_date = '2024-01-15'`
- Order in `orders` table with `status = 'confirmed'` and `scheduled_delivery_date = '2024-01-20'`
- Order in `orders` table with `status = 'scheduled'` and `scheduled_delivery_date = '2024-01-25'`

### ❌ Will NOT Appear
- Order in `upcoming_orders` table (wrong table)
- Order in `orders` table with `status = 'billing_pending'` (excluded status)
- Order in `orders` table with `scheduled_delivery_date = null` (missing scheduled date)
- Order in `orders` table with `status = 'pending'` and `scheduled_delivery_date = null` (missing scheduled date)
