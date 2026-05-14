/**
 * Restore clients.produce_vendor_id when Produce clients show generic "Produce" (null/orphan FK).
 *
 * Strategies:
 *   backup — copy produce_vendor_id from backup DB by matching clients.id (same UUID in both projects).
 *   audit  — parse order_history summaries (produceVendor / Produce (…) lines), newest-first.
 *   hybrid — backup first, then audit for clients still missing a valid vendor id.
 *
 * Setup: same as scripts/import-produce-vendors-from-backup.ts (root .env.local + backup/.env).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/restore-client-produce-vendors.ts --dry-run
 *   npx ts-node ... scripts/restore-client-produce-vendors.ts --strategy=hybrid --apply
 *
 * Flags:
 *   --dry-run          Report only (default if --apply omitted)
 *   --apply            Write updates to main clients table
 *   --strategy=…       backup | audit | hybrid (default: hybrid)
 *   --only-client=UUID Limit to one client
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";
import { isProduceServiceType } from "../lib/isProduceServiceType";

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

type ClientRow = {
    id: string;
    full_name: string | null;
    service_type: string | null;
    produce_vendor_id: string | null;
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeVendorToken(raw: string): string {
    return raw.trim();
}

function resolveVendorInputToId(
    token: string,
    vendorIds: Set<string>,
    nameToId: Map<string, string>
): string | null {
    const t = normalizeVendorToken(token);
    if (!t || /^unassigned$/i.test(t)) return null;
    if (UUID_RE.test(t) && vendorIds.has(t)) return t;
    const byName = nameToId.get(t.toLowerCase());
    return byName ?? null;
}

/** From one audit summary: best hint for vendor after this edit (single save batch). */
function parseVendorTokenFromSummary(summary: string): string | null {
    const lines = summary
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    let fromProduceLine: string | null = null;
    let fromServiceLine: string | null = null;

    for (const line of lines) {
        const pv = line.match(/^produceVendor:\s*"([^"]*)"\s*→\s*"([^"]*)"\s*$/);
        if (pv) fromProduceLine = pv[2];

        const st1 = line.match(/^serviceType:\s*"Food"\s*→\s*"Produce\s*\(([^)]+)\)"/);
        if (st1) fromServiceLine = st1[1];

        const st2 = line.match(
            /^serviceType:\s*"Produce\s*\(([^)]+)\)"\s*→\s*"Produce\s*\(([^)]+)\)"/
        );
        if (st2) fromServiceLine = st2[2];
    }
    if (fromProduceLine != null) return fromProduceLine;
    return fromServiceLine;
}

/** Newest audit rows first; first summary that yields a resolvable token wins. */
function vendorIdFromAuditHistory(
    rows: { summary: string; timestamp: string }[],
    vendorIds: Set<string>,
    nameToId: Map<string, string>
): string | null {
    const sorted = [...rows].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    for (const r of sorted) {
        const tok = parseVendorTokenFromSummary(r.summary);
        if (tok == null || tok === "") continue;
        const id = resolveVendorInputToId(tok, vendorIds, nameToId);
        if (id) return id;
    }
    return null;
}

function needsVendorFix(produceVendorId: string | null | undefined, validIds: Set<string>): boolean {
    if (produceVendorId == null || String(produceVendorId).trim() === "") return true;
    return !validIds.has(String(produceVendorId));
}

async function fetchAllClients(main: SupabaseClient, onlyId?: string): Promise<ClientRow[]> {
    const pageSize = 1000;
    let from = 0;
    const out: ClientRow[] = [];
    while (true) {
        let q = main
            .from("clients")
            .select("id, full_name, service_type, produce_vendor_id")
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1);
        if (onlyId) q = q.eq("id", onlyId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const batch = (data || []) as ClientRow[];
        out.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return out;
}

async function loadVendorMaps(main: SupabaseClient): Promise<{
    ids: Set<string>;
    nameToId: Map<string, string>;
}> {
    const { data, error } = await main.from("produce_vendors").select("id, name");
    if (error) throw new Error(error.message);
    const ids = new Set<string>();
    const nameToId = new Map<string, string>();
    for (const r of data || []) {
        const row = r as { id: string; name: string };
        ids.add(row.id);
        nameToId.set(String(row.name).trim().toLowerCase(), row.id);
    }
    return { ids, nameToId };
}

async function fetchBackupVendorIds(
    backup: SupabaseClient,
    clientIds: string[]
): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const chunk = 200;
    for (let i = 0; i < clientIds.length; i += chunk) {
        const slice = clientIds.slice(i, i + chunk);
        const { data, error } = await backup
            .from("clients")
            .select("id, produce_vendor_id")
            .in("id", slice);
        if (error) throw new Error(error.message);
        for (const r of data || []) {
            const row = r as { id: string; produce_vendor_id: string | null };
            map.set(row.id, row.produce_vendor_id ?? null);
        }
    }
    return map;
}

async function fetchAuditRowsForClients(
    main: SupabaseClient,
    clientIds: string[]
): Promise<Map<string, { summary: string; timestamp: string }[]>> {
    const byClient = new Map<string, { summary: string; timestamp: string }[]>();
    const chunk = 150;
    for (let i = 0; i < clientIds.length; i += chunk) {
        const slice = clientIds.slice(i, i + chunk);
        const { data, error } = await main
            .from("order_history")
            .select("client_id, summary, timestamp")
            .in("client_id", slice)
            .or("summary.ilike.%produceVendor%,summary.ilike.%Produce (%")
            .order("timestamp", { ascending: false });
        if (error) throw new Error(error.message);
        for (const r of data || []) {
            const row = r as { client_id: string; summary: string; timestamp: string };
            const cid = row.client_id;
            if (!byClient.has(cid)) byClient.set(cid, []);
            byClient.get(cid)!.push({ summary: row.summary, timestamp: row.timestamp });
        }
    }
    return byClient;
}

function argStrategy(): "backup" | "audit" | "hybrid" {
    const raw = process.argv.find((a) => a.startsWith("--strategy="))?.slice("--strategy=".length);
    if (raw === "backup" || raw === "audit" || raw === "hybrid") return raw;
    return "hybrid";
}

function argOnlyClient(): string | undefined {
    const raw = process.argv.find((a) => a.startsWith("--only-client="))?.slice("--only-client=".length);
    return raw?.trim() || undefined;
}

async function main() {
    const dryRun = !process.argv.includes("--apply");
    const strategy = argStrategy();
    const onlyClient = argOnlyClient();

    loadEnvLayers();
    const targetCfg = pickTargetClient();
    const main = createClient(targetCfg.url, targetCfg.key, { auth: { persistSession: false } });

    let backup: SupabaseClient | null = null;
    if (strategy === "backup" || strategy === "hybrid") {
        const b = pickBackupClient();
        backup = createClient(b.url, b.key, { auth: { persistSession: false } });
        console.log("Backup URL:", b.url);
    }

    console.log("Main URL:", targetCfg.url);
    console.log("Strategy:", strategy);
    console.log(dryRun ? "MODE: dry-run (no writes)\n" : "MODE: APPLY updates\n");

    const { ids: validVendorIds, nameToId } = await loadVendorMaps(main);
    console.log(`produce_vendors on main: ${validVendorIds.size} id(s)\n`);

    const allClients = await fetchAllClients(main, onlyClient);
    const produceClients = allClients.filter((c) => isProduceServiceType(c.service_type));

    type Planned = {
        id: string;
        name: string | null;
        from: string | null;
        to: string | null;
        source: "backup" | "audit";
    };
    const planned: Planned[] = [];

    const candidates = produceClients.filter((c) =>
        needsVendorFix(c.produce_vendor_id, validVendorIds)
    );

    if (strategy === "backup" || strategy === "hybrid") {
        const backupMap = await fetchBackupVendorIds(backup!, candidates.map((c) => c.id));
        for (const c of candidates) {
            const fromBackup = backupMap.get(c.id);
            if (fromBackup && validVendorIds.has(fromBackup)) {
                planned.push({
                    id: c.id,
                    name: c.full_name,
                    from: c.produce_vendor_id,
                    to: fromBackup,
                    source: "backup",
                });
            }
        }
    }

    let stillMissing = candidates.filter((c) => {
        const p = planned.find((x) => x.id === c.id);
        return !p;
    });

    if (strategy === "audit" || strategy === "hybrid") {
        const auditIds = stillMissing.map((c) => c.id);
        if (auditIds.length > 0) {
            const auditMap = await fetchAuditRowsForClients(main, auditIds);
            for (const c of stillMissing) {
                const rows = auditMap.get(c.id) || [];
                const vid = vendorIdFromAuditHistory(rows, validVendorIds, nameToId);
                if (vid) {
                    planned.push({
                        id: c.id,
                        name: c.full_name,
                        from: c.produce_vendor_id,
                        to: vid,
                        source: "audit",
                    });
                }
            }
        }
    }

    console.log(`Produce clients (total): ${produceClients.length}`);
    console.log(`Produce clients needing vendor id (null/orphan): ${candidates.length}`);
    console.log(`Planned fixes: ${planned.length}\n`);

    for (const p of planned) {
        console.log(
            `[${p.source}] ${p.name || "(no name)"} (${p.id})\n  produce_vendor_id: ${p.from ?? "NULL"} → ${p.to}`
        );
    }

    if (dryRun || planned.length === 0) {
        if (planned.length === 0 && candidates.length > 0) {
            console.log(
                "\nNo automatic fix found. Check: backup DB shares same client UUIDs as main; order_history contains produceVendor / Produce (…) lines."
            );
        }
        process.exit(0);
    }

    for (const p of planned) {
        const { error } = await main
            .from("clients")
            .update({ produce_vendor_id: p.to })
            .eq("id", p.id);
        if (error) {
            console.error(`FAILED ${p.id}:`, error.message);
            process.exit(1);
        }
    }

    console.log(`\nUpdated ${planned.length} client row(s).`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
