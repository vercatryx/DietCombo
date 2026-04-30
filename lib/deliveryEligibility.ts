import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Loads client_statuses.deliveries_allowed into a map (id → allowed).
 * Missing rows default to allowed when checking via {@link isExcludedFromDeliveries}.
 */
export async function fetchStatusDeliveriesAllowedMap(sb: SupabaseClient): Promise<Map<string, boolean>> {
    const { data, error } = await sb.from("client_statuses").select("id, deliveries_allowed");
    const m = new Map<string, boolean>();
    if (error || !data) return m;
    for (const row of data as { id: string; deliveries_allowed: boolean | null }[]) {
        m.set(String(row.id), row.deliveries_allowed !== false);
    }
    return m;
}

/** Profile paused and/or client status has deliveries_allowed = false (admin "Deliveries Allowed?"). */
export function isExcludedFromDeliveries(
    paused: boolean | null | undefined,
    statusId: string | null | undefined,
    statusAllowMap: Map<string, boolean>
): boolean {
    if (paused === true) return true;
    const sid = statusId && String(statusId).trim();
    if (!sid) return false;
    return statusAllowMap.get(sid) === false;
}
