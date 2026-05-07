/**
 * Read-only health report: tables/columns the app expects vs what exists in Supabase,
 * plus row counts that explain empty UI (produce vendors, routes RPC, etc.).
 *
 * Usage (from project root):
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-database-health.ts
 *
 * Loads .env.local into process.env (same pattern as other scripts).
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";

function loadEnvLocal(): void {
    const envPath = path.resolve(process.cwd(), ".env.local");
    const envFile = fs.readFileSync(envPath, "utf8");
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
        if (!process.env[key]) process.env[key] = val;
    }
}

function pickKey(): { url: string; key: string; label: string } {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
    const legacyService = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const legacyAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const key = secret || publishable || legacyService || legacyAnon;
    let label = "unknown";
    if (secret) label = "SUPABASE_SECRET_KEY";
    else if (publishable) label = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY";
    else if (legacyService) label = "SUPABASE_SERVICE_ROLE_KEY";
    else if (legacyAnon) label = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
    if (!url || !key) {
        console.error("Missing NEXT_PUBLIC_SUPABASE_URL or a DB API key in .env.local");
        process.exit(1);
    }
    return { url, key, label };
}

async function safeHead(sb: any, table: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

async function main() {
    loadEnvLocal();
    const { url, key, label } = pickKey();
    const sb = createClient(url, key, { auth: { persistSession: false } });

    console.log("\n========== DietCombo DB health (read-only) ==========");
    console.log("Supabase URL:", url);
    console.log("API key source:", label, "(prefer secret/service_role for accurate counts under RLS)\n");

    const expectedTables = [
        "produce_vendors",
        "drivers",
        "routes",
        "clients",
        "stops",
        "orders",
        "driver_route_order",
        "client_statuses",
        "vendors",
    ];

    console.log("--- Table visibility (PostgREST select head) ---");
    for (const t of expectedTables) {
        const r = await safeHead(sb, t);
        console.log(r.ok ? `  OK   ${t}` : `  FAIL ${t}: ${r.error}`);
    }

    console.log("\n--- vendors vs produce_vendors (different tables) ---");
    const vHead = await safeHead(sb, "vendors");
    if (vHead.ok) {
        const { count: vCount } = await sb.from("vendors").select("*", { count: "exact", head: true });
        console.log(`  vendors (meal vendors): ${vCount ?? "?"} rows`);
    }
    console.log("  Produce dropdowns use ONLY produce_vendors, not vendors.");

    console.log("\n--- produce_vendors (what UI dropdowns use via getProduceVendors) ---");
    const pvHead = await safeHead(sb, "produce_vendors");
    if (pvHead.ok) {
        const { data: rows, error: pvErr } = await sb.from("produce_vendors").select("id, name, is_active, token").order("name");
        if (pvErr) {
            console.log("  ERROR selecting produce_vendors:", pvErr.message);
        } else {
            const list = rows || [];
            const active = list.filter((r: any) => r.is_active !== false);
            console.log(`  Total rows: ${list.length}`);
            console.log(`  is_active !== false: ${active.length} (extension API returns only these)`);
            console.log(`  Inactive hidden in UI: ${list.length - active.length}`);
            if (list.length > 0) {
                console.log("  Rows:");
                for (const r of list as any[]) {
                    console.log(
                        `    - ${r.name} | active=${r.is_active} | id=${r.id}`
                    );
                }
            } else {
                console.log("  ⚠ Empty table → every produce dropdown will be empty.");
            }
        }
    }

    console.log("\n--- clients.produce_vendor_id (FK to produce_vendors) ---");
    const { error: colErr } = await sb.from("clients").select("id, produce_vendor_id").limit(1);
    if (colErr) {
        console.log("  ⚠ Cannot read produce_vendor_id:", colErr.message);
    } else {
        const { count: withPv, error: e1 } = await sb
            .from("clients")
            .select("*", { count: "exact", head: true })
            .not("produce_vendor_id", "is", null);
        console.log(
            e1
                ? `  Could not count produce_vendor_id: ${e1.message}`
                : `  Clients with produce_vendor_id set: ${withPv ?? "?"}`
        );
    }

    console.log("\n--- get_routes_for_date RPC (routes/drivers pages) ---");
    const today = new Date().toISOString().slice(0, 10);
    const rpc = await sb.rpc("get_routes_for_date", {
        p_delivery_date: today,
        p_day: "all",
        p_exclude_produce: true,
    });
    if (rpc.error) {
        console.log("  ERROR:", rpc.error.message);
        if (rpc.error.message.includes("driver_route_order")) {
            console.log(
                "  Hint: create table public.driver_route_order (see sql/driver_route_order_migration.sql)."
            );
        }
    } else {
        const p = rpc.data as any;
        const routes = Array.isArray(p?.routes) ? p.routes : [];
        const unrouted = Array.isArray(p?.unrouted) ? p.unrouted : [];
        console.log(`  OK for date=${today}: routes buckets=${routes.length}, unrouted=${unrouted.length}`);
    }

    console.log("\n--- Browser cache note (produce vendor list) ---");
    console.log(
        "  Client-side cached-data.ts caches produce vendors for up to 24h in localStorage key dietcombo_cache_produce_vendors."
    );
    console.log(
        "  If DB is fixed but UI still shows old list: hard refresh or Application → Local Storage → delete that key."
    );

    console.log("\n========== end ==========\n");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
