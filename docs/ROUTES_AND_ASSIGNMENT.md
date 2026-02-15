# How Routes and Driver Assignment Work

## Two separate concepts

1. **Who delivers to whom (assignment)** – stored on **clients** and **stops**.
2. **In what order stops are done (route order)** – stored on **drivers** (and optionally **routes**).

---

## 1. Assignment (clients + stops)

- **Source of truth:** `clients.assigned_driver_id` (and `stops.assigned_driver_id`).
- **Where it’s set:** Routes page → **Client Assignment** tab. Assigning a client to a driver updates the client and propagates to existing stops.
- **APIs:**  
  - `POST /api/route/assign-client-driver` – sets `clients.assigned_driver_id` and updates existing stops for that client.

When new **stops** are created (see below), they get `assigned_driver_id` from the client, so assignment flows: **client → stop**.

---

## 2. Stops (delivery records)

- One **stop** per order per delivery date (for the driver to handle).
- Stops are **created** by:
  - **Cleanup** (`POST /api/route/cleanup`) – uses **orders** + **clients** (with `assigned_driver_id`) and creates missing stops for those delivery dates. This is what turns “orders + client assignment” into actual stop rows.
  - **Routes GET** (`GET /api/route/routes?delivery_date=...`) – when loading the routes page with a date, it can also create missing stops for that date.

So if cleanup (or routes creation) never runs for a date, there are no stops for that date and the Drivers app will show no routes for it.

---

## 3. Route order (sequence of stops)

- **Where it’s stored:** **`driver_route_order`** (driver_id, client_id, position). Source of truth; clients with no stop on a date are skipped when building that day's route. Deprecated for order: `drivers.stop_ids` / `routes.stop_ids`.
- **Where it’s set:**
  - **Assign client to driver** – adds client to that driver in `driver_route_order`.
  - **Reassign** – moves client in `driver_route_order` (delete from old, add to new).
  - **Cleanup** – syncs missing rows (INSERT ON CONFLICT DO NOTHING).

So: **assignment** = who gets which clients/stops. **Route order** = ordered list of clients per driver in `driver_route_order`.

---

## 4. Drivers app and mobile/routes

- **Drivers list** comes from the **drivers** table (and **routes** table). If there are no driver rows (e.g. you never ran “Generate New Route”), the Drivers page has no rows to show.
- **Stops** are found by **driver_route_order** + stops for the selected delivery_date; else fallback: `drivers.stop_ids` / `stops.assigned_driver_id`.
- Only drivers with at least one stop for the selected date are shown (“active” routes).

So you need:

1. **Driver rows** – create them on the Routes page with **Generate New Route**.
2. **Client assignment** – assign clients to drivers on the **Client Assignment** tab.
3. **Stops for the date** – run **Cleanup** (or load the routes page with that date so it can create stops). The Drivers page runs cleanup in the background after first load so stops are created and then it refetches; if the list is still blank, run **Refresh** or ensure cleanup runs for that date.

---

## Quick reference

| What                | Stored in                         | Set by                                      |
|---------------------|-----------------------------------|---------------------------------------------|
| Assignment          | `clients.assigned_driver_id`, `stops.assigned_driver_id` | Client Assignment tab, assign-client-driver API |
| Route order         | **`driver_route_order`** (driver_id, client_id, position) | Assign, Reassign, Cleanup (sync) |
| Existence of stops  | `stops` table                     | Cleanup API, Routes GET (when loading with date) |

**Note:** Route logic uses **delivery_date** (calendar date) for filtering and ordering. When only `day` (e.g. Monday) is used, it is for legacy filtering; prefer `delivery_date` for correct ordering.
