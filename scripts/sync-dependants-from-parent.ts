/**
 * Copies parent's assigned_driver_id and geocoding (lat, lng, geocoded_at) to dependants
 * when the dependant doesn't already have their own.
 *
 * - Driver: only copied if dependant's assigned_driver_id is null or empty.
 * - Geocoding: only copied if dependant is missing valid lat/lng (either null or not finite).
 *
 * Usage: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/sync-dependants-from-parent.ts
 * Or: npm run sync-dependants-from-parent
 * Add --dry-run to only print what would be updated (no DB writes).
 */

import dotenv from "dotenv";

const DRY_RUN = process.argv.includes("--dry-run");
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

function hasValidGeo(lat: unknown, lng: unknown): boolean {
    const la = lat != null ? Number(lat) : NaN;
    const ln = lng != null ? Number(lng) : NaN;
    return Number.isFinite(la) && Number.isFinite(ln);
}

function hasDriver(id: unknown): boolean {
    return id != null && String(id).trim() !== "";
}

async function main() {
    console.log("Syncing dependants from parent (driver + geocoding)...\n");

    const { data: dependants, error: depErr } = await supabase
        .from("clients")
        .select("id, first_name, last_name, full_name, parent_client_id, assigned_driver_id, lat, lng, geocoded_at")
        .not("parent_client_id", "is", null);

    if (depErr) {
        console.error("Failed to fetch dependants:", depErr.message);
        process.exit(1);
    }

    const list = dependants || [];
    if (list.length === 0) {
        console.log("No dependants found. Exiting.");
        return;
    }

    const parentIds = [...new Set(list.map((d: any) => String(d.parent_client_id)).filter(Boolean))];
    const { data: parents, error: parErr } = await supabase
        .from("clients")
        .select("id, assigned_driver_id, lat, lng, geocoded_at")
        .in("id", parentIds);

    if (parErr) {
        console.error("Failed to fetch parents:", parErr.message);
        process.exit(1);
    }

    const parentById = new Map<string, any>();
    for (const p of parents || []) {
        parentById.set(String(p.id), p);
    }

    let driverCopied = 0;
    let geoCopied = 0;
    const updates: { id: string; payload: Record<string, unknown> }[] = [];

    for (const d of list) {
        const parent = d.parent_client_id ? parentById.get(String(d.parent_client_id)) : undefined;
        if (!parent) {
            console.warn(`Dependant ${d.id} has missing parent ${d.parent_client_id}, skipping.`);
            continue;
        }

        const payload: Record<string, unknown> = {};
        let needDriver = !hasDriver(d.assigned_driver_id) && hasDriver(parent.assigned_driver_id);
        if (needDriver) {
            payload.assigned_driver_id = parent.assigned_driver_id;
            driverCopied++;
        }

        const dependantHasGeo = hasValidGeo(d.lat, d.lng);
        const parentHasGeo = hasValidGeo(parent.lat, parent.lng);
        if (!dependantHasGeo && parentHasGeo) {
            payload.lat = parent.lat;
            payload.lng = parent.lng;
            if (parent.geocoded_at != null) payload.geocoded_at = parent.geocoded_at;
            geoCopied++;
        }

        if (Object.keys(payload).length > 0) {
            updates.push({ id: String(d.id), payload });
        }
    }

    if (updates.length === 0) {
        console.log("No dependants need updates (all already have driver and/or geocoding).");
        return;
    }

    console.log(`${DRY_RUN ? "[DRY RUN] Would update" : "Updating"} ${updates.length} dependant(s) (driver copied: ${driverCopied}, geocoding copied: ${geoCopied}).`);
    if (DRY_RUN) {
        for (const { id, payload } of updates) {
            console.log(`  ${id}:`, payload);
        }
        console.log("Run without --dry-run to apply.");
        return;
    }

    for (const { id, payload } of updates) {
        const { error: updateErr } = await supabase.from("clients").update(payload).eq("id", id);
        if (updateErr) {
            console.error(`Failed to update dependant ${id}:`, updateErr.message);
        }
    }

    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
