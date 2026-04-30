export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";
import { fetchStatusDeliveriesAllowedMap, isExcludedFromDeliveries } from "@/lib/deliveryEligibility";
import { getSession } from "@/lib/session";

/**
 * Lightweight endpoint for Routes page: clients (with assigned_driver_id) + driver id → name (+ color).
 * All filtering is done in the DB. Used by Client Assignment tab and Orders View (with orders-for-date).
 * Brooklyn admins: only clients with unite_account = 'Brooklyn'.
 */
export async function GET(req: Request) {
    try {
        const session = await getSession();
        const brooklynOnly = session?.role === "brooklyn_admin";

        const statusAllowMap = await fetchStatusDeliveriesAllowedMap(supabase);

        const { searchParams } = new URL(req.url);
        const day = (searchParams.get("day") || "all").toLowerCase();

        // 1) Clients: only columns needed for assignment, filter paused/delivery in DB
        const clientsRows = await fetchAllRows((sb) => {
            let q = sb
                .from("clients")
                .select(
                    "id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id, parent_client_id, service_type, status_id"
                )
                .eq("paused", false)
                .or("delivery.is.null,delivery.eq.true");
            if (brooklynOnly) {
                q = q.eq("unite_account", "Brooklyn");
            }
            return q.order("id", { ascending: true });
        });

        // 1b) Client stats for routes page summary (same Brooklyn filter when brooklyn_admin)
        const statsRows = await fetchAllRows((sb) => {
            let q = sb
                .from("clients")
                .select("id, parent_client_id, service_type, paused, delivery, lat, lng, status_id");
            if (brooklynOnly) {
                q = q.eq("unite_account", "Brooklyn");
            }
            // Note: ordering isn't strictly required for stats correctness,
            // but keeping it stable helps with debugging.
            return q.order("id", { ascending: true });
        });
        const rows = (statsRows || []) as {
            parent_client_id: string | null;
            service_type: string | null;
            paused: boolean;
            delivery: boolean;
            lat: number | null;
            lng: number | null;
            status_id?: string | null;
        }[];
        const hasFood = (st: string | null) => (st ?? "").toLowerCase().includes("food");
        const hasProduce = (st: string | null) => (st ?? "").toLowerCase().includes("produce");
        const isProduceOnly = (st: string | null) => (st ?? "").trim().toLowerCase() === "produce";
        const isDeliveryEligible = (r: typeof rows[0]) =>
            !isExcludedFromDeliveries(r.paused, r.status_id, statusAllowMap) && (r.delivery !== false);
        const stats = {
            total_clients: rows.length,
            total_dependants: rows.filter((r) => r.parent_client_id != null && r.parent_client_id !== "").length,
            total_primaries_food: rows.filter((r) => !r.parent_client_id && hasFood(r.service_type)).length,
            total_produce: rows.filter((r) => hasProduce(r.service_type)).length,
            primary_paused_or_delivery_off: rows.filter(
                (r) =>
                    !r.parent_client_id &&
                    (r.paused === true ||
                        r.delivery === false ||
                        isExcludedFromDeliveries(false, r.status_id, statusAllowMap)) &&
                    !isProduceOnly(r.service_type)
            ).length,
            primary_food_missing_geo: rows.filter(
                (r) =>
                    !r.parent_client_id &&
                    hasFood(r.service_type) &&
                    (r.lat == null || r.lng == null)
            ).length,
            /** Delivery-eligible dependants missing lat/lng (shown in Needs Geocoding tab and on map when geocoded). */
            dependant_missing_geo: rows.filter(
                (r) =>
                    r.parent_client_id != null &&
                    r.parent_client_id !== "" &&
                    (r.lat == null || r.lng == null) &&
                    isDeliveryEligible(r)
            ).length,
        };

        // 2) Drivers: id + name + color from drivers and routes tables (DB-side)
        // Fetched early so we can sort by name rank when building clientToRouteDriver
        let driversQuery = supabase
            .from("drivers")
            .select("id, name, color")
            .order("id", { ascending: true });
        if (day !== "all") {
            driversQuery = driversQuery.eq("day", day);
        }
        const { data: driversRows } = await driversQuery;

        const { data: routesRows } = await supabase
            .from("routes")
            .select("id, name, color")
            .order("id", { ascending: true });

        const driverList: { id: string; name: string; color: string | null }[] = [];
        const seen = new Set<string>();
        const palette = [
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
            "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
        ];
        (driversRows || []).forEach((d: any, i: number) => {
            const id = String(d.id);
            if (seen.has(id)) return;
            seen.add(id);
            driverList.push({
                id,
                name: d.name || `Driver ${i}`,
                color: d.color && d.color !== "#666" ? d.color : palette[driverList.length % palette.length],
            });
        });
        (routesRows || []).forEach((r: any, i: number) => {
            const id = String(r.id);
            if (seen.has(id)) return;
            seen.add(id);
            driverList.push({
                id,
                name: r.name || `Route ${i}`,
                color: r.color && r.color !== "#666" ? r.color : palette[driverList.length % palette.length],
            });
        });

        // Fetch driver_route_order so client grouping matches the routes/drivers page.
        // Process in driver name-rank order (Driver 0, 1, 2, …) matching the routes API claim order.
        const allRouteOrder = await fetchAllRows((sb: any) =>
            sb.from('driver_route_order')
                .select('driver_id, client_id')
                .order('position', { ascending: true })
        );
        const driverRankByName = (name: string) => {
            const m = /driver\s+(\d+)/i.exec(name || "");
            return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
        };
        const sortedDriverIds = [...driverList].sort((a, b) => driverRankByName(a.name) - driverRankByName(b.name)).map(d => d.id);
        const routeByDriver = new Map<string, string[]>();
        for (const row of allRouteOrder || []) {
            const did = String(row.driver_id);
            if (!routeByDriver.has(did)) routeByDriver.set(did, []);
            routeByDriver.get(did)!.push(String(row.client_id));
        }
        const clientToRouteDriver = new Map<string, string>();
        for (const driverId of sortedDriverIds) {
            const clientIds = routeByDriver.get(driverId) || [];
            for (const cid of clientIds) {
                if (!clientToRouteDriver.has(cid)) {
                    clientToRouteDriver.set(cid, driverId);
                }
            }
        }
        for (const [driverId, clientIds] of routeByDriver) {
            if (sortedDriverIds.includes(driverId)) continue;
            for (const cid of clientIds) {
                if (!clientToRouteDriver.has(cid)) {
                    clientToRouteDriver.set(cid, driverId);
                }
            }
        }

        // Read from row with fallbacks for casing (Supabase/Postgres typically use lowercase)
        const pick = (row: any, ...keys: string[]) => {
            for (const k of keys) {
                const v = row[k];
                if (v != null && v !== "") return String(v);
            }
            return "";
        };
        const eligibleAssignmentRows = (clientsRows || []).filter(
            (c: any) => !isExcludedFromDeliveries(c.paused, c.status_id, statusAllowMap)
        );
        const clients = eligibleAssignmentRows.map((c: any) => ({
            id: c.id,
            first: pick(c, "first_name", "firstName"),
            last: pick(c, "last_name", "lastName"),
            name: pick(c, "full_name", "fullName"),
            full_name: pick(c, "full_name", "fullName"),
            address: pick(c, "address", "Address"),
            apt: c.apt != null && c.apt !== "" ? String(c.apt) : null,
            city: pick(c, "city", "City"),
            state: pick(c, "state", "State"),
            zip: pick(c, "zip", "Zip", "zip_code", "postal_code"),
            phone: c.phone_number != null && c.phone_number !== "" ? String(c.phone_number) : null,
            lat: c.lat != null ? Number(c.lat) : null,
            lng: c.lng != null ? Number(c.lng) : null,
            paused: Boolean(c.paused),
            delivery: c.delivery !== undefined ? Boolean(c.delivery) : true,
            assigned_driver_id: clientToRouteDriver.get(String(c.id)) ?? c.assigned_driver_id ?? null,
            assignedDriverId: clientToRouteDriver.get(String(c.id)) ?? c.assigned_driver_id ?? null,
            parent_client_id: c.parent_client_id != null && c.parent_client_id !== "" ? String(c.parent_client_id) : null,
            parentClientId: c.parent_client_id != null && c.parent_client_id !== "" ? String(c.parent_client_id) : null,
            service_type: c.service_type != null && c.service_type !== "" ? String(c.service_type) : null,
            serviceType: c.service_type != null && c.service_type !== "" ? String(c.service_type) : null,
        }));

        return NextResponse.json(
            { clients, drivers: driverList, stats },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/assignment-data] error:", e);
        return NextResponse.json(
            { error: e?.message ?? "Unknown error" },
            { status: 500 }
        );
    }
}
