/**
 * Import all signatures from backup JSON into Supabase.
 * Maps each backup USER (userId) to the correct Supabase client so signatures
 * don't collapse onto the same client. Uses client_id_external + first/last name
 * to resolve duplicates (backup has 790 users but only 690 unique clientIds).
 *
 * Backup has 3828 signatures across 766 users. Clients must already exist in DB
 * (from a prior run of import-five-clients.js --clear --all or equivalent).
 *
 * Usage:
 *   node scripts/import-signatures-from-backup.js [options] <path-to-backup.json>
 *
 * Options:
 *   --dry-run    Log counts and mapping only; no DB writes.
 *   --limit N    Only process first N signatures (for testing).
 *   --clear      Delete all existing signatures before importing (use when re-importing with fixed mapping).
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

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

    // Fetch all existing clients (need name to resolve duplicate clientIds)
    const { data: clients, error: fetchErr } = await supabase
      .from("clients")
      .select("id, client_id_external, first_name, last_name, full_name");
    if (fetchErr) {
      console.error("Failed to fetch clients:", fetchErr.message);
      process.exit(1);
    }
    const clientList = clients || [];
    console.log("Supabase clients loaded:", clientList.length);
    const withExt = clientList.filter((c) => c.client_id_external).length;
    console.log("  with client_id_external:", withExt);
    // Normalize UUIDs to lowercase for reliable lookup (Postgres may return different case)
    const clientsById = new Map(clientList.map((c) => [c.id ? String(c.id).toLowerCase() : "", c]));
    const byExternal = new Map();
    for (const c of clientList) {
      if (!c.client_id_external) continue;
      const ext = String(c.client_id_external).trim().toLowerCase();
      if (!byExternal.has(ext)) byExternal.set(ext, []);
      byExternal.get(ext).push(c);
    }

    // Resolve backup userId -> Supabase client_id (1:1 so each user's sigs go to the right client)
    function resolveClientId(backupUserId) {
      const u = userById.get(backupUserId);
      if (!u) return null;
      const raw = u.clientId && /^[0-9a-f-]{36}$/i.test(u.clientId) ? u.clientId : null;
      if (!raw) return null;
      const backupClientId = String(raw).trim().toLowerCase();
      const first = (u.first && String(u.first).trim()) || "";
      const last = (u.last && String(u.last).trim()) || "";
      // 1) Client whose id IS the backup clientId (the one who "won" that UUID during import)
      if (clientsById.has(backupClientId)) return clientsById.get(backupClientId).id;
      // 2) Among clients with this client_id_external, pick the one that matches this user's name (case-insensitive)
      const candidates = byExternal.get(backupClientId) || [];
      const firstLower = first.toLowerCase();
      const lastLower = last.toLowerCase();
      const fullBackup = [first, last].filter(Boolean).join(" ").trim().toLowerCase();
      let nameMatch = candidates.find(
        (c) =>
          ((c.first_name || "").trim().toLowerCase() === firstLower) &&
          ((c.last_name || "").trim().toLowerCase() === lastLower)
      );
      if (!nameMatch && fullBackup)
        nameMatch = candidates.find(
          (c) => (c.full_name || "").trim().toLowerCase() === fullBackup
        );
      if (nameMatch) return nameMatch.id;
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length > 1) return candidates[0].id; // fallback: first
      return null;
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

    console.log("--- Importing signatures (total:", signatures.length, ") ---");
    for (let i = 0; i < signatures.length; i++) {
      const s = signatures[i];
      const clientId = resolveClientId(s.userId);
      if (!clientId) {
        noClient.add(s.userId);
        stats.skipped++;
        continue;
      }
      const name = userName(userById.get(s.userId));
      const row = {
        id: randomUUID(),
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
        console.error("Signature upsert error:", error.message, "userId:", s.userId, "slot:", s.slot);
        stats.fail++;
        continue;
      }
      stats.ok++;
      writtenClientIds.add(clientId);
      // Progress: first 10, then every 100, then final
      if (stats.ok <= 10 || stats.ok % 100 === 0 || i === signatures.length - 1) {
        console.log("  ", stats.ok, "/", signatures.length, "—", name, "(slot", s.slot + ")");
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
