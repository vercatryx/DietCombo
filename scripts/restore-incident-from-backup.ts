/**
 * Restore incident damage from backup Supabase while preserving main DB changes after a cutoff time.
 *
 * - DDL (requires DATABASE_URL — Supabase direct Postgres): recreate sms_conversations, sms_outbound_log,
 *   sms_bot_inbound_blocks, call_events if missing; disable RLS; grants; NOTIFY pgrst reload.
 * - Data: copy rows from backup → main for those tables (insert/upsert; skip duplicates).
 * - clients: merge do_not_text, do_not_text_numbers, do_not_text_reason, produce_vendor_id from backup
 *   ONLY when main.clients.updated_at < RESTORE_CUTOFF_ISO (preserves edits made on site after cutoff).
 * - admins: delete rogue seeded row ROGUE_ADMIN_ID (default admin-demo-uuid-001).
 *
 * DDL SSL: If `self-signed certificate in certificate chain` when connecting with `pg`, run once with
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 (local restore only), or fix DATABASE_URL SSL settings for your pooler.
 *
 * Env:
 *   DATABASE_URL — Postgres connection string (.env.local) for DDL
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (or service role) — main writes via PostgREST
 *   BACKUP_SUPABASE_URL + BACKUP_SUPABASE_ANON_KEY — backup reads (backup/.env or env)
 *
 * Cutoff default: 2026-05-07T21:00:00.000Z (= 5:00 PM America/New_York on May 7, 2026, EDT).
 * Override: RESTORE_CUTOFF_ISO=2026-05-07T21:00:00.000Z
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/restore-incident-from-backup.ts --dry-run
 *   npx ts-node ... scripts/restore-incident-from-backup.ts --apply
 *
 * Flags: --dry-run | --apply | --skip-ddl | --skip-sms-data | --skip-clients | --skip-delete-admin
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";
import pg from "pg";

function parseEnvFile(filePath: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!fs.existsSync(filePath)) return out;
    const envFile = fs.readFileSync(filePath, "utf8");
    for (const line of envFile.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function mergeIntoProcessEnv(vars: Record<string, string>) {
    for (const [k, v] of Object.entries(vars)) {
        if (process.env[k] === undefined) process.env[k] = v;
    }
}

function loadEnvLayers() {
    const root = process.cwd();
    mergeIntoProcessEnv(parseEnvFile(path.join(root, ".env.local")));
    mergeIntoProcessEnv(parseEnvFile(path.join(root, "backup", ".env")));
}

function pickTargetClient(): { url: string; key: string } {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key =
        process.env.SUPABASE_SECRET_KEY?.trim() ||
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
    if (!url || !key) {
        console.error("Main: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
        process.exit(1);
    }
    return { url, key };
}

function pickBackupClient(): { url: string; key: string } {
    const url =
        process.env.BACKUP_SUPABASE_URL?.trim() ||
        process.env.BACKUP_NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key =
        process.env.BACKUP_SUPABASE_ANON_KEY?.trim() ||
        process.env.BACKUP_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        process.env.BACKUP_NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !key) {
        console.error("Backup: set BACKUP_SUPABASE_URL + BACKUP_SUPABASE_ANON_KEY (backup/.env or env)");
        process.exit(1);
    }
    return { url, key };
}

const ROGUE_ADMIN_ID = process.env.ROGUE_ADMIN_ID?.trim() || "admin-demo-uuid-001";

/** Default: May 7, 2026 5:00 PM Eastern Daylight Time → UTC */
const DEFAULT_CUTOFF_ISO = "2026-05-07T21:00:00.000Z";

async function runSqlFiles(pgClient: pg.Client, relativePaths: string[]) {
    const root = process.cwd();
    for (const rel of relativePaths) {
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) {
            console.warn("Missing SQL file, skip:", full);
            continue;
        }
        const sql = fs.readFileSync(full, "utf8");
        console.log("Executing:", rel);
        await pgClient.query(sql);
    }
}

async function fetchAllRows<T extends Record<string, unknown>>(
    sb: SupabaseClient,
    table: string,
    select: string,
    orderColumn = "id"
): Promise<T[]> {
    const pageSize = 1000;
    let from = 0;
    const out: T[] = [];
    while (true) {
        const { data, error } = await sb
            .from(table)
            .select(select)
            .order(orderColumn as "id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        const batch = ((data || []) as unknown) as T[];
        out.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

/** sms_conversations may not have sequential id — order by created_at for stability */
async function fetchSmsConversations(sb: SupabaseClient): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    let from = 0;
    const out: Record<string, unknown>[] = [];
    while (true) {
        const { data, error } = await sb
            .from("sms_conversations")
            .select("*")
            .order("created_at", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`sms_conversations: ${error.message}`);
        const batch = data || [];
        out.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

async function fetchSmsOutbound(sb: SupabaseClient): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    let from = 0;
    const out: Record<string, unknown>[] = [];
    while (true) {
        const { data, error } = await sb
            .from("sms_outbound_log")
            .select("*")
            .order("created_at", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`sms_outbound_log: ${error.message}`);
        const batch = data || [];
        out.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

async function insertBatches(
    dst: SupabaseClient,
    table: string,
    rows: Record<string, unknown>[],
    dryRun: boolean,
    batchSize = 200,
    onConflict: "id" | "phone_e164" = "id"
): Promise<{ inserted: number; errors: number }> {
    let inserted = 0;
    let errors = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        if (dryRun) {
            inserted += batch.length;
            continue;
        }
        const { error } = await dst.from(table).upsert(batch, { onConflict });
        if (error) {
            console.error(`  ${table} batch ${i / batchSize + 1}:`, error.message);
            errors += batch.length;
        } else inserted += batch.length;
    }
    return { inserted, errors };
}

async function fetchMainClientsUpdatedAt(main: SupabaseClient): Promise<Map<string, string>> {
    const pageSize = 1000;
    let from = 0;
    const map = new Map<string, string>();
    while (true) {
        const { data, error } = await main
            .from("clients")
            .select("id, updated_at")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data || [];
        for (const r of batch as { id: string; updated_at: string }[]) {
            map.set(r.id, r.updated_at);
        }
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return map;
}

async function fetchBackupClientMergeFields(backup: SupabaseClient): Promise<
    Map<
        string,
        {
            do_not_text: boolean | null;
            do_not_text_numbers: unknown;
            do_not_text_reason: string | null;
            produce_vendor_id: string | null;
        }
    >
> {
    const pageSize = 1000;
    let from = 0;
    const map = new Map<
        string,
        {
            do_not_text: boolean | null;
            do_not_text_numbers: unknown;
            do_not_text_reason: string | null;
            produce_vendor_id: string | null;
        }
    >();
    while (true) {
        const { data, error } = await backup
            .from("clients")
            .select("id, do_not_text, do_not_text_numbers, do_not_text_reason, produce_vendor_id")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = (data || []) as {
            id: string;
            do_not_text: boolean | null;
            do_not_text_numbers: unknown;
            do_not_text_reason: string | null;
            produce_vendor_id: string | null;
        }[];
        for (const r of batch) {
            map.set(r.id, {
                do_not_text: r.do_not_text ?? null,
                do_not_text_numbers: r.do_not_text_numbers ?? {},
                do_not_text_reason: r.do_not_text_reason ?? null,
                produce_vendor_id: r.produce_vendor_id ?? null,
            });
        }
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return map;
}

async function main() {
    const dryRun = !process.argv.includes("--apply");
    const skipDdl = process.argv.includes("--skip-ddl");
    const skipSmsData = process.argv.includes("--skip-sms-data");
    const skipClients = process.argv.includes("--skip-clients");
    const skipDeleteAdmin = process.argv.includes("--skip-delete-admin");

    const cutoffIso = process.env.RESTORE_CUTOFF_ISO?.trim() || DEFAULT_CUTOFF_ISO;
    const cutoffMs = new Date(cutoffIso).getTime();
    if (Number.isNaN(cutoffMs)) {
        console.error("Invalid RESTORE_CUTOFF_ISO / date:", cutoffIso);
        process.exit(1);
    }

    loadEnvLayers();

    console.log("\n=== Restore incident from backup ===");
    console.log(dryRun ? "MODE: dry-run (no writes)" : "MODE: APPLY");
    console.log("Cutoff (main.clients.updated_at >= this → skip merge):", cutoffIso);
    console.log("  (= edits on main at or after this instant are preserved)\n");

    const targetCfg = pickTargetClient();
    const backupCfg = pickBackupClient();
    const main = createClient(targetCfg.url, targetCfg.key, { auth: { persistSession: false } });
    const backup = createClient(backupCfg.url, backupCfg.key, { auth: { persistSession: false } });

    console.log("Main:", targetCfg.url);
    console.log("Backup:", backupCfg.url);

    // ---------- DDL ----------
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!skipDdl && !databaseUrl) {
        console.error("DATABASE_URL missing — cannot run DDL. Use --skip-ddl if tables already exist.");
        process.exit(1);
    }

    if (!skipDdl && databaseUrl) {
        if (dryRun) {
            console.log("\n[DDL] Would run SQL files + RLS disable + grants + NOTIFY pgrst (DATABASE_URL set)");
        } else {
            const pgClient = new pg.Client({
                connectionString: databaseUrl,
                // Supabase pooler uses a chain Node may not trust without explicit opt-out
                ssl:
                    databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
                        ? undefined
                        : { rejectUnauthorized: false },
            });
            await pgClient.connect();
            try {
                await runSqlFiles(pgClient, [
                    "sql/create_sms_conversations_table.sql",
                    "sql/create_sms_outbound_log.sql",
                    "sql/sms_bot_inbound_blocks.sql",
                    "sql/create_call_events_table.sql",
                ]);
                await pgClient.query(`
                    ALTER TABLE IF EXISTS sms_conversations DISABLE ROW LEVEL SECURITY;
                    ALTER TABLE IF EXISTS sms_outbound_log DISABLE ROW LEVEL SECURITY;
                    ALTER TABLE IF EXISTS sms_bot_inbound_blocks DISABLE ROW LEVEL SECURITY;
                    ALTER TABLE IF EXISTS call_events DISABLE ROW LEVEL SECURITY;
                `);
                await pgClient.query(`
                    GRANT ALL ON TABLE sms_conversations TO postgres, anon, authenticated, service_role;
                    GRANT ALL ON TABLE sms_outbound_log TO postgres, anon, authenticated, service_role;
                    GRANT ALL ON TABLE sms_bot_inbound_blocks TO postgres, anon, authenticated, service_role;
                    GRANT ALL ON TABLE call_events TO postgres, anon, authenticated, service_role;
                `);
                await pgClient.query(`NOTIFY pgrst, 'reload schema';`);
                console.log("[DDL] Done + schema reload notified.");
            } finally {
                await pgClient.end();
            }
        }
    } else if (skipDdl) {
        console.log("\n[DDL] Skipped (--skip-ddl)");
    }

    // ---------- SMS / call data ----------
    if (!skipSmsData) {
        console.log("\n[SMS/call data] Reading backup…");
        let blocks: Record<string, unknown>[] = [];
        let outbound: Record<string, unknown>[] = [];
        let conversations: Record<string, unknown>[] = [];
        let callEvents: Record<string, unknown>[] = [];

        try {
            blocks = await fetchAllRows(backup, "sms_bot_inbound_blocks", "*", "phone_e164");
        } catch (e: unknown) {
            console.warn("  sms_bot_inbound_blocks backup:", (e as Error).message);
        }
        try {
            outbound = await fetchSmsOutbound(backup);
        } catch (e: unknown) {
            console.warn("  sms_outbound_log backup:", (e as Error).message);
        }
        try {
            conversations = await fetchSmsConversations(backup);
        } catch (e: unknown) {
            console.warn("  sms_conversations backup:", (e as Error).message);
        }
        try {
            callEvents = await fetchAllRows(backup, "call_events", "*");
        } catch (e: unknown) {
            console.warn("  call_events backup:", (e as Error).message);
        }

        console.log(
            `  Backup counts: blocks=${blocks.length}, outbound=${outbound.length}, conversations=${conversations.length}, call_events=${callEvents.length}`
        );

        if (dryRun) {
            console.log("[SMS/call data] Dry-run: would upsert these rows into main.");
        } else {
            if (blocks.length) {
                const r = await insertBatches(main, "sms_bot_inbound_blocks", blocks, dryRun, 100, "phone_e164");
                console.log(`  sms_bot_inbound_blocks upserted ~ ${r.inserted} errors=${r.errors}`);
            }
            if (outbound.length) {
                const r = await insertBatches(main, "sms_outbound_log", outbound, dryRun, 150, "id");
                console.log(`  sms_outbound_log upserted ~ ${r.inserted} errors=${r.errors}`);
            }
            if (conversations.length) {
                const r = await insertBatches(main, "sms_conversations", conversations, dryRun, 150, "id");
                console.log(`  sms_conversations upserted ~ ${r.inserted} errors=${r.errors}`);
            }
            if (callEvents.length) {
                const r = await insertBatches(main, "call_events", callEvents, dryRun, 150, "id");
                console.log(`  call_events upserted ~ ${r.inserted} errors=${r.errors}`);
            }
        }
    } else {
        console.log("\n[SMS/call data] Skipped (--skip-sms-data)");
    }

    // ---------- Clients merge ----------
    if (!skipClients) {
        console.log("\n[clients] Loading backup merge fields + main updated_at…");
        const backupMap = await fetchBackupClientMergeFields(backup);
        const mainUpdated = await fetchMainClientsUpdatedAt(main);
        let wouldMerge = 0;
        let skippedRecent = 0;
        let missingOnMain = 0;

        const patchBatch: {
            id: string;
            do_not_text: boolean | null;
            do_not_text_numbers: unknown;
            do_not_text_reason: string | null;
            produce_vendor_id: string | null;
        }[] = [];

        for (const [id, b] of backupMap) {
            const upd = mainUpdated.get(id);
            if (!upd) {
                missingOnMain++;
                continue;
            }
            const mainTime = new Date(upd).getTime();
            if (mainTime >= cutoffMs) {
                skippedRecent++;
                continue;
            }
            wouldMerge++;
            patchBatch.push({
                id,
                do_not_text: b.do_not_text,
                do_not_text_numbers: b.do_not_text_numbers,
                do_not_text_reason: b.do_not_text_reason,
                produce_vendor_id: b.produce_vendor_id,
            });
        }

        console.log(`  Clients on main: ${mainUpdated.size}`);
        console.log(`  Would merge from backup (updated_at < cutoff): ${wouldMerge}`);
        console.log(`  Skip (main.updated_at >= cutoff, preserve recent edits): ${skippedRecent}`);
        console.log(`  Backup ids not on main: ${missingOnMain}`);

        if (dryRun) {
            console.log("[clients] Dry-run: no updates.");
        } else {
            const chunk = 50;
            let ok = 0;
            for (let i = 0; i < patchBatch.length; i += chunk) {
                const slice = patchBatch.slice(i, i + chunk);
                for (const row of slice) {
                    const { error } = await main
                        .from("clients")
                        .update({
                            do_not_text: row.do_not_text,
                            do_not_text_numbers: row.do_not_text_numbers,
                            do_not_text_reason: row.do_not_text_reason,
                            produce_vendor_id: row.produce_vendor_id,
                        })
                        .eq("id", row.id);
                    if (error) {
                        console.error(`  Failed ${row.id}:`, error.message);
                    } else ok++;
                }
            }
            console.log(`[clients] Updated ${ok} rows.`);
        }
    } else {
        console.log("\n[clients] Skipped (--skip-clients)");
    }

    // ---------- Rogue admin ----------
    if (!skipDeleteAdmin) {
        if (dryRun) {
            console.log(`\n[admins] Dry-run: would delete id=${ROGUE_ADMIN_ID} if present.`);
        } else {
            const { data: rogue, error: selErr } = await main
                .from("admins")
                .select("id, username")
                .eq("id", ROGUE_ADMIN_ID)
                .maybeSingle();
            if (selErr) console.warn("[admins] select:", selErr.message);
            else if (rogue) {
                const { error: delErr } = await main.from("admins").delete().eq("id", ROGUE_ADMIN_ID);
                console.log(delErr ? `[admins] Delete failed: ${delErr.message}` : `[admins] Deleted rogue row ${ROGUE_ADMIN_ID}`);
            } else {
                console.log("[admins] Rogue row not found (already removed).");
            }
        }
    }

    console.log("\n=== Done ===\n");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
