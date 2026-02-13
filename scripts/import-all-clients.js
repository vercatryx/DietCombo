/**
 * Import ALL clients from backup JSON (and their signatures, stops, drivers).
 * Optionally clear existing client-related data first.
 *
 * Partial data is OK: every client row is attempted. Missing fields get defaults
 * (e.g. full_name -> "Unknown", lat/lng on stops -> 0, created_at/updated_at -> now).
 * On per-row errors the script logs and continues so all clients can be imported.
 *
 * Handles 1000+ records via batched upserts (100 per batch). Client assigned_driver_id
 * is set from stops first (most reliable), then from user.assignedDriverId.
 *
 * Usage:
 *   node scripts/import-all-clients.js [options] <path-to-backup.json>
 *
 * Options:
 *   --clear      Clear DB first: delete all clients, signatures, schedules, stops, drivers, route_runs.
 *   --limit N    Import only N clients (for testing; default is all).
 *   --offset N   When using --limit, skip first N users.
 *   --dry-run    Log what would be done without writing.
 *
 * Examples:
 *   node scripts/import-all-clients.js --clear ./backup/backup.json
 *   node scripts/import-all-clients.js --clear --limit 5 ./backup/backup.json
 *   node scripts/import-all-clients.js ./backup/backup.json
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

/** Batch size for upserts to avoid PostgREST/network limits; supports 1000+ records. */
const BATCH_SIZE = 100;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error("Missing env:", name);
    process.exit(1);
  }
  return v;
}

function toPgTimestamp(val) {
  if (val == null) return null;
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return null;
}

function userName(u) {
  if (!u) return "?";
  const n = [u.first, u.last].filter(Boolean).join(" ").trim();
  return n || u.name || "Unknown";
}

function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let clearFirst = false;
  let limit = null;
  let offset = 0;
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--clear") clearFirst = true;
    else if (args[i] === "--limit") {
      limit = parseInt(args[i + 1], 10);
      if (Number.isNaN(limit) || limit < 1) {
        console.error("--limit must be a positive number");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--offset") {
      offset = parseInt(args[i + 1], 10);
      if (Number.isNaN(offset) || offset < 0) {
        console.error("--offset must be a non-negative number");
        process.exit(1);
      }
      i++;
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
      break;
    }
  }

  if (!filePath) {
    console.error("Usage: node scripts/import-all-clients.js [--clear] [--limit N] [--offset N] [--dry-run] <path-to-backup.json>");
    process.exit(1);
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error("File not found:", absPath);
    process.exit(1);
  }

  console.log("Reading backup from:", absPath);
  if (dryRun) console.log("DRY RUN – no database writes.");
  const raw = fs.readFileSync(absPath, "utf8");
  let backup;
  try {
    backup = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON:", e.message);
    process.exit(1);
  }

  const allUsers = Array.isArray(backup.users) ? backup.users : [];
  const users = limit != null
    ? allUsers.slice(offset, offset + limit)
    : allUsers.slice(offset);

  const allSignatures = Array.isArray(backup.signatures) ? backup.signatures : [];
  const allDrivers = Array.isArray(backup.drivers) ? backup.drivers : [];
  const allStops = Array.isArray(backup.stops) ? backup.stops : [];

  const userIds = new Set(users.map((u) => u.id));
  const userById = new Map(users.map((u) => [u.id, u]));
  const signatures = allSignatures.filter((s) => userIds.has(s.userId));
  const stops = allStops.filter((s) => userIds.has(s.userId));
  // Normalize driver IDs for lookup (backup may use number or string)
  const assignedDriverIds = new Set(stops.map((s) => s.assignedDriverId).filter((id) => id != null).map((id) => String(id)));
  const drivers = allDrivers.filter((d) => assignedDriverIds.has(String(d.id)));
  // For each user, resolve assigned driver for clients.assigned_driver_id:
  // Prefer driver from stops (most reliable for delivery routing), then user.assignedDriverId.
  const userToOldDriverId = new Map();
  for (const u of users) {
    const fromStop = stops.find((s) => s.userId === u.id && s.assignedDriverId != null);
    const fromUser = u.assignedDriverId != null ? String(u.assignedDriverId) : null;
    const oldId = (fromStop ? String(fromStop.assignedDriverId) : null) || fromUser;
    if (oldId) userToOldDriverId.set(u.id, oldId);
  }

  console.log("Will import:", {
    clients: users.length,
    signatures: signatures.length,
    stops: stops.length,
    drivers: drivers.length,
  });
  if (clearFirst) console.log("Will clear existing clients, signatures, schedules, stops, drivers, route_runs first.");

  if (users.length === 0) {
    console.error("No users in backup or slice empty.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("Dry run done. Run without --dry-run to import.");
    return;
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  (async () => {
    if (clearFirst) {
      console.log("\n--- Clearing DB ---");
      const tables = ["signatures", "schedules", "stops", "drivers", "route_runs", "client_box_orders", "clients"];
      for (const table of tables) {
        const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) {
          console.error("  Clear", table, "error:", error.message);
          throw error;
        }
        console.log("  Cleared", table + ".");
      }
      console.log("--- Clear done ---\n");
    }

    const userIdToClientId = new Map();

    let stats = { driversOk: 0, driversFail: 0, clientsOk: 0, clientsFail: 0, signaturesOk: 0, signaturesFail: 0, stopsOk: 0, stopsFail: 0 };

    // 1. Drivers first (so we have oldDriverIdToNewId for client and stop assigned_driver_id)
    console.log("\n--- Importing drivers ---");
    const oldDriverIdToNewId = new Map();
    for (const d of drivers) {
      const newId = randomUUID();
      oldDriverIdToNewId.set(String(d.id), newId);
      const row = {
        id: newId,
        day: (d.day || "all").slice(0, 40),
        name: (d.name || "Driver").slice(0, 510),
        color: d.color ? String(d.color).slice(0, 14) : null,
        stop_ids: [],
      };
      const { error } = await supabase.from("drivers").upsert(row, { onConflict: "id" });
      if (error) {
        console.error("Driver upsert error:", error.message);
        stats.driversFail++;
        continue;
      }
      stats.driversOk++;
      console.log("  Imported driver:", d.name || "Driver", "(" + (d.day || "all") + ")");
    }
    console.log("--- Drivers done:", stats.driversOk, "ok,", stats.driversFail, "failed ---\n");

    // 2. Clients (with assigned_driver_id from stops first, then user - ensures client gets driver)
    // Each user must get a unique Supabase client id. Backup can have duplicate u.clientId across users.
    const usedClientIds = new Set();
    console.log("--- Importing clients (batch size", BATCH_SIZE + ") ---");
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const rows = [];
      for (const u of batch) {
        const preferredId = u.clientId && /^[0-9a-f-]{36}$/i.test(u.clientId) ? u.clientId : null;
        const clientId = preferredId && !usedClientIds.has(preferredId) ? preferredId : randomUUID();
        usedClientIds.add(clientId);
        const fullName = [u.first, u.last].filter(Boolean).join(" ").trim() || "Unknown";
        const oldDriverId = userToOldDriverId.get(u.id);
        const assignedDriverId = oldDriverId ? (oldDriverIdToNewId.get(oldDriverId) || null) : null;
        userIdToClientId.set(u.id, clientId);
        rows.push({
          id: clientId,
          full_name: fullName.slice(0, 510),
          first_name: u.first ? String(u.first).slice(0, 510) : null,
          last_name: u.last ? String(u.last).slice(0, 510) : null,
          email: u.email ? String(u.email).slice(0, 510) : null,
          address: u.address ? String(u.address).slice(0, 1000) : null,
          apt: u.apt ? String(u.apt).slice(0, 100) : null,
          city: u.city ? String(u.city).slice(0, 200) : null,
          state: u.state ? String(u.state).slice(0, 4) : null,
          zip: u.zip ? String(u.zip).slice(0, 20) : null,
          county: u.county ? String(u.county).slice(0, 200) : null,
          phone_number: u.phone ? String(u.phone).slice(0, 510) : null,
          client_id_external: (u.clientId && String(u.clientId).length <= 200) ? String(u.clientId).slice(0, 200) : null,
          case_id_external: (u.caseId && u.clientId)
            ? `https://app.uniteus.io/dashboard/cases/open/${encodeURIComponent(String(u.caseId))}/contact/${encodeURIComponent(String(u.clientId))}`.slice(0, 510)
            : (u.caseId ? String(u.caseId).slice(0, 510) : null),
          medicaid: u.medicaid ?? false,
          paused: u.paused ?? false,
          complex: u.complex ?? false,
          bill: u.bill ?? true,
          delivery: u.delivery ?? true,
          dislikes: u.dislikes || null,
          latitude: u.latitude ?? null,
          longitude: u.longitude ?? null,
          lat: u.lat ?? null,
          lng: u.lng ?? null,
          geocoded_at: toPgTimestamp(u.geocodedAt),
          billings: u.billings ?? null,
          visits: u.visits ?? null,
          sign_token: u.sign_token ? String(u.sign_token).slice(0, 510) : null,
          service_type: "Food",
          assigned_driver_id: assignedDriverId,
          created_at: toPgTimestamp(u.createdAt) || new Date().toISOString(),
          updated_at: toPgTimestamp(u.updatedAt) || new Date().toISOString(),
        });
      }
      const { error } = await supabase.from("clients").upsert(rows, { onConflict: "id" });
      if (error) {
        console.error("Client upsert error (batch", Math.floor(i / BATCH_SIZE) + 1 + "):", error.message);
        stats.clientsFail += batch.length;
      } else {
        stats.clientsOk += batch.length;
        console.log("  Imported clients", i + 1, "–", i + batch.length, "of", users.length);
      }
    }
    console.log("--- Clients done:", stats.clientsOk, "ok,", stats.clientsFail, "failed ---\n");

    // Write user-to-client mapping for import-signatures-from-backup (1:1 so all 763 sig users map correctly)
    const mapPath = path.join(path.dirname(absPath), path.basename(absPath, ".json") + ".user-to-client-map.json");
    try {
      const mapObj = {};
      for (const [uid, cid] of userIdToClientId) {
        mapObj[String(uid)] = cid;
      }
      fs.writeFileSync(mapPath, JSON.stringify(mapObj, null, 0), "utf8");
      console.log("Wrote mapping to", mapPath, "(" + Object.keys(mapObj).length, "entries)\n");
    } catch (e) {
      console.warn("Could not write mapping file:", e.message);
    }

    // 3. Signatures (batched, dedupe by client_id+slot)
    console.log("--- Importing signatures (batch size", BATCH_SIZE + ") ---");
    const sigsByKey = new Map();
    for (const s of signatures) {
      const clientId = userIdToClientId.get(s.userId);
      if (!clientId) continue;
      const slot = Number(s.slot) || 0;
      const key = clientId + "|" + slot;
      sigsByKey.set(key, {
        id: randomUUID(),
        client_id: clientId,
        order_id: null,
        slot,
        strokes: s.strokes ?? [],
        signed_at: toPgTimestamp(s.signedAt) || new Date().toISOString(),
        ip: s.ip ? String(s.ip).slice(0, 90) : null,
        user_agent: s.userAgent ? String(s.userAgent).slice(0, 1000) : null,
      });
    }
    const sigsToInsert = [...sigsByKey.values()];
    for (let i = 0; i < sigsToInsert.length; i += BATCH_SIZE) {
      const batch = sigsToInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("signatures").upsert(batch, { onConflict: "client_id,slot" });
      if (error) {
        console.error("Signature upsert error (batch", Math.floor(i / BATCH_SIZE) + 1 + "):", error.message);
        stats.signaturesFail += batch.length;
      } else {
        stats.signaturesOk += batch.length;
        if (sigsToInsert.length > BATCH_SIZE) console.log("  Imported signatures", i + 1, "–", i + batch.length, "of", sigsToInsert.length);
      }
    }
    console.log("--- Signatures done:", stats.signaturesOk, "ok,", stats.signaturesFail, "failed ---\n");

    // 4. Stops (batched)
    console.log("--- Importing stops (batch size", BATCH_SIZE + ") ---");
    const driverToStopIds = new Map();
    const stopsToInsert = [];
    for (const s of stops) {
      const newId = randomUUID();
      const clientId = userIdToClientId.get(s.userId) || null;
      const assignedDriverId = s.assignedDriverId != null ? oldDriverIdToNewId.get(String(s.assignedDriverId)) || null : null;
      if (assignedDriverId) {
        if (!driverToStopIds.has(assignedDriverId)) driverToStopIds.set(assignedDriverId, []);
        driverToStopIds.get(assignedDriverId).push(newId);
      }
      stopsToInsert.push({
        id: newId,
        day: (s.day || "all").slice(0, 40),
        client_id: clientId,
        order: s.order ?? null,
        name: (s.name || "Stop").slice(0, 510),
        address: (s.address || "—").slice(0, 1000),
        apt: s.apt ? String(s.apt).slice(0, 100) : null,
        city: (s.city || "—").slice(0, 200),
        state: (s.state || "—").slice(0, 4),
        zip: (s.zip || "—").slice(0, 20),
        phone: s.phone ? String(s.phone).slice(0, 40) : null,
        dislikes: s.dislikes || null,
        lat: (s.lat != null && s.lat !== "") ? Number(s.lat) : 0,
        lng: (s.lng != null && s.lng !== "") ? Number(s.lng) : 0,
        completed: s.completed === true,
        proof_url: s.proofUrl ? String(s.proofUrl).slice(0, 1000) : null,
        assigned_driver_id: assignedDriverId,
        order_id: null,
        delivery_date: null,
        created_at: toPgTimestamp(s.createdAt),
        updated_at: toPgTimestamp(s.updatedAt),
      });
    }
    for (let i = 0; i < stopsToInsert.length; i += BATCH_SIZE) {
      const batch = stopsToInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("stops").upsert(batch, { onConflict: "id" });
      if (error) {
        console.error("Stop upsert error (batch", Math.floor(i / BATCH_SIZE) + 1 + "):", error.message);
        stats.stopsFail += batch.length;
      } else {
        stats.stopsOk += batch.length;
        console.log("  Imported stops", i + 1, "–", i + batch.length, "of", stopsToInsert.length);
      }
    }
    console.log("--- Stops done:", stats.stopsOk, "ok,", stats.stopsFail, "failed ---\n");

    // 5. Update drivers with stop_ids
    console.log("--- Updating driver stop_ids ---");
    for (const [newDriverId, stopIds] of driverToStopIds) {
      const { error } = await supabase.from("drivers").update({ stop_ids: stopIds }).eq("id", newDriverId);
      if (error) {
        console.error("Driver stop_ids update error:", error.message);
      }
    }
    console.log("  Updated", driverToStopIds.size, "drivers with stop_ids.\n");

    console.log("Done. Clients:", stats.clientsOk, "ok,", stats.clientsFail, "failed. Signatures:", stats.signaturesOk, "ok,", stats.signaturesFail, "failed. Stops:", stats.stopsOk, "ok,", stats.stopsFail, "failed. Drivers:", stats.driversOk, "ok,", stats.driversFail, "failed.");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
