/**
 * Copy rows from backup Supabase `produce_vendors` into the main project (dietcombo .env.local).
 *
 * Setup:
 *   1. Create backup/.env from backup/env.example with BACKUP_SUPABASE_URL + BACKUP_SUPABASE_ANON_KEY
 *      (use the backup project's credentials — anon works if RLS allows select on produce_vendors).
 *   2. Root .env.local must have NEXT_PUBLIC_SUPABASE_URL + a write-capable key (SUPABASE_SECRET_KEY recommended).
 *
 * Usage (from repo root):
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/import-produce-vendors-from-backup.ts
 *   npx ts-node ... scripts/import-produce-vendors-from-backup.ts --dry-run
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";

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
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim() ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !key) {
        console.error("Target: set NEXT_PUBLIC_SUPABASE_URL and a server/write key in .env.local");
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
        console.error(
            "Backup: set BACKUP_SUPABASE_URL and BACKUP_SUPABASE_ANON_KEY (or service role) in backup/.env"
        );
        process.exit(1);
    }
    return { url, key };
}

type ProduceVendorRow = {
    id: string;
    name: string;
    token: string;
    is_active: boolean;
    created_at?: string | null;
};

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    loadEnvLayers();

    const backupCfg = pickBackupClient();
    const targetCfg = pickTargetClient();

    const src = createClient(backupCfg.url, backupCfg.key, { auth: { persistSession: false } });
    const dst = createClient(targetCfg.url, targetCfg.key, { auth: { persistSession: false } });

    console.log("Source (backup):", backupCfg.url);
    console.log("Target (dietcombo):", targetCfg.url);
    console.log(dryRun ? "DRY RUN — no writes\n" : "LIVE — will upsert into produce_vendors\n");

    const { data: rows, error: fetchErr } = await src.from("produce_vendors").select("*").order("name");
    if (fetchErr) {
        console.error("Failed to read backup produce_vendors:", fetchErr.message);
        process.exit(1);
    }

    const list = (rows || []) as ProduceVendorRow[];
    console.log(`Backup rows: ${list.length}`);
    if (list.length === 0) {
        console.log("Nothing to import.");
        process.exit(0);
    }

    for (const r of list) {
        console.log(`  - ${r.name} | id=${r.id} | active=${r.is_active}`);
    }

    if (dryRun) {
        console.log("\nDry run complete.");
        process.exit(0);
    }

    const payload = list.map((r) => ({
        id: r.id,
        name: r.name,
        token: r.token,
        is_active: r.is_active ?? true,
        ...(r.created_at ? { created_at: r.created_at } : {}),
    }));

    const { error: upsertErr } = await dst.from("produce_vendors").upsert(payload, {
        onConflict: "id",
        ignoreDuplicates: false,
    });

    if (upsertErr) {
        console.error("Upsert failed:", upsertErr.message);
        if (upsertErr.message.includes("duplicate key") || upsertErr.code === "23505") {
            console.error(
                "Hint: token must be UNIQUE. If a token already exists on another row, delete/rename the conflicting row in target or backup."
            );
        }
        process.exit(1);
    }

    console.log(`\nUpserted ${payload.length} produce vendor(s) into target.`);

    const { count } = await dst.from("produce_vendors").select("*", { count: "exact", head: true });
    console.log(`Target produce_vendors row count (approx): ${count ?? "?"}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
