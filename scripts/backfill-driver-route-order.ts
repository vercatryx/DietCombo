/**
 * One-time backfill for driver_route_order.
 * Run after applying sql/driver_route_order_migration.sql.
 *
 * For each driver (from drivers + routes tables), inserts rows for every client
 * with assigned_driver_id = that driver. Order is derived from drivers.stop_ids
 * (resolve stop id -> client_id from stops for a recent date) or from stops.order;
 * otherwise positions 1,2,3 by client_id.
 *
 * Usage: npm run backfill-driver-route-order
 * (Loads .env.local / .env from project root.)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("Backfilling driver_route_order...\n");

    const { data: driversRows } = await supabase.from("drivers").select("id, name, stop_ids").order("id", { ascending: true });
    const { data: routesRows } = await supabase.from("routes").select("id, name, stop_ids").order("id", { ascending: true });
    const drivers = [...(driversRows || []), ...(routesRows || []).map((r: any) => ({ ...r, id: r.id, name: r.name, stop_ids: r.stop_ids }))];

    if (drivers.length === 0) {
        console.log("No drivers or routes found. Exiting.");
        return;
    }

    const { data: allStops } = await supabase.from("stops").select("id, client_id, assigned_driver_id, delivery_date, order").not("client_id", "is", null);
    const stopById = new Map<string, { client_id: string; assigned_driver_id: string | null; delivery_date: string | null; order: number | null }>();
    for (const s of allStops || []) {
        stopById.set(String(s.id), {
            client_id: String(s.client_id),
            assigned_driver_id: s.assigned_driver_id ? String(s.assigned_driver_id) : null,
            delivery_date: s.delivery_date ? String(s.delivery_date).split("T")[0] : null,
            order: s.order != null ? Number(s.order) : null,
        });
    }

    let totalInserted = 0;
    for (const driver of drivers) {
        const driverId = String(driver.id);
        const { data: assignedClients } = await supabase
            .from("clients")
            .select("id")
            .eq("assigned_driver_id", driverId)
            .order("id", { ascending: true });
        const clientIds = (assignedClients || []).map((c: any) => String(c.id));
        if (clientIds.length === 0) continue;

        const existing = await supabase.from("driver_route_order").select("client_id").eq("driver_id", driverId);
        const existingSet = new Set((existing.data || []).map((r: any) => String(r.client_id)));

        let orderFromStopIds: string[] = [];
        const rawStopIds = driver.stop_ids;
        if (rawStopIds) {
            const ids = Array.isArray(rawStopIds) ? rawStopIds : (typeof rawStopIds === "string" ? JSON.parse(rawStopIds || "[]") : []);
            for (const stopId of ids) {
                const rec = stopById.get(String(stopId));
                if (rec && rec.assigned_driver_id === driverId && rec.client_id && !orderFromStopIds.includes(rec.client_id)) {
                    orderFromStopIds.push(rec.client_id);
                }
            }
        }

        const ordered: string[] = [];
        for (const cid of orderFromStopIds) {
            if (clientIds.includes(cid)) ordered.push(cid);
        }
        for (const cid of clientIds) {
            if (!ordered.includes(cid)) ordered.push(cid);
        }

        let inserted = 0;
        for (let i = 0; i < ordered.length; i++) {
            const clientId = ordered[i];
            if (existingSet.has(clientId)) continue;
            const position = i + 1;
            const { error } = await supabase.from("driver_route_order").insert({ driver_id: driverId, client_id: clientId, position });
            if (error) {
                if (error.code === "23505") continue;
                console.warn(`[${driver.name}] insert client ${clientId}:`, error.message);
                continue;
            }
            totalInserted++;
            inserted++;
        }
        if (ordered.length > 0) console.log(`  ${driver.name}: ${ordered.length} clients, ${inserted} new rows`);
    }

    console.log(`\nDone. Total new rows inserted: ${totalInserted}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
