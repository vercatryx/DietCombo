# Stress Test: Stable Routes Proposal (driver_route_order)

**Purpose:** Find issues, edge cases, and failure modes in the proposal before implementation.

---

## 0. Implementation approach (agreed)

- **Cleanup:** The existing cleanup file will be **rewritten** for the new target. Old logic (e.g. one-stop-per-order semantics, reliance on `stop_ids`) is **removed**; the new cleanup is designed for `driver_route_order` + clients as assignment truth. No need to preserve backward compatibility with current cleanup behavior.
- **Reassign / unassign safety:** When changing a client’s driver (reassign or unassign), **always delete from the old place before adding to the new** (and do both in the same transaction where possible):
  - **Reassign (A → B):** In one transaction: update `clients.assigned_driver_id`; update existing `stops` for that client to new driver; **DELETE** from `driver_route_order` WHERE `client_id` = C (removes from driver A, or any driver); **INSERT** into `driver_route_order` for (driver B, client C, position = next). So the client is never on two lists at once, and if the INSERT fails we haven’t left them on no list (we can retry or fix).
  - **Unassign:** Update `clients.assigned_driver_id = NULL`; **DELETE** from `driver_route_order` WHERE `client_id` = C. No add.
- **Safer pattern:** For reassign, “DELETE from driver_route_order WHERE client_id = C” (any driver) then “INSERT for new driver” is safer than “DELETE WHERE driver_id = old AND client_id = C” then INSERT, because it also cleans up any bad state where the client was on more than one list.

---

## 1. Data model conflicts (current codebase)

### 1.1 One stop per client vs one stop per order

- **Current schema:** `stops` has **UNIQUE(client_id, delivery_date)** → at most **one stop per client per delivery_date**.
- **Current cleanup (to be replaced):** Creates one stop per order; multiple orders for the same client on the same date would trigger multiple inserts for the same (client_id, delivery_date) → **second insert fails** on the unique constraint.

**Impact on proposal:** The proposal says “if there is at least one stop” per client per date. With the current unique constraint there is at most one stop per (client, date). So “multiple stops per client per date” is not possible today. If you ever change to one stop per order (drop the unique), then:

- `driver_route_order` is keyed by **client_id** (one row per client per driver).
- One client can have several stops on one date. You must define: does that client get **one** sequence number (one “visit”) and all their stops share it, or do we need sub-ordering (e.g. sequence 5.1, 5.2)? Proposal’s “assign sequence for that/those stops” should explicitly pick one rule.

**Recommendation:** With cleanup being rewritten, pick one model and implement to match: (a) one stop per client per date (align with current unique), or (b) one per order (drop unique, define sequence for multiple stops per client).

---

### 1.2 Stops without client_id

- **Schema:** `stops.client_id` is **nullable**.
- **Proposal:** “Build today’s route” matches stops to `driver_route_order` by `client_id`. Stops with `client_id` NULL cannot be placed in the list.

**Issue:** Any stop with `client_id` NULL never gets a position from `driver_route_order` and can be omitted or ordered last depending on implementation.

**Recommendation:** Either (a) require `client_id` NOT NULL for stops that participate in routes and enforce in cleanup, or (b) define explicit rule: e.g. “stops with null client_id get sequence after everyone in the list.”

---

## 2. Consistency: assignment vs driver_route_order

### 2.1 Orphaned rows (client no longer assigned to that driver)

- **Scenario:** Client C is reassigned from driver A to driver B. We update `clients.assigned_driver_id = B` and add C to B’s list. If we **do not** remove C from A’s list, driver A’s list still contains C.
- **Effect:** When building A’s route we walk the list; for C we look for a stop with (client_id=C, assigned_driver_id=A). There is none (C is assigned to B), so we skip. Route is correct, but A’s list is **stale** (includes a client that is no longer assigned to A).
- **Worse:** If we ever “sync” driver_route_order from the list (e.g. “save route”), we might reintroduce C into A’s data. Or reporting “how many clients on this driver’s route” would be wrong.

**Recommendation:** **Remove** the client from the old driver’s list on reassign. Make “remove from old driver’s list” mandatory, not optional, so the list always matches the set of clients assigned to that driver.

---

### 2.2 Unassign: client has no driver but still on a list

- **Scenario:** We set `clients.assigned_driver_id = NULL`. If we don’t remove the client from `driver_route_order` for the previous driver, that driver still has them in the list.
- **Effect:** Same as 2.1 — stale list; when building route we skip (no stop for that driver). But the list is wrong.

**Recommendation:** On unassign, **delete** the row(s) for that client from `driver_route_order` (for the driver they were assigned to).

---

### 2.3 Inverse inconsistency: in list but not assigned

- **Scenario:** Bug or manual edit: row (driver_id=A, client_id=C) exists but `clients.assigned_driver_id` for C is B or NULL.
- **Effect:** When building A’s route we look for stops for C with assigned_driver_id=A; there are none, so we skip. No wrong stop appears, but A’s list again has a client that shouldn’t be there.
- **Worse:** If cleanup “syncs” by “every client with assigned_driver_id=D gets a row for D,” we never remove rows for clients who were reassigned/unassigned unless we explicitly delete on reassign/unassign.

**Recommendation:** Treat `clients.assigned_driver_id` as source of truth. On reassign/unassign, update list (add to new, remove from old). Optionally: periodic job that deletes `driver_route_order` rows where `client_id` is not assigned to that driver (safety net).

---

## 3. Concurrency and position assignment

### 3.1 Duplicate positions (two clients, same position)

- **Scenario:** Two assignments to the same driver at the same time. Both compute “next position” as `MAX(position)+1` (e.g. both read 10, both write 11). We have two rows with position=11.
- **Effect:** When we “ORDER BY position” we get a non-deterministic order between those two clients (database may return either first). Route order for that pair is undefined.

**Recommendation:** Pick one:

- **A)** Use a **database sequence or SERIAL** per driver (e.g. a column that auto-increments), or lock the driver’s rows when computing next position (SELECT ... FOR UPDATE), so only one writer gets “next.”
- **B)** Use **UNIQUE(driver_id, position)** and handle conflicts: on INSERT conflict, renumber (e.g. increment positions >= new one and retry) or use “fractional” positions (e.g. 10.5 between 10 and 11) to avoid renumbering.
- **C)** Allow duplicate positions and define a **tie-breaker** (e.g. ORDER BY position, client_id). Document that ordering between same-position clients is stable but arbitrary unless you renumber.

---

### 3.2 Cleanup step 2: “add if missing” under concurrency

- **Scenario:** Cleanup runs for date D1 and D2 (or two workers for same date). Both see “client C assigned to driver A, not in driver_route_order.” Both do INSERT (driver_id=A, client_id=C, position=MAX+1). Second insert fails on **UNIQUE(driver_id, client_id)**.
- **Effect:** If you use plain INSERT, one fails. If you use **INSERT ... ON CONFLICT (driver_id, client_id) DO NOTHING** (or check “exists” before insert), both succeed and only one row exists. So no duplicate client per driver, but you must not assume “insert always succeeds” — use ON CONFLICT or check.

**Recommendation:** In cleanup step 2 use **INSERT ... ON CONFLICT (driver_id, client_id) DO NOTHING** (or DO UPDATE if you want to refresh something). Do not rely on “we only add when missing” without handling the race.

---

## 4. Referential integrity and lifecycle

### 4.1 Client deleted

- **Scenario:** Client C is deleted (or soft-deleted and excluded from queries). `driver_route_order` has (driver_id=A, client_id=C, position=5).
- **Effect:** If FK is ON DELETE CASCADE, the row is removed. If ON DELETE SET NULL and `client_id` is NOT NULL, delete of client fails until the row is removed. If no FK, we have an orphan row; building the route would join to client and get nothing (or need to handle missing client).

**Recommendation:** FK from `driver_route_order.client_id` to `clients.id` with **ON DELETE CASCADE** so deleting a client automatically removes them from every driver’s list. If you soft-delete clients, either exclude them in application logic when building the list or add a periodic cleanup that removes rows for soft-deleted clients.

---

### 4.2 Driver deleted

- **Scenario:** Driver D is removed. Rows in `driver_route_order` with driver_id=D remain (or not, depending on FK).
- **Effect:** If ON DELETE CASCADE, rows go away. If not, orphan rows; and clients still have assigned_driver_id=D unless you clear that separately.

**Recommendation:** FK from `driver_route_order.driver_id` to `drivers.id` with **ON DELETE CASCADE**. When a driver is deleted, their list is removed. Also define what happens to `clients.assigned_driver_id` when a driver is deleted (e.g. SET NULL in clients or block driver delete until reassigned).

---

## 5. Cleanup order and correctness

### 5.1 Stops exist for a client who isn’t in the list yet

- **Scenario:** Cleanup step 1 creates a stop for (client C, driver D, date X). Step 2 is supposed to add C to D’s list if missing. If step 2 fails or is skipped, C is never in `driver_route_order`.
- **Effect:** Step 3 walks D’s list in order; C is not in the list, so that stop **never gets a sequence**. You can have stops with NULL sequence or “after all list clients,” depending on implementation. Route for that day is wrong or ambiguous.

**Recommendation:** Make step 2 **mandatory** and robust (e.g. transaction that includes 1+2+3, or retry step 2). Optionally in step 3: after walking the list, any stop for that driver/date that still has no sequence gets a “tail” sequence (e.g. max(sequence)+1) so no stop is left unordered.

---

### 5.2 Order of steps and partial failure

- **Scenario:** Step 1 succeeds (stops created), step 2 succeeds (list synced), step 3 fails halfway (e.g. timeout after setting sequence for some drivers).
- **Effect:** Some drivers’ stops have sequence set, others don’t. Next run: step 1 might not create new stops (already exist), step 2 might add more clients, step 3 runs again. If step 3 is idempotent (recompute sequence from list every time), second run fixes the rest. If not, you need a way to recompute.

**Recommendation:** Make step 3 **idempotent**: for each driver and date, recompute sequence purely from `driver_route_order` + existing stops. No “only set if null” that could leave stale values. Run cleanup in a transaction if possible so 1+2+3 commit together; if not, document that a second cleanup run is safe and will fix partial state.

---

## 6. Reordering and UX (not in proposal)

### 6.1 Driver reorders route (drag-and-drop)

- **Scenario:** Driver’s list is [C1, C2, C3, C4, C5]. They drag C5 to position 2. New order: [C1, C5, C2, C3, C4].
- **Effect:** You must UPDATE `driver_route_order`: set C5’s position to 2 and renumber others (e.g. old 2→3, 3→4, 4→5). That’s multiple UPDATEs; with concurrent requests you can get duplicate positions again (see 3.1). Or you use fractional positions (e.g. 1, 1.5, 2, 3, 4) so only one row is updated.

**Recommendation:** Either (a) use fractional positions and update only the moved row, or (b) do renumbering in a transaction with a lock so only one reorder at a time per driver, or (c) accept duplicate positions and a stable tie-breaker (e.g. client_id).

---

## 7. Bulk operations and performance

### 7.1 Bulk reassign (many clients from A to B)

- **Scenario:** Reassign 50 clients from driver A to driver B. We update 50 rows in `clients`, must insert 50 rows into `driver_route_order` for B (with positions), and should delete 50 rows for A.
- **Effect:** If we do 50 single-row INSERTs with MAX(position)+1 each, we hit the duplicate-position race unless we lock or use a sequence. Better: single query “INSERT INTO driver_route_order SELECT ..., (SELECT COALESCE(MAX(position),0)+row_number() FROM ...)” or batch with precomputed positions in one transaction.

**Recommendation:** Bulk reassign should compute all new positions in one go (e.g. MAX(position)+1, MAX(position)+2, …) and do a single batch INSERT for the new driver, and a single DELETE for the old driver (WHERE driver_id=old_driver AND client_id IN (...)).

---

### 7.2 Very long lists

- **Scenario:** One driver has 500 clients in `driver_route_order`. Cleanup step 3 walks the list and for each client_id checks stops. 500 lookups or one join.
- **Effect:** With an index on (driver_id, position) and a join to stops (delivery_date, assigned_driver_id, client_id), one query per driver is fine. Avoid N+1: “for each client in list, query stops” → use one query that joins list to stops.

**Recommendation:** Build “today’s route” and “set sequence” with set-based queries (join `driver_route_order` to `stops` on client_id, delivery_date, assigned_driver_id), not per-client round-trips.

---

## 8. Edge cases summary

| # | Issue | Severity | Fix / recommendation |
|---|--------|----------|------------------------|
| 1.1 | One stop per client (unique) vs one per order (cleanup) | High | Align schema and business rule; document sequence rule if multiple stops per client allowed later. |
| 1.2 | stops.client_id nullable | Medium | Require client_id for route stops or define rule for null. |
| 2.1 | Orphaned rows when reassigning (old driver keeps client in list) | Medium | Remove from old driver’s list on reassign (mandatory). |
| 2.2 | Unassign leaves client on list | Medium | Delete from list on unassign. |
| 2.3 | In list but not assigned | Low | Reassign/unassign logic + optional periodic sync. |
| 3.1 | Duplicate positions (concurrent assignment) | High | Sequence/lock, or unique position + conflict handling, or tie-breaker. |
| 3.2 | Cleanup step 2 duplicate insert | Medium | INSERT ... ON CONFLICT DO NOTHING (or equivalent). |
| 4.1 | Client deleted | Medium | FK ON DELETE CASCADE (or soft-delete handling). |
| 4.2 | Driver deleted | Medium | FK ON DELETE CASCADE; define client assigned_driver_id behavior. |
| 5.1 | Stop created but client not in list (step 2 skipped/failed) | High | Step 2 mandatory; optionally step 3 “tail” for unsequenced stops. |
| 5.2 | Partial failure of step 3 | Medium | Idempotent step 3; optional transaction. |
| 6.1 | Reorder (drag) causes duplicate positions or many updates | Medium | Fractional positions or lock + renumber. |
| 7.1 | Bulk reassign position race | Medium | Batch insert with precomputed positions. |
| 7.2 | N+1 when building route | Low | Set-based join, not per-client queries. |
| 10.1 | Reassign: update existing stops | Medium | Update stops.assigned_driver_id for that client in same transaction as list delete/insert. |
| 10.2 | Backfill driver_route_order | Medium | Populate from current assignment (and optional order from stop_ids/stops); then deprecate stop_ids. |
| 10.3 | drivers.stop_ids deprecation | Low | Remove or document as cache; APIs build order from driver_route_order + stops. |
| 10.4 | API impact (mobile, drivers app) | Medium | Endpoints must build "today's route" from driver_route_order + stops; stop_ids no longer source of order. |
| 10.5 | stops.order vs sequence | Low | Reuse one column for "position in route on this date"; document clearly. |
| 10.6 | day vs delivery_date | Low | Align all route logic on delivery_date; derive day when needed. |

---

## 9. Suggested schema tweaks (from stress test)

- **driver_route_order**
  - **UNIQUE(driver_id, client_id)** — already in proposal.
  - **FK client_id → clients(id) ON DELETE CASCADE.**
  - **FK driver_id → drivers(id) ON DELETE CASCADE.**
  - **position:** Either (a) allow duplicates and document tie-breaker (ORDER BY position, client_id), or (b) add **UNIQUE(driver_id, position)** and use a sequence/lock when assigning “next” position, or (c) use a per-driver sequence type (e.g. SERIAL or app-managed “next” with lock).
- **Cleanup:** Use INSERT ... ON CONFLICT (driver_id, client_id) DO NOTHING in step 2; make step 3 idempotent; consider “tail” sequence for stops not in the list.

---

## 10. Other issues

### 10.1 Reassign: update existing stops in same transaction

When reassigning client C from driver A to B, existing **stops** for C may have `assigned_driver_id = A`. Those should be updated to B in the **same transaction** as the client update and driver_route_order delete/insert, so route-building for both drivers stays correct. (Current assign-client-driver API already updates stops; keep that behavior.)

### 10.2 Backfill / migration

When going live with `driver_route_order`, you need an initial population. Options: (a) from current `clients.assigned_driver_id` (every assigned client gets one row per driver, position = arbitrary or from existing `drivers.stop_ids` resolved to client_ids for a recent date); (b) from current stops (group by assigned_driver_id, order by existing `order`/sequence). After backfill, **do not** rely on `drivers.stop_ids` for "the" route order; it can be deprecated or kept as an optional cache filled from driver_route_order + stops when needed.

### 10.3 Deprecation of drivers.stop_ids (and routes.stop_ids)

With route order in `driver_route_order`, `drivers.stop_ids` (and routes equivalent) are redundant for "general route." Either remove them or document as optional cache (e.g. "today's ordered stop IDs" for backward compatibility). APIs (mobile/routes, drivers app) that today read stop_ids will need to build "today's route" from driver_route_order + stops by delivery_date instead.

### 10.4 APIs that build "today's route"

Any endpoint that returns a driver's stops in order for a date (e.g. mobile/routes, mobile/stops, drivers app) must switch to: read `driver_route_order` for that driver by position, join to stops on (client_id, delivery_date, assigned_driver_id), skip clients with no stop that day. So there is an **API/contract impact**; callers that expect `stop_ids` on the driver object may need to receive an ordered list of stops (or stop_ids) derived from driver_route_order + stops instead.

### 10.5 Stops.sequence vs stops.order

Current `stops` has an **"order"** column. The proposal uses "sequence." Decide: reuse `order` for "position in driver's route on this delivery_date" or add a dedicated **sequence** column and keep **order** for something else (or deprecate). One clear column name avoids confusion in cleanup and in mobile/API.

### 10.6 Day vs delivery_date

Cleanup and "today's route" are keyed by **delivery_date**. Any remaining logic that filters by **day** (e.g. Monday) only should be aligned: either both day and delivery_date are used consistently, or everything uses delivery_date and day is derived when needed.

---

This stress test is part of the proposal only; no implementation has been done.
