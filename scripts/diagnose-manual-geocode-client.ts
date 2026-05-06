/**
 * Explain why a client appears on Routes → Manual geocoding / clients-missing-geocode.
 *
 * Mirrors:
 * - GET /api/route/clients-missing-geocode (filters)
 * - syncDependantGeoFromParents + shouldCopyParentGeoToDependant
 *
 * Run from project root:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-manual-geocode-client.ts
 *
 * Or pass a client UUID:
 *   CLIENT_ID=dbf6ee8a-14ff-4c5d-91d3-7f8e2fb01893 npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-manual-geocode-client.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { getSupabaseDbApiKey } from "../lib/supabase-env";
import { fetchStatusDeliveriesAllowedMap, isExcludedFromDeliveries } from "../lib/deliveryEligibility";
import {
    addressesMatch,
    hasAnyAddressLine,
    hasValidGeo,
    shouldCopyParentGeoToDependant,
} from "../lib/dependantParentGeoSync";

const DEFAULT_CLIENT_ID = "dbf6ee8a-14ff-4c5d-91d3-7f8e2fb01893";

function pick<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) {
    const o: Record<string, unknown> = {};
    for (const k of keys) o[String(k)] = row[k];
    return o;
}

function missingLatLng(lat: unknown, lng: unknown): boolean {
    return lat == null || lng == null;
}

async function main() {
    const clientId = (process.env.CLIENT_ID || process.argv[2] || DEFAULT_CLIENT_ID).trim();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = getSupabaseDbApiKey();
    if (!url || !key) {
        console.error("Missing NEXT_PUBLIC_SUPABASE_URL or a DB API key in .env.local (see lib/supabase-env).");
        process.exit(1);
    }

    const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const statusAllowMap = await fetchStatusDeliveriesAllowedMap(supabase);

    const { data: c, error } = await supabase
        .from("clients")
        .select(
            "id, first_name, last_name, full_name, parent_client_id, address, apt, city, state, zip, lat, lng, paused, delivery, status_id, archived_at, unite_account"
        )
        .eq("id", clientId)
        .maybeSingle();

    if (error) {
        console.error("Query error:", error.message);
        process.exit(1);
    }
    if (!c) {
        console.error(`No client row found for id=${clientId}`);
        process.exit(1);
    }

    const row = c as Record<string, unknown>;

    console.log("\n=== Client row (subset) ===\n");
    console.log(
        JSON.stringify(
            pick(row, [
                "id",
                "full_name",
                "first_name",
                "last_name",
                "parent_client_id",
                "address",
                "apt",
                "city",
                "state",
                "zip",
                "lat",
                "lng",
                "paused",
                "delivery",
                "status_id",
                "archived_at",
                "unite_account",
            ]),
            null,
            2
        )
    );

    const geoOk = hasValidGeo(row.lat, row.lng);
    const excluded = isExcludedFromDeliveries(
        row.paused === true,
        row.status_id != null ? String(row.status_id) : null,
        statusAllowMap
    );
    const deliveryOff = row.delivery === false;
    const archived = row.archived_at != null && String(row.archived_at).trim() !== "";
    const coordsIncomplete = missingLatLng(row.lat, row.lng);

    console.log("\n=== Manual geocode list (same rules as /api/route/clients-missing-geocode) ===\n");
    console.log(`  archived_at set?           ${archived ? "YES → excluded from list" : "no"}`);
    console.log(`  paused?                    ${row.paused === true ? "YES → excluded" : "no"}`);
    console.log(`  delivery === false?        ${deliveryOff ? "YES → excluded" : "no"}`);
    console.log(`  excluded by status?       ${excluded ? "YES → excluded" : "no"}`);
    console.log(`  lat or lng null?           ${coordsIncomplete ? "YES" : "no"} (required to appear when eligible)`);
    console.log(`  has valid lat/lng pair?    ${geoOk ? "YES" : "NO"}`);

    const wouldList =
        !archived &&
        row.paused !== true &&
        !deliveryOff &&
        !excluded &&
        (row.delivery === undefined || row.delivery === null || row.delivery === true) &&
        coordsIncomplete;

    console.log(`\n  → Would appear in manual geocode API? ${wouldList ? "YES" : "NO"}`);

    const pid = row.parent_client_id != null && row.parent_client_id !== "" ? String(row.parent_client_id) : null;

    if (!pid) {
        console.log("\n=== Parent sync ===\n");
        console.log("  No parent_client_id — this is a primary client (or orphan). Parent geo sync does not apply.");
        console.log("  They show up in manual geocode only because lat/lng are incomplete and they pass the filters above.");
        return;
    }

    const { data: parent, error: pErr } = await supabase
        .from("clients")
        .select("id, full_name, address, apt, city, state, zip, lat, lng")
        .eq("id", pid)
        .maybeSingle();

    console.log("\n=== Parent row ===\n");
    if (pErr || !parent) {
        console.log(`  ERROR or missing parent for parent_client_id=${pid}`);
        console.log("  Sync skips when parent row is missing — dependant keeps missing coords.");
        return;
    }

    const p = parent as Record<string, unknown>;
    console.log(
        JSON.stringify(
            pick(p, ["id", "full_name", "address", "apt", "city", "state", "zip", "lat", "lng"]),
            null,
            2
        )
    );

    const depAddr = {
        address: row.address,
        apt: row.apt,
        city: row.city,
        state: row.state,
        zip: row.zip,
    };
    const parAddr = {
        address: p.address,
        apt: p.apt,
        city: p.city,
        state: p.state,
        zip: p.zip,
    };

    console.log("\n=== Address comparison (sync rules) ===\n");
    console.log(`  Dependant has any address line? ${hasAnyAddressLine(depAddr)}`);
    console.log(`  Dependant address matches parent? ${addressesMatch(depAddr, parAddr)}`);
    console.log(`  Parent has valid geo?            ${hasValidGeo(p.lat, p.lng)}`);
    console.log(`  Dependant has valid geo?       ${hasValidGeo(row.lat, row.lng)}`);
    console.log(
        `  shouldCopyParentGeoToDependant?  ${shouldCopyParentGeoToDependant(
            { ...depAddr, lat: row.lat, lng: row.lng },
            { ...parAddr, lat: p.lat, lng: p.lng }
        )}`
    );

    console.log("\n=== Why manual geocode still shows this dependant ===\n");

    if (hasValidGeo(row.lat, row.lng)) {
        console.log("  (Unexpected: dependant already has valid geo — should NOT be in missing-geocode list.)");
    } else if (!hasValidGeo(p.lat, p.lng)) {
        console.log("  • Parent is not geocoded — sync cannot copy lat/lng until the parent has coordinates.");
    } else if (!shouldCopyParentGeoToDependant(
        { ...depAddr, lat: row.lat, lng: row.lng },
        { ...parAddr, lat: p.lat, lng: p.lng }
    )) {
        if (hasAnyAddressLine(depAddr) && !addressesMatch(depAddr, parAddr)) {
            console.log(
                "  • Dependant has address fields that differ from the parent — app treats this as a different household location and does NOT copy parent's coordinates."
            );
            console.log("    Fix: align dependant address with parent, or clear dependant address so household sync applies, or geocode the dependant separately.");
        } else {
            console.log("  • Copy rules returned false for another reason (see booleans above).");
        }
    } else {
        console.log(
            "  • Sync SHOULD copy parent → dependant. If they still lack coords, POST /api/route/sync-dependant-geo-from-parent may not have run, failed, or Brooklyn-only scope skipped this row."
        );
        console.log("    Try running sync again from the app or call syncDependantGeoFromParents from an admin context.");
    }

    console.log("");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
