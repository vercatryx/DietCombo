/**
 * Copies parent's address, assigned_driver_id, and geocoding to dependants when the dependant
 * doesn't already have their own.
 *
 * - Address: address, apt, city, state, zip (and county if present) — only copied if dependant
 *   has no address (all of address/city/state/zip empty).
 * - Driver: only copied if dependant's assigned_driver_id is null or empty.
 * - Geocoding: lat, lng, geocoded_at — only copied if dependant is missing valid lat/lng.
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

function hasAddress(c: { address?: unknown; city?: unknown; state?: unknown; zip?: unknown }): boolean {
    const a = c.address != null ? String(c.address).trim() : "";
    const city = c.city != null ? String(c.city).trim() : "";
    const state = c.state != null ? String(c.state).trim() : "";
    const zip = c.zip != null ? String(c.zip).trim() : "";
    return a !== "" || city !== "" || state !== "" || zip !== "";
}

async function main() {
    console.log("Syncing dependants from parent (address + driver + geocoding)...\n");

    const { data: dependants, error: depErr } = await supabase
        .from("clients")
        .select("id, first_name, last_name, full_name, parent_client_id, assigned_driver_id, address, apt, city, state, zip, county, lat, lng, geocoded_at")
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
        .select("id, assigned_driver_id, address, apt, city, state, zip, county, lat, lng, geocoded_at")
        .in("id", parentIds);

    if (parErr) {
        console.error("Failed to fetch parents:", parErr.message);
        process.exit(1);
    }

    const parentById = new Map<string, any>();
    for (const p of parents || []) {
        parentById.set(String(p.id), p);
    }

    let addressCopied = 0;
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
        const dependantHasAddress = hasAddress(d);
        const parentHasAddress = hasAddress(parent);
        if (!dependantHasAddress && parentHasAddress) {
            if (parent.address != null) payload.address = parent.address;
            if (parent.apt != null) payload.apt = parent.apt;
            if (parent.city != null) payload.city = parent.city;
            if (parent.state != null) payload.state = parent.state;
            if (parent.zip != null) payload.zip = parent.zip;
            if (parent.county != null) payload.county = parent.county;
            addressCopied++;
        }

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
        console.log("No dependants need updates (all already have address, driver, and/or geocoding).");
        return;
    }

    console.log(`${DRY_RUN ? "[DRY RUN] Would update" : "Updating"} ${updates.length} dependant(s) (address: ${addressCopied}, driver: ${driverCopied}, geocoding: ${geoCopied}).`);
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
