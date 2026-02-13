/**
 * Import ALL signatures from backup JSON into Supabase (standalone, after clients exist).
 * Maps each backup USER (userId) to the correct Supabase client using client_id_external
 * + first/last name to resolve duplicates (backup has 790 users but only 690 unique clientIds).
 *
 * Uses batched upserts (100 per batch) to handle 3800+ signatures without timeout/rate limits.
 * Clients must already exist in DB (from import-all-clients.js).
 *
 * Usage:
 *   node scripts/import-signatures-from-backup.js [options] <path-to-backup.json>
 *
 * Options:
 *   --dry-run    Log counts and mapping only; no DB writes.
 *   --limit N    Only process first N signatures (for testing).
 *   --clear      Delete all existing signatures before importing.
 *
 * Example:
 *   node scripts/import-signatures-from-backup.js ./backup/backup.json
 *   node scripts/import-signatures-from-backup.js --clear ./backup/backup.json
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

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
  let limit = null;
  let clearFirst = false;
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
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
      break;
    }
  }

  if (!filePath) {
    console.error("Usage: node scripts/import-signatures-from-backup.js [--dry-run] [--clear] [--limit N] <path-to-backup.json>");
    process.exit(1);
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    console.error("File not found:", absPath);
    process.exit(1);
  }

  console.log("Reading backup from:", absPath);
  if (dryRun) console.log("DRY RUN – no database writes.");
  if (clearFirst && !dryRun) console.log("Will clear existing signatures before import.");
  const mapPath = path.join(path.dirname(absPath), path.basename(absPath, ".json") + ".user-to-client-map.json");
  let backupUserIdToClientId = null;
  if (fs.existsSync(mapPath)) {
    try {
      backupUserIdToClientId = JSON.parse(fs.readFileSync(mapPath, "utf8"));
      console.log("Using mapping from", mapPath, "(" + Object.keys(backupUserIdToClientId || {}).length, "entries)");
    } catch (e) {
      console.warn("Could not load mapping:", e.message);
    }
  }
  const raw = fs.readFileSync(absPath, "utf8");
  let backup;
  try {
    backup = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON:", e.message);
    process.exit(1);
  }

  const allUsers = Array.isArray(backup.users) ? backup.users : [];
  const allSignatures = Array.isArray(backup.signatures) ? backup.signatures : [];
  const signatures = limit != null ? allSignatures.slice(0, limit) : allSignatures;
  const userById = new Map(allUsers.map((u) => [u.id, u]));

  console.log("Backup: users:", allUsers.length, "| total signatures:", allSignatures.length);
  if (limit != null) console.log("Processing first", limit, "signatures (--limit).");

  if (signatures.length === 0) {
    console.error("No signatures in backup.");
    process.exit(1);
  }

  if (dryRun) {
    const userIds = new Set(signatures.map((s) => s.userId));
    console.log("Signatures reference", userIds.size, "unique userIds. Run without --dry-run to import.");
    return;
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  (async () => {
    if (clearFirst) {
      console.log("\n--- Clearing signatures ---");
      const { error: clearErr } = await supabase.from("signatures").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (clearErr) {
        console.error("Clear signatures error:", clearErr.message);
        process.exit(1);
      }
      console.log("  Cleared.\n");
    }

    // Fetch ALL clients (paginate to avoid 1000-row limit)
    let clientList = [];
    let from = 0;
    while (true) {
      const { data: chunk, error: fetchErr } = await supabase
        .from("clients")
        .select("id, client_id_external, first_name, last_name, full_name")
        .range(from, from + 999);
      if (fetchErr) {
        console.error("Failed to fetch clients:", fetchErr.message);
        throw fetchErr;
      }
      if (!chunk?.length) break;
      clientList = clientList.concat(chunk);
      if (chunk.length < 1000) break;
      from += 1000;
    }
    console.log("Supabase clients loaded:", clientList.length);
    const withExt = clientList.filter((c) => c.client_id_external).length;
    console.log("  with client_id_external:", withExt);

    function norm(s) {
      return (s || "").toString().trim().replace(/\s+/g, " ").toLowerCase();
    }
    function normName(first, last) {
      return [first, last].filter(Boolean).map(norm).join(" ").trim();
    }

    // Build lookup: (client_id_external, normalized_name) -> client (for 1:1 matching of duplicates)
    const clientsById = new Map(clientList.map((c) => [String(c.id || "").toLowerCase(), c]));
    const byExternal = new Map();
    const byExternalAndName = new Map(); // (ext, normName) -> client
    for (const c of clientList) {
      if (!c.client_id_external) continue;
      const ext = String(c.client_id_external).trim().toLowerCase();
      if (!byExternal.has(ext)) byExternal.set(ext, []);
      byExternal.get(ext).push(c);
      const nFirst = norm(c.first_name);
      const nLast = norm(c.last_name);
      const nFull = norm(c.full_name);
      const keys = [
        normName(nFirst, nLast),
        normName(nLast, nFirst),
        nFull,
        [nLast, nFirst].filter(Boolean).join(", "),
      ].filter(Boolean);
      for (const k of keys) {
        const key = ext + "\0" + k;
        if (!byExternalAndName.has(key)) byExternalAndName.set(key, c);
      }
    }

    // Resolve backup userId -> Supabase client_id (1:1 so each user maps to their exact client)
    function resolveClientId(backupUserId) {
      // Use canonical mapping from import-all-clients if available (gets all 763)
      if (backupUserIdToClientId) {
        const cid = backupUserIdToClientId[String(backupUserId)];
        if (cid) return cid;
      }
      const u = userById.get(backupUserId);
      if (!u) return null;
      const raw = u.clientId && /^[0-9a-f-]{36}$/i.test(u.clientId) ? u.clientId : null;
      if (!raw) return null;
      const backupClientId = String(raw).trim().toLowerCase();
      const first = (u.first && String(u.first).trim()) || "";
      const last = (u.last && String(u.last).trim()) || "";

      // 1) Client whose id IS the backup clientId (primary user for that UUID)
      if (clientsById.has(backupClientId)) return clientsById.get(backupClientId).id;

      // 2) For duplicates: match by client_id_external + name (try multiple formats)
      const nFirst = norm(first);
      const nLast = norm(last);
      const backupKeys = [
        normName(first, last),
        normName(last, first),
        [last, first].filter(Boolean).join(", "),
      ].filter(Boolean);
      for (const k of backupKeys) {
        const key = backupClientId + "\0" + k;
        const c = byExternalAndName.get(key);
        if (c) return c.id;
      }

      // 3) Fallback: exact first+last match among candidates
      const candidates = byExternal.get(backupClientId) || [];
      const firstLower = nFirst || first.toLowerCase();
      const lastLower = nLast || last.toLowerCase();
      let match = candidates.find(
        (c) =>
          norm(c.first_name) === firstLower &&
          norm(c.last_name) === lastLower
      );
      if (match) return match.id;
      const fullBackup = [first, last].filter(Boolean).join(" ").trim().toLowerCase();
      if (fullBackup) {
        match = candidates.find((c) => norm(c.full_name) === fullBackup);
        if (match) return match.id;
      }
      if (candidates.length === 1) return candidates[0].id;
      return null; // Do NOT fall back to candidates[0] when multiple - that collapses users
    }

    const resolvedUsers = new Set();
    for (const s of signatures) {
      const cid = resolveClientId(s.userId);
      if (cid) resolvedUsers.add(cid);
    }
    console.log("Resolved to", resolvedUsers.size, "distinct Supabase clients (of", signatures.length, "signature records).");

    const noClient = new Set();
    const writtenClientIds = new Set();
    let stats = { ok: 0, fail: 0, skipped: 0 };

    // Build rows to insert (skip those with no client). Dedupe by (client_id, slot)
    // so a single batch never has two rows targeting the same row (Postgres error).
    const byKey = new Map(); // key = client_id + "|" + slot -> row
    for (const s of signatures) {
      const clientId = resolveClientId(s.userId);
      if (!clientId) {
        noClient.add(s.userId);
        stats.skipped++;
        continue;
      }
      const slot = Number(s.slot) || 0;
      const key = clientId + "|" + slot;
      byKey.set(key, {
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
    const rowsToInsert = [...byKey.values()];

    console.log("--- Importing signatures (batch size", BATCH_SIZE + ", total:", rowsToInsert.length, ") ---");
    for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
      const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("signatures").upsert(batch, { onConflict: "client_id,slot" });
      if (error) {
        console.error("Signature upsert error (batch", Math.floor(i / BATCH_SIZE) + 1 + "):", error.message);
        stats.fail += batch.length;
      } else {
        stats.ok += batch.length;
        batch.forEach((r) => writtenClientIds.add(r.client_id));
        console.log("  Imported signatures", i + 1, "–", i + batch.length, "of", rowsToInsert.length);
      }
    }

    if (noClient.size > 0) {
      console.log("\nSkipped", stats.skipped, "signatures (no matching client for backup userIds):", [...noClient].slice(0, 20).join(", ") + (noClient.size > 20 ? "…" : ""));
    }
    console.log("--- Signatures done:", stats.ok, "ok,", stats.fail, "failed,", stats.skipped, "skipped (no client) ---");
    console.log("Distinct clients that now have signatures:", writtenClientIds.size);
    console.log("Done.");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
