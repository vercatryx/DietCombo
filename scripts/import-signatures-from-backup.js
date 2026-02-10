/**
 * Import all signatures from backup JSON into Supabase.
 * Use this when the full backup import only brought in a subset of signatures
 * (e.g. 200 of 3828). This script maps backup userId -> existing client id
 * and upserts every signature (existing ones are updated by conflict, new ones inserted).
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
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
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
    console.error("Usage: node scripts/import-signatures-from-backup.js [--dry-run] [--limit N] <path-to-backup.json>");
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
    // Build backup userId -> backup clientId (UUID from backup user)
    const backupUserIdToClientId = new Map(
      allUsers.filter((u) => u.clientId && /^[0-9a-f-]{36}$/i.test(u.clientId)).map((u) => [u.id, u.clientId])
    );

    // Fetch all existing clients: id and client_id_external
    const { data: clients, error: fetchErr } = await supabase.from("clients").select("id, client_id_external");
    if (fetchErr) {
      console.error("Failed to fetch clients:", fetchErr.message);
      process.exit(1);
    }
    const clientsById = new Map((clients || []).map((c) => [c.id, c]));
    const clientIdByExternal = new Map(
      (clients || []).filter((c) => c.client_id_external).map((c) => [c.client_id_external, c.id])
    );

    // Resolve backup userId -> Supabase client_id
    function resolveClientId(backupUserId) {
      const backupClientId = backupUserIdToClientId.get(backupUserId);
      if (!backupClientId) return null;
      if (clientsById.has(backupClientId)) return backupClientId;
      return clientIdByExternal.get(backupClientId) || null;
    }

    const noClient = new Set();
    let stats = { ok: 0, fail: 0, skipped: 0 };

    console.log("--- Importing signatures ---");
    for (const s of signatures) {
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
      if (stats.ok <= 10 || stats.ok % 500 === 0) {
        console.log("  Imported signature for", name, "(slot", s.slot + ")", "— total ok:", stats.ok);
      }
    }

    if (noClient.size > 0) {
      console.log("\nSkipped", stats.skipped, "signatures (no matching client for backup userIds):", [...noClient].slice(0, 20).join(", ") + (noClient.size > 20 ? "…" : ""));
    }
    console.log("--- Signatures done:", stats.ok, "ok,", stats.fail, "failed,", stats.skipped, "skipped (no client) ---");
    console.log("Done.");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
