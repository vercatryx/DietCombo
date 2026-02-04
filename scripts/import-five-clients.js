/**
 * Import clients from backup JSON (and their signatures, stops, drivers).
 * Optionally clear existing client-related data first, then import all or a slice.
 *
 * Usage:
 *   node scripts/import-five-clients.js [options] <path-to-backup.json>
 *
 * Options:
 *   --clear      Clear DB first: delete all clients, signatures, schedules, stops, drivers, route_runs.
 *   --all        Import ALL clients from backup (default with --clear; otherwise imports 5).
 *   --dry-run    Log what would be done without writing.
 *   --offset N   When not using --all, skip first N users and import the next 5.
 *
 * Examples:
 *   node scripts/import-five-clients.js --clear --all ./backup/backup.json
 *   node scripts/import-five-clients.js ./backup/backup.json
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const DEFAULT_LIMIT = 5;

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
  let importAll = false;
  let offset = 0;
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--clear") clearFirst = true;
    else if (args[i] === "--all") importAll = true;
    else if (args[i] === "--offset") {
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
    console.error("Usage: node scripts/import-five-clients.js [--clear] [--all] [--dry-run] [--offset N] <path-to-backup.json>");
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
  const limit = importAll || clearFirst ? allUsers.length : DEFAULT_LIMIT;
  const users = importAll || clearFirst
    ? allUsers
    : allUsers.slice(offset, offset + limit);

  const allSignatures = Array.isArray(backup.signatures) ? backup.signatures : [];
  const allDrivers = Array.isArray(backup.drivers) ? backup.drivers : [];
  const allStops = Array.isArray(backup.stops) ? backup.stops : [];

  const userIds = new Set(users.map((u) => u.id));
  const userById = new Map(users.map((u) => [u.id, u]));
  const signatures = allSignatures.filter((s) => userIds.has(s.userId));
  const stops = allStops.filter((s) => userIds.has(s.userId));
  const assignedDriverIds = new Set(stops.map((s) => s.assignedDriverId).filter(Boolean));
  const drivers = allDrivers.filter((d) => assignedDriverIds.has(d.id));

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
      const { error: e1 } = await supabase.from("signatures").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e1) { console.error("Clear signatures error:", e1.message); throw e1; }
      console.log("  Cleared signatures.");

      const { error: e2 } = await supabase.from("schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e2) { console.error("Clear schedules error:", e2.message); throw e2; }
      console.log("  Cleared schedules.");

      const { error: e3 } = await supabase.from("stops").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e3) { console.error("Clear stops error:", e3.message); throw e3; }
      console.log("  Cleared stops.");

      const { error: e4 } = await supabase.from("drivers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e4) { console.error("Clear drivers error:", e4.message); throw e4; }
      console.log("  Cleared drivers.");

      const { error: e5 } = await supabase.from("route_runs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e5) { console.error("Clear route_runs error:", e5.message); throw e5; }
      console.log("  Cleared route_runs.");

      const { error: e5b } = await supabase.from("client_box_orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e5b) { console.error("Clear client_box_orders error:", e5b.message); throw e5b; }
      console.log("  Cleared client_box_orders.");

      const { error: e6 } = await supabase.from("clients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (e6) { console.error("Clear clients error:", e6.message); throw e6; }
      console.log("  Cleared clients.");
      console.log("--- Clear done ---\n");
    }

    const userIdToClientId = new Map();

    // 1. Clients
    console.log("\n--- Importing clients ---");
    for (const u of users) {
      const clientId = u.clientId && /^[0-9a-f-]{36}$/i.test(u.clientId) ? u.clientId : randomUUID();
      userIdToClientId.set(u.id, clientId);
      const fullName = [u.first, u.last].filter(Boolean).join(" ").trim() || "Unknown";
      const row = {
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
        client_id_external: null,
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
        created_at: toPgTimestamp(u.createdAt),
        updated_at: toPgTimestamp(u.updatedAt),
      };
      const { error } = await supabase.from("clients").upsert(row, { onConflict: "id" });
      if (error) {
        console.error("Client upsert error:", error.message, "id:", clientId);
        throw error;
      }
      console.log("  Imported client:", fullName);
    }
    console.log("--- Clients done:", users.length, "---\n");

    // 2. Signatures
    console.log("--- Importing signatures ---");
    for (const s of signatures) {
      const clientId = userIdToClientId.get(s.userId);
      if (!clientId) continue;
      const name = userName(userById.get(s.userId));
      const id = randomUUID();
      const row = {
        id,
        client_id: clientId,
        order_id: null,
        slot: Number(s.slot) || 0,
        strokes: s.strokes ?? [],
        signed_at: toPgTimestamp(s.signedAt) || new Date().toISOString(),
        ip: s.ip ? String(s.ip).slice(0, 90) : null,
        user_agent: s.userAgent ? String(s.userAgent).slice(0, 1000) : null,
      };
      const { error } = await supabase.from("signatures").upsert(row, { onConflict: "client_id,slot" });
      if (error) {
        console.error("Signature upsert error:", error.message);
        throw error;
      }
      console.log("  Imported signature for", name, "(slot", s.slot + ")");
    }
    console.log("--- Signatures done:", signatures.length, "---\n");

    // 3. Drivers
    console.log("--- Importing drivers ---");
    const oldDriverIdToNewId = new Map();
    for (const d of drivers) {
      const newId = randomUUID();
      oldDriverIdToNewId.set(d.id, newId);
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
        throw error;
      }
      console.log("  Imported driver:", d.name || "Driver", "(" + (d.day || "all") + ")");
    }
    console.log("--- Drivers done:", drivers.length, "---\n");

    // 4. Stops
    console.log("--- Importing stops ---");
    const driverToStopIds = new Map();
    for (const s of stops) {
      const newId = randomUUID();
      const clientId = userIdToClientId.get(s.userId) || null;
      const assignedDriverId = s.assignedDriverId != null ? oldDriverIdToNewId.get(s.assignedDriverId) || null : null;
      const name = userName(userById.get(s.userId));
      const row = {
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
        lat: s.lat ?? null,
        lng: s.lng ?? null,
        completed: s.completed === true,
        proof_url: s.proofUrl ? String(s.proofUrl).slice(0, 1000) : null,
        assigned_driver_id: assignedDriverId,
        order_id: null,
        delivery_date: null,
        created_at: toPgTimestamp(s.createdAt),
        updated_at: toPgTimestamp(s.updatedAt),
      };
      const { error } = await supabase.from("stops").upsert(row, { onConflict: "id" });
      if (error) {
        console.error("Stop upsert error:", error.message);
        throw error;
      }
      if (assignedDriverId) {
        if (!driverToStopIds.has(assignedDriverId)) driverToStopIds.set(assignedDriverId, []);
        driverToStopIds.get(assignedDriverId).push(newId);
      }
      const addr = (s.address || "").slice(0, 40);
      console.log("  Imported stop for", name + (addr ? ": " + addr + (addr.length >= 40 ? "…" : "") : ""));
    }
    console.log("--- Stops done:", stops.length, "---\n");

    // 5. Update drivers with stop_ids
    console.log("--- Updating driver stop_ids ---");
    for (const [newDriverId, stopIds] of driverToStopIds) {
      const { error } = await supabase.from("drivers").update({ stop_ids: stopIds }).eq("id", newDriverId);
      if (error) {
        console.error("Driver stop_ids update error:", error.message);
        throw error;
      }
    }
    console.log("  Updated", driverToStopIds.size, "drivers with stop_ids.\n");

    console.log("Done. Imported", users.length, "clients,", signatures.length, "signatures,", stops.length, "stops,", drivers.length, "drivers.");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
