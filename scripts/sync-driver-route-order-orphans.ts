/**
 * Optional safety job: remove driver_route_order rows where the client is no longer
 * assigned to that driver (e.g. client was reassigned or unassigned elsewhere).
 *
 * Plan (Phase 6.3): DELETE FROM driver_route_order WHERE (driver_id, client_id)
 * NOT IN (SELECT assigned_driver_id, id FROM clients WHERE assigned_driver_id IS NOT NULL).
 * Run rarely (e.g. nightly) or after bulk reassigns.
 *
 * Usage: npx tsx scripts/sync-driver-route-order-orphans.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: orderRows } = await supabase
        .from("driver_route_order")
        .select("driver_id, client_id");
    const { data: clients } = await supabase
        .from("clients")
        .select("id, assigned_driver_id")
        .not("assigned_driver_id", "is", null);

    const valid = new Set<string>();
    for (const c of clients || []) {
        valid.add(`${c.assigned_driver_id}|${c.id}`);
    }
    const toDelete = (orderRows || []).filter(
        (r) => !valid.has(`${r.driver_id}|${r.client_id}`)
    );
    if (toDelete.length === 0) {
        console.log("No orphan driver_route_order rows to remove.");
        return;
    }
    for (const r of toDelete) {
        await supabase
            .from("driver_route_order")
            .delete()
            .eq("driver_id", r.driver_id)
            .eq("client_id", r.client_id);
    }
    console.log(`Removed ${toDelete.length} orphan driver_route_order row(s).`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
