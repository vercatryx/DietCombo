# How to import backup JSON data

This guide explains how to import a full backup JSON file (exported via **Full backup (JSON)** in the app or `GET /api/export/backup`) into your database.

**Small-scale try:** To import only the first 5 clients and all their related data (schedules, signatures, stops, drivers), use the Supabase-based script: `node scripts/import-five-clients.js [--dry-run] ./backup/backup-2026-02-04T13-19-59.json`. Run with `--dry-run` first to see counts without writing. Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

## 1. Backup file format

The backup is a single JSON object with a timestamp and six arrays:

| Key           | Description |
|---------------|-------------|
| `exportedAt`  | ISO date when the backup was created |
| `users`       | All clients; each may include nested `schedule` |
| `signatures`  | All signature rows (`id` is string in JSON) |
| `routes`      | All route definitions |
| `drivers`     | All driver rows (per day) |
| `stops`       | All stop rows (per day) |
| `routeRuns`   | All route run snapshots |

---

## 2. Sample backup (minimal)

Use this as a reference. A real export will have many more rows in each array.

```json
{
  "exportedAt": "2025-02-04T15:30:00.000Z",
  "users": [
    {
      "id": 1,
      "first": "Jane",
      "last": "Doe",
      "address": "123 Main St",
      "apt": null,
      "city": "Lakewood",
      "dislikes": null,
      "county": "Ocean",
      "zip": "08701",
      "state": "NJ",
      "phone": "(732) 555-0100",
      "medicaid": false,
      "paused": false,
      "complex": false,
      "clientId": "abc123-unite-us-client",
      "caseId": "case-456-unite-us",
      "billings": [],
      "latitude": null,
      "longitude": null,
      "geocodedAt": null,
      "lat": 40.0823,
      "lng": -74.2094,
      "visits": [],
      "sign_token": null,
      "createdAt": "2025-01-15T12:00:00.000Z",
      "updatedAt": "2025-02-01T10:00:00.000Z",
      "bill": true,
      "delivery": true,
      "schedule": {
        "id": 1,
        "userId": 1,
        "monday": true,
        "tuesday": true,
        "wednesday": true,
        "thursday": true,
        "friday": true,
        "saturday": false,
        "sunday": false
      }
    }
  ],
  "signatures": [
    {
      "id": "1",
      "userId": 1,
      "slot": 0,
      "strokes": [[{ "x": 10, "y": 20, "t": 1234567890 }]],
      "signedAt": "2025-02-01T14:00:00.000Z",
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0 ..."
    }
  ],
  "routes": [
    {
      "id": 1,
      "name": "Monday Route A",
      "color": "#22c55e",
      "stopIds": [1, 2, 3]
    }
  ],
  "drivers": [
    {
      "id": 1,
      "day": "monday",
      "name": "Driver 1",
      "color": "#3b82f6",
      "stopIds": [1, 2, 3],
      "createdAt": "2025-02-04T08:00:00.000Z",
      "updatedAt": "2025-02-04T08:00:00.000Z"
    }
  ],
  "stops": [
    {
      "id": 1,
      "day": "monday",
      "userId": 1,
      "order": 0,
      "name": "Jane Doe",
      "address": "123 Main St",
      "apt": null,
      "city": "Lakewood",
      "state": "NJ",
      "zip": "08701",
      "phone": "(732) 555-0100",
      "dislikes": null,
      "lat": 40.0823,
      "lng": -74.2094,
      "completed": false,
      "proofUrl": null,
      "assignedDriverId": 1,
      "createdAt": "2025-02-04T08:00:00.000Z",
      "updatedAt": "2025-02-04T08:00:00.000Z"
    }
  ],
  "routeRuns": [
    {
      "id": 1,
      "day": "monday",
      "createdAt": "2025-02-04T08:05:00.000Z",
      "snapshot": [
        { "name": "Driver 1", "color": "#3b82f6", "stopIds": [1, 2, 3] }
      ]
    }
  ]
}
```

---

## 3. Prerequisites

- Node.js and npm (same as for the app).
- Database URL in `.env.local` (e.g. `DATABASE_URL` and `DIRECT_URL` for PostgreSQL).
- A backup JSON file (e.g. `backup-2025-02-04T15-30-00.000Z.json`).

---

## 4. Import using the script (recommended)

A Node script is provided that reads the backup file and inserts data in the correct order.

1. **Back up your current database** (if you care about existing data). The import script can **replace** all data in the backup-related tables (see script options below).

2. **Run the import script** from the project root:

   ```bash
   node scripts/import-backup.js path/to/your/backup.json
   ```

   Or use the npm script (pass the file path after `--`):

   ```bash
   npm run import-backup -- ./backup-2025-02-04T15-30-00.000Z.json
   ```

   Example:

   ```bash
   node scripts/import-backup.js ./backup-2025-02-04T15-30-00.000Z.json
   ```

3. **Optional: clear existing data first**  
   To replace everything that’s in the backup (users, signatures, routes, drivers, stops, route runs), use the `--replace` flag:

   ```bash
   node scripts/import-backup.js --replace ./backup-2025-02-04T15-30-00.000Z.json
   ```

   **Warning:** `--replace` deletes all rows from the User, Signature, Schedule, Route, Driver, Stop, and RouteRun tables before importing. Use only on a copy of the DB or when you intend to fully restore from the backup.

4. **Environment**  
   The script loads `.env.local` (like the seed script). Ensure `DATABASE_URL` (and `DIRECT_URL` if used) point to the database you want to import into.

---

## 5. Import order (if you write your own tool)

If you implement your own importer, insert data in this order to satisfy foreign keys and references:

1. **Users** (with nested **schedule**).  
   Create each user; if the backup has `schedule`, create the schedule linked to that user (or use the same `userId` when creating the Schedule row).

2. **Signatures.**  
   Use `userId` from the backup; it must match an existing `User.id`.

3. **Routes.**  
   No foreign keys; `stopIds` are plain integers (Stop ids).

4. **Drivers.**  
   No foreign keys; `stopIds` is JSON array of Stop ids.

5. **Stops.**  
   No foreign keys; `userId` can reference User.id.

6. **RouteRuns.**  
   No foreign keys; `snapshot` is JSON.

After inserting with **explicit IDs**, reset PostgreSQL sequences so the next auto-generated id doesn’t conflict. For example (adjust table names to match your schema):

```sql
SELECT setval(pg_get_serial_sequence('"User"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "User"));
SELECT setval(pg_get_serial_sequence('"Signature"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "Signature"));
-- and similarly for Route, Driver, Stop, RouteRun
```

The provided `scripts/import-backup.js` does this for you when run with a backup file.

---

## 6. Verify after import

- Open the app and check that clients, routes, and drivers look correct.
- Check a client who had signatures and open their signature page (if applicable).
- Optionally run `npx prisma studio` (or `npm run prisma:studio`) and inspect the User, Signature, Route, Driver, Stop, and RouteRun tables.

---

## 7. Troubleshooting

| Issue | What to try |
|-------|------------------|
| `DATABASE_URL` not set | Create or edit `.env.local` with `DATABASE_URL` (and `DIRECT_URL` if needed). |
| Unique constraint on `User.sign_token` | Backup may have duplicate or null `sign_token`; the script should omit or normalize them. |
| Signature `id` type | In the backup JSON, signature `id` is a string (e.g. `"1"`). The import script should convert it back to the type your DB expects (e.g. BigInt). |
| Wrong order of inserts | Follow the order in section 5 so User and Schedule exist before Signatures, and IDs used in `stopIds` / `userId` exist. |

If you need to import only **users** (and schedules) and skip signatures/routes/drivers/stops/routeRuns, you can modify the script or use a small one-off that reads the same JSON and creates only `users` (and `schedule`).
