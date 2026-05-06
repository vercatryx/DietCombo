export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { fetchAllRows, supabase } from "@/lib/supabase";
import { fetchStatusDeliveriesAllowedMap, isExcludedFromDeliveries } from "@/lib/deliveryEligibility";
import { hasValidGeo, syncDependantGeoFromParents } from "@/lib/dependantParentGeoSync";
import { isProduceServiceType } from "@/lib/isProduceServiceType";
import { getSession } from "@/lib/session";

/**
 * Returns clients from the clients table that are missing lat/lng (for manual geocoding).
 * Includes both primary clients and dependants (dependants can have their own orders and need geocoding).
 * Same filters as assignment: not paused, status allows deliveries, delivery true or null.
 * Brooklyn admins: only clients with unite_account = 'Brooklyn'.
 *
 * Produce clients (service_type includes Produce, same as driver routes) are omitted — they are not route stops.
 *
 * Before querying, runs `syncDependantGeoFromParents` (same as POST /api/route/sync-dependant-geo-from-parent)
 * so dependants who should inherit the parent's lat/lng receive it in the DB first — Manual Geocoding should
 * only list people who still need coordinates after that copy.
 *
 * Also unions **primary parents** that are missing lat/lng when a listed dependant uses them as
 * `parent_client_id` and sync cannot copy coords until the parent is geocoded. This avoids the case
 * where a Brooklyn-labelled dependant appears in Manual Geocoding but their primary was excluded by
 * the Brooklyn-only filter (or never surfaced), so staff only see the dependent with no address.
 */
export async function GET() {
    try {
        const session = await getSession();
        const brooklynOnly = session?.role === "brooklyn_admin";

        if (session?.userId) {
            try {
                await syncDependantGeoFromParents(supabase, { brooklynOnly });
            } catch (syncErr) {
                console.warn("[/api/route/clients-missing-geocode] syncDependantGeoFromParents:", syncErr);
            }
        }

        const statusAllowMap = await fetchStatusDeliveriesAllowedMap(supabase);

        const rawRows = await fetchAllRows((sb) => {
            let q = sb
                .from("clients")
                .select(
                    "id, first_name, last_name, full_name, address, apt, city, state, zip, lat, lng, parent_client_id, paused, delivery, status_id, unite_account, service_type"
                )
                .is("archived_at", null)
                .eq("paused", false)
                .or("delivery.is.null,delivery.eq.true")
                .or("lat.is.null,lng.is.null");
            if (brooklynOnly) {
                q = q.eq("unite_account", "Brooklyn");
            }
            return q.order("id", { ascending: true });
        });

        const str = (v: unknown): string => (v != null && v !== "" ? String(v).trim() : "");
        const get = (r: Record<string, unknown>, col: string): string => {
            const val = r[col];
            if (val != null && val !== "") return String(val).trim();
            const key = Object.keys(r).find((k) => k.toLowerCase() === col.toLowerCase());
            return key != null ? str(r[key]) : "";
        };

        const eligibleRows = (rawRows || []).filter((c: Record<string, unknown>) => {
            const paused = c.paused === true;
            const sid = c.status_id != null ? String(c.status_id) : null;
            if (isProduceServiceType(c.service_type as string | null | undefined)) return false;
            return (
                !isExcludedFromDeliveries(paused, sid, statusAllowMap) &&
                (c.delivery === undefined || c.delivery === null || c.delivery === true)
            );
        });

        const toClient = (c: Record<string, unknown>) => ({
            id: c.id,
            first: get(c, "first_name"),
            last: get(c, "last_name"),
            first_name: get(c, "first_name"),
            last_name: get(c, "last_name"),
            full_name: get(c, "full_name"),
            name: get(c, "full_name"),
            address: get(c, "address"),
            apt: c.apt != null && c.apt !== "" ? String(c.apt) : null,
            city: get(c, "city"),
            state: get(c, "state"),
            zip: get(c, "zip"),
            lat: c.lat != null ? Number(c.lat) : null,
            lng: c.lng != null ? Number(c.lng) : null,
            parent_client_id:
                c.parent_client_id != null && c.parent_client_id !== "" ? String(c.parent_client_id) : null,
        });

        let clients = eligibleRows.map(toClient);

        const inList = new Set(clients.map((row) => String(row.id)));

        const dependantsMissingGeo = eligibleRows.filter(
            (c) =>
                c.parent_client_id != null &&
                String(c.parent_client_id).trim() !== "" &&
                !hasValidGeo(c.lat, c.lng)
        );

        const parentIdsToAdd = new Set<string>();
        for (const d of dependantsMissingGeo) {
            const pid = String(d.parent_client_id);
            if (inList.has(pid)) continue;
            parentIdsToAdd.add(pid);
        }

        if (parentIdsToAdd.size > 0) {
            const parentRows = await fetchAllRows((sb) =>
                sb
                    .from("clients")
                    .select(
                        "id, first_name, last_name, full_name, address, apt, city, state, zip, lat, lng, parent_client_id, paused, delivery, status_id, unite_account"
                    )
                    .in("id", [...parentIdsToAdd])
                    .is("archived_at", null)
            );

            for (const p of parentRows || []) {
                const pr = p as Record<string, unknown>;
                const pid = String(pr.id);
                if (inList.has(pid)) continue;
                if (hasValidGeo(pr.lat, pr.lng)) continue;

                const paused = pr.paused === true;
                const sid = pr.status_id != null ? String(pr.status_id) : null;
                const passesDeliveryEligibility =
                    !isExcludedFromDeliveries(paused, sid, statusAllowMap) &&
                    (pr.delivery === undefined || pr.delivery === null || pr.delivery === true);

                if (!passesDeliveryEligibility) continue;

                const brooklynDependantNeedsThisParent =
                    brooklynOnly &&
                    dependantsMissingGeo.some(
                        (d) =>
                            String(d.parent_client_id) === pid &&
                            String(d.unite_account || "").trim() === "Brooklyn"
                    );

                const allowedForBrooklynView =
                    !brooklynOnly ||
                    String(pr.unite_account || "").trim() === "Brooklyn" ||
                    brooklynDependantNeedsThisParent;

                if (!allowedForBrooklynView) continue;

                clients.push(toClient(pr));
                inList.add(pid);
            }
        }

        clients = clients.slice().sort((a, b) => {
            const ap = a.parent_client_id ? 1 : 0;
            const bp = b.parent_client_id ? 1 : 0;
            if (ap !== bp) return ap - bp;
            return String(a.id).localeCompare(String(b.id));
        });

        const parentIdsForLabels = [
            ...new Set(
                clients
                    .map((c) => c.parent_client_id)
                    .filter((x): x is string => x != null && String(x).trim() !== "")
                    .map((x) => String(x))
            ),
        ];

        if (parentIdsForLabels.length > 0) {
            const labelParents = await fetchAllRows((sb) =>
                sb
                    .from("clients")
                    .select("id, first_name, last_name, full_name, address, apt, city, state, zip")
                    .in("id", parentIdsForLabels)
            );
            const parentById = new Map<string, Record<string, unknown>>();
            for (const p of labelParents || []) {
                parentById.set(String((p as { id: string }).id), p as Record<string, unknown>);
            }

            clients = clients.map((c) => {
                const pid = c.parent_client_id;
                if (!pid) {
                    return {
                        ...c,
                        parent_primary_name: null as string | null,
                        parent_primary_id: null as string | null,
                    };
                }

                const p = parentById.get(String(pid));
                const primaryLabel =
                    p != null
                        ? (() => {
                              const fn = get(p, "full_name");
                              if (fn) return fn;
                              const combo = `${get(p, "first_name")} ${get(p, "last_name")}`.trim();
                              return combo || "Primary client";
                          })()
                        : null;

                return {
                    ...c,
                    parent_primary_name: primaryLabel,
                    parent_primary_id: String(pid),
                };
            });
        } else {
            clients = clients.map((c) => ({
                ...c,
                parent_primary_name: null as string | null,
                parent_primary_id:
                    c.parent_client_id != null && String(c.parent_client_id).trim() !== ""
                        ? String(c.parent_client_id)
                        : null,
            }));
        }

        return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: unknown) {
        console.error("[/api/route/clients-missing-geocode] error:", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 }
        );
    }
}
