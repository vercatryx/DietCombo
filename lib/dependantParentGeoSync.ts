import type { SupabaseClient } from "@supabase/supabase-js";

export function hasValidGeo(lat: unknown, lng: unknown): boolean {
    const la = lat != null ? Number(lat) : NaN;
    const ln = lng != null ? Number(lng) : NaN;
    return Number.isFinite(la) && Number.isFinite(ln);
}

/** True if any of street / city / state / zip is non-empty. */
export function hasAnyAddressLine(c: {
    address?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
}): boolean {
    const a = c.address != null ? String(c.address).trim() : "";
    const city = c.city != null ? String(c.city).trim() : "";
    const state = c.state != null ? String(c.state).trim() : "";
    const zip = c.zip != null ? String(c.zip).trim() : "";
    return a !== "" || city !== "" || state !== "" || zip !== "";
}

function normPart(v: unknown): string {
    return v == null ? "" : String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

export function addressesMatch(
    a: { address?: unknown; apt?: unknown; city?: unknown; state?: unknown; zip?: unknown },
    b: { address?: unknown; apt?: unknown; city?: unknown; state?: unknown; zip?: unknown }
): boolean {
    return (
        normPart(a.address) === normPart(b.address) &&
        normPart(a.apt) === normPart(b.apt) &&
        normPart(a.city) === normPart(b.city) &&
        normPart(a.state) === normPart(b.state) &&
        normPart(a.zip) === normPart(b.zip)
    );
}

/**
 * Copy parent's lat/lng onto the dependant row only when:
 * - dependant lacks valid coordinates
 * - parent has valid coordinates
 * - dependant has no address on file (same household), OR dependant address matches parent's
 *
 * Do not copy when the dependant has a different address than the parent — they need their own geocode.
 */
export function shouldCopyParentGeoToDependant(
    dependant: {
        lat?: unknown;
        lng?: unknown;
        address?: unknown;
        apt?: unknown;
        city?: unknown;
        state?: unknown;
        zip?: unknown;
    },
    parent: {
        lat?: unknown;
        lng?: unknown;
        address?: unknown;
        apt?: unknown;
        city?: unknown;
        state?: unknown;
        zip?: unknown;
    }
): boolean {
    if (hasValidGeo(dependant.lat, dependant.lng)) return false;
    if (!hasValidGeo(parent.lat, parent.lng)) return false;
    if (!hasAnyAddressLine(dependant)) return true;
    return addressesMatch(dependant, parent);
}

export type SyncDependantGeoFromParentsResult = {
    updated: number;
    failed: number;
};

export type SyncDependantGeoOptions = {
    /** When true, only dependant rows with unite_account = Brooklyn are updated. */
    brooklynOnly?: boolean;
};

/**
 * Writes parent's lat/lng (and geocoded_at when present) to dependants that qualify.
 * Also updates `stops` lat/lng for those clients so route maps stay consistent.
 */
export async function syncDependantGeoFromParents(
    sb: SupabaseClient,
    opts?: SyncDependantGeoOptions
): Promise<SyncDependantGeoFromParentsResult> {
    let depQuery = sb
        .from("clients")
        .select("id, parent_client_id, address, apt, city, state, zip, lat, lng, geocoded_at")
        .not("parent_client_id", "is", null);
    if (opts?.brooklynOnly) {
        depQuery = depQuery.eq("unite_account", "Brooklyn");
    }
    const { data: dependants, error: dErr } = await depQuery;

    if (dErr) throw new Error(dErr.message);
    const list = dependants || [];
    if (list.length === 0) return { updated: 0, failed: 0 };

    const parentIds = [...new Set(list.map((d: { parent_client_id: string }) => String(d.parent_client_id)).filter(Boolean))];
    const { data: parents, error: pErr } = await sb
        .from("clients")
        .select("id, address, apt, city, state, zip, lat, lng, geocoded_at")
        .in("id", parentIds);

    if (pErr) throw new Error(pErr.message);

    const parentById = new Map<string, Record<string, unknown>>();
    for (const p of parents || []) {
        parentById.set(String((p as { id: string }).id), p as Record<string, unknown>);
    }

    let updated = 0;
    let failed = 0;

    for (const d of list as Record<string, unknown>[]) {
        const pid = d.parent_client_id != null ? String(d.parent_client_id) : "";
        const parent = pid ? parentById.get(pid) : undefined;
        if (!parent) continue;

        if (!shouldCopyParentGeoToDependant(d, parent)) continue;

        const lat = Number(parent.lat);
        const lng = Number(parent.lng);
        const payload: Record<string, unknown> = { lat, lng };
        if (parent.geocoded_at != null) payload.geocoded_at = parent.geocoded_at;

        const { error: uErr } = await sb.from("clients").update(payload).eq("id", d.id as string);
        if (uErr) {
            failed++;
            console.warn("[syncDependantGeoFromParents] client update failed:", d.id, uErr.message);
            continue;
        }

        const { error: sErr } = await sb
            .from("stops")
            .update({ lat, lng })
            .eq("client_id", d.id as string);
        if (sErr) {
            console.warn("[syncDependantGeoFromParents] stops update failed:", d.id, sErr.message);
        }

        updated++;
    }

    return { updated, failed };
}
