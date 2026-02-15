# Proposal: Stable Routes — One Table Per Driver’s Order (Skip If No Stop That Day)

**Status:** Proposal only — not implemented.

**Idea:**
- One table holds **each driver’s ordered list of clients** (the “route”).
- When we **add a client to a driver** (assignment), we add them to that driver’s list (and cleanup can add missing ones).
- **Day to day:** we use the same list. For a given date we only include clients who **have a stop that day** — if they don’t have a stop, we **simply skip them**. So the route order is stable; the actual run for the day is “walk the list, skip anyone with no delivery today.”

---

## 1. Principles

| Concept | Where it lives | Behavior |
|--------|----------------|----------|
| **Assignment** (who delivers to whom) | `clients.assigned_driver_id` | Universal truth; unchanged. |
| **Route order** (visit order) | New table: **one ordered list of clients per driver** | Add client to list when assigned to driver (and in cleanup if missing). Same list every day. |
| **Stops** (delivery records) | `stops` table, one per order per delivery date | Created by cleanup. For a given date, **only clients with a stop that day** appear in that day’s run; others in the driver’s list are **skipped**. |

So: clients table = truth for assignment; “a list per driver” = truth for order; no stop on a day = skipped that day.

---

## 2. New table: each driver’s order of clients

One table represents “for each driver, the order of clients.” Conceptually it’s “a list per driver” — implemented as rows, not a separate DB per driver.

### 2.1 `driver_route_order` (new)

Stores each driver’s ordered list of clients. One row = one (driver, client) in a given position.

| Column | Type | Purpose |
|--------|------|--------|
| `driver_id` | UUID | FK → drivers.id. Which driver this row belongs to. |
| `client_id` | UUID | FK → clients.id. Client in this driver’s route. |
| `position` | INTEGER NOT NULL | Order along the route: 1, 2, 3, … Same list every day. |

- **Unique:** `(driver_id, client_id)` — a client appears at most once per driver.
- **Order:** For a given driver, rows ordered by `position` give the route. Gaps in position are fine (e.g. 1, 2, 5 after deletes); we sort by position when reading.
- **Indexes:** `(driver_id, position)` for “get this driver’s route in order”; `(client_id, driver_id)` for “is this client on this driver’s list.”

So: “a db for each driver that has the order of the stops” = one table, many rows per driver, where each row is a client in sequence.

---

## 3. When we add a client to a driver

- **Assignment** (e.g. Client Assignment tab or assign-client-driver API): set `clients.assigned_driver_id = driver_id`.  
- **Also:** ensure this client is in that driver’s list. If they are not in `driver_route_order` for this driver, **INSERT** one row: `(driver_id, client_id, position = next)`. “Next” = e.g. `MAX(position) + 1` for that driver, or current count + 1.
- **Cleanup:** when syncing a date, for every client with `assigned_driver_id = D` who is not yet in `driver_route_order` for driver D, add them (e.g. at end). So the list stays in sync with assignments.

---

## 4. Cleanup (conceptual)

For a given **delivery_date**:

1. **Create missing stops** (as today): from orders + `clients.assigned_driver_id` for that date (one stop per order per date, `assigned_driver_id` from client). No change.
2. **Keep driver list in sync:** For each client with an assigned_driver_id who doesn’t yet have a row in `driver_route_order` for that driver, INSERT with position = next (e.g. append).
3. **Set stop sequence for the day:** For each driver, read `driver_route_order` for that driver ordered by `position`. Walk the list in order. For each client_id:
   - If there is **at least one stop** for (client_id, delivery_date, this driver) → assign `stops.sequence` (or `order`) for that/those stops using the running sequence number for that day (1, 2, 3, …).
   - If there is **no stop** for that client on that date → **do nothing; skip them.** They stay in the driver’s list for other days.

So: same list every day; only clients with a stop today get a sequence and appear in that day’s run.

---

## 5. Building “today’s route” for display / mobile

- For driver D and date `delivery_date`:
  1. Read `driver_route_order` for D ordered by `position`.
  2. For each `client_id` in that order, check if there is a stop (in `stops`) for that client and `delivery_date` with `assigned_driver_id = D`.
  3. If yes → include that stop in today’s route, in this order (sequence 1, 2, 3, …).
  4. If no → skip (client has no delivery today).

No need to store “today’s list” separately; it’s “driver’s list filtered by has a stop today.”

---

## 6. Other tables (unchanged or small tweaks)

- **`clients`** — Keep `assigned_driver_id` as universal truth. No change.
- **`drivers`** — No new columns required. Optionally keep `stop_ids` as a cache for backward compatibility (e.g. filled from “today’s ordered stops” when needed).
- **`stops`** — Keep existing columns. Ensure there is a **sequence** or **order** column (integer) for “position in this driver’s route on this delivery_date”; cleanup sets it only for clients that have a stop that day (skipped clients don’t get a stop row at all).

---

## 7. Summary

| What | Where | Notes |
|------|--------|--------|
| Assignment | `clients.assigned_driver_id` | Universal truth. |
| Route order (per driver) | **`driver_route_order`** (driver_id, client_id, position) | One ordered list per driver; add on assign + in cleanup. |
| Who runs today | Same list, **skip if no stop** | For a date, only clients with a stop that day get sequence and appear. |
| Cleanup | Create stops; sync driver list; set sequence in list order, skipping no-stop clients | |

So we have “a [table that gives each driver the order of their clients]. Each time we add a client to a driver we add them here (and in cleanup). If they don’t have a stop on one day they are simply skipped.”

---

## 8. Optional: reassign / remove from list

- **Reassign client to another driver:** Update `clients.assigned_driver_id` to new driver. Add client to new driver’s list in `driver_route_order` (e.g. at end). Optionally remove or leave the row for the old driver (policy: remove so old driver’s list doesn’t keep them).
- **Unassign client:** Set `clients.assigned_driver_id = NULL`. Optionally remove their row from `driver_route_order` for that driver so the list stays accurate.

---

## 9. Migration sketch (for later)

- Create table `driver_route_order` (driver_id, client_id, position) with unique (driver_id, client_id), FKs, index (driver_id, position).
- Backfill from current assignment + existing order: for each driver, get clients with assigned_driver_id = that driver; get order from current `drivers.stop_ids` (resolve stop IDs → client_ids for a recent date) or from existing stops; INSERT rows with positions 1, 2, 3, …
- Then implement assignment hook (add to list) and cleanup (sync list + set sequence, skipping clients with no stop that day).

This proposal is schema + behavior only; implementation (APIs, UI, backfill) follows when you adopt it.
