# Schema: `clients.upcoming_order` (Client DB Column)

This document describes the **exact schema** for how all order types are saved in the **Upcoming Order** feature. We are talking about the **`upcoming_order` column on the `clients` table** (a JSONB column on the client row in the database), **not** the separate `upcoming_orders` table.

- **Database**: `clients` table  
- **Column**: `upcoming_order` (JSONB)  
- **Behavior on save**: The entire column value is **replaced** with the payload for the current service type. No merging with existing data; only fields valid for that service type are stored.

---

## Service types and allowed shapes

The value of `clients.upcoming_order` is always a single JSON object. Its shape depends **only** on `serviceType`. Only the fields listed for that type are persisted; all other fields are stripped before save.

---

### 1. Boxes

When the client’s upcoming order is **Boxes**, the column stores **only**:

| Field          | Type     | Description |
|----------------|----------|-------------|
| `serviceType`  | `string` | Always `"Boxes"`. |
| `caseId`       | `string` | Optional. Case ID for the order. |
| `boxOrders`    | `array`  | List of box configurations (see below). |
| `notes`        | `string` | Optional. General order notes. |

**No** food, meal, or custom fields are stored (e.g. no `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `custom_name`, `custom_price`, `vendorId`, `deliveryDay`).

#### Shape of each element in `boxOrders`

| Field       | Type     | Description |
|------------|----------|-------------|
| `boxTypeId`| `string` | Optional. ID of the box type. |
| `vendorId` | `string` | Optional. ID of the vendor for this box. |
| `quantity` | `number` | Optional. Number of this box (default 1). |
| `items`    | `object` | Optional. `{ [menuItemId: string]: number }` — item IDs to quantities. |
| `itemNotes`| `object` | Optional. `{ [menuItemId: string]: string }` — per-item notes. |

**Example (Boxes):**

```json
{
  "serviceType": "Boxes",
  "caseId": "CASE-123",
  "boxOrders": [
    {
      "boxTypeId": "bt-1",
      "vendorId": "v-1",
      "quantity": 1,
      "items": { "item-1": 2, "item-2": 1 },
      "itemNotes": { "item-1": "No nuts" }
    }
  ],
  "notes": "Leave at door"
}
```

---

### 2. Custom

When the client’s upcoming order is **Custom**, the column stores **only**:

| Field          | Type            | Description |
|----------------|-----------------|-------------|
| `serviceType` | `string`        | Always `"Custom"`. |
| `caseId`      | `string`        | Optional. Case ID. |
| `custom_name` | `string`        | Optional. Description of the custom item. |
| `custom_price`| `string` or `number` | Optional. Price per order. |
| `vendorId`    | `string`        | Optional. Vendor ID. |
| `deliveryDay` | `string`        | Optional. e.g. `"Monday"`. |
| `notes`       | `string`        | Optional. General notes. |

**No** food, meal, or box fields are stored.

**Example (Custom):**

```json
{
  "serviceType": "Custom",
  "caseId": "CASE-456",
  "custom_name": "Weekly Catering Platter",
  "custom_price": "45.00",
  "vendorId": "v-2",
  "deliveryDay": "Wednesday",
  "notes": "Gluten-free"
}
```

---

### 3. Food / Meal (Food and Meal together)

For **Food** or **Meal** clients, food and meal data **can be stored together** in the same `upcoming_order` object. The column stores **only**:

| Field                 | Type     | Description |
|-----------------------|----------|-------------|
| `serviceType`         | `string` | `"Food"` or `"Meal"`. |
| `caseId`              | `string` | Optional. Case ID. |
| `vendorSelections`    | `array`  | Optional. Flat list of vendor/item selections (see below). |
| `deliveryDayOrders`   | `object` | Optional. Per-delivery-day structure (see below). |
| `mealSelections`      | `object` | Optional. Per-meal-type structure (see below). |
| `notes`               | `string` | Optional. General notes. |

**No** box or custom fields are stored.

#### `vendorSelections` (array)

Each element:

| Field       | Type     | Description |
|------------|----------|-------------|
| `vendorId` | `string` | Vendor ID. |
| `items`    | `object` | `{ [menuItemId: string]: number }`. |
| `itemNotes`| `object` | Optional. `{ [menuItemId: string]: string }`. |

#### `deliveryDayOrders` (object)

Keys are delivery day names (e.g. `"Monday"`). Each value:

| Field              | Type   | Description |
|--------------------|--------|-------------|
| `vendorSelections` | `array`| Same shape as above, for that day. |

#### `mealSelections` (object)

Keys are meal types (e.g. `"Breakfast"`, `"Lunch"`, `"Dinner"`). Each value:

| Field       | Type     | Description |
|------------|----------|-------------|
| `vendorId` | `string` | Optional. Vendor for this meal. |
| `items`    | `object` | `{ [menuItemId: string]: number }`. |
| `itemNotes`| `object` | Optional. `{ [menuItemId: string]: string }`. |

**Example (Food with delivery days and meal selections):**

```json
{
  "serviceType": "Food",
  "caseId": "CASE-789",
  "deliveryDayOrders": {
    "Monday": {
      "vendorSelections": [
        {
          "vendorId": "v-1",
          "items": { "item-1": 2, "item-2": 1 },
          "itemNotes": {}
        }
      ]
    }
  },
  "mealSelections": {
    "Breakfast": {
      "vendorId": "v-1",
      "items": { "item-3": 1 },
      "itemNotes": {}
    }
  },
  "notes": "Delivery instructions here"
}
```

---

## Summary

| Service type | Stored in `clients.upcoming_order` |
|--------------|------------------------------------|
| **Boxes**    | `serviceType`, `caseId`, `boxOrders`, `notes` only. No food/meal/custom. |
| **Custom**  | `serviceType`, `caseId`, `custom_name`, `custom_price`, `vendorId`, `deliveryDay`, `notes` only. No food/meal/box. |
| **Food / Meal** | `serviceType`, `caseId`, `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `notes` only. Food and meal can coexist. No box/custom. |

- **Where**: `clients.upcoming_order` column (client row in DB).  
- **Not**: The `upcoming_orders` table.  
- **On save**: Full replace; only the allowed fields for the current `serviceType` are written.

Equipment orders are **not** stored in `clients.upcoming_order`; they use a separate flow.
