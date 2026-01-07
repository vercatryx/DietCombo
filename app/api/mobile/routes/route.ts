// app/api/mobile/routes/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

export const dynamic = "force-dynamic";

/**
 * Returns lightweight route summaries for mobile:
 * - id, name, color
 * - stopIds (existing only)
 * - totalStops, completedStops
 *
 * Supports ?day=<monday|tuesday|...|all>
 * When a specific day is requested, we also include drivers with day="all"
 * so generation done with day="all" still powers the mobile view.
 */
export async function GET(req: Request) {
    const t0 = Date.now();
    console.log("[mobile/routes] GET start");

    try {
        const { searchParams } = new URL(req.url);
        const dayParam = (searchParams.get("day") ?? "all").toLowerCase();

        // 1) Fetch drivers (include day="all" when a specific day is requested)
        let driverWhere = "";
        let driverParams: any[] = [];
        if (dayParam !== "all") {
            driverWhere = "WHERE (day = ? OR day = 'all')";
            driverParams = [dayParam];
        }

        const drivers = await query<any[]>(
            `SELECT id, name, color, stop_ids FROM drivers ${driverWhere} ORDER BY id ASC`,
            driverParams
        );
        console.log("[mobile/routes] drivers:", drivers.length, "day:", dayParam);

        // 2) Collect unique stopIds (keep as strings since they are UUIDs)
        const allStopIds = Array.from(
            new Set(
                drivers.flatMap((d) => {
                    const stopIds = Array.isArray(d.stop_ids) ? d.stop_ids : 
                        (typeof d.stop_ids === 'string' ? JSON.parse(d.stop_ids) : []);
                    return stopIds
                        .map((id: any) => String(id))
                        .filter((id: string) => id && id.trim().length > 0);
                })
            )
        );
        console.log("[mobile/routes] unique stopIds:", allStopIds.length);

        // 3) Load minimal stop info to compute progress
        const stops: any[] = allStopIds.length
            ? await query<any[]>(
                `SELECT id, completed FROM stops WHERE id IN (${allStopIds.map(() => "?").join(",")})`,
                allStopIds
            )
            : [];

        const stopById = new Map<string, any>();
        for (const s of stops) stopById.set(String(s.id), s);

        // 4) Shape per driver
        const shaped = drivers.map((d) => {
            const rawIds = Array.isArray(d.stop_ids) ? d.stop_ids : 
                (typeof d.stop_ids === 'string' ? JSON.parse(d.stop_ids) : []);
            const filteredIds = rawIds
                .map((id: any) => String(id))
                .filter((id: string) => id && id.trim().length > 0 && stopById.has(id));

            let completed = 0;
            for (const sid of filteredIds) {
                const st = stopById.get(sid);
                if (st && st.completed) completed++;
            }

            return {
                id: d.id,
                name: d.name,
                color: d.color ?? null,
                routeNumber: d.id, // keeps "Route {id}" labeling if you use it in UI
                stopIds: filteredIds,
                totalStops: filteredIds.length,
                completedStops: completed,
            };
        });

        // 5) Hide drivers with no stops so mobile only shows live routes
        const activeOnly = shaped.filter((r) => r.totalStops > 0);

        console.log(
            "[mobile/routes] shaped(active):",
            activeOnly.length,
            "in",
            Date.now() - t0,
            "ms"
        );

        return NextResponse.json(activeOnly, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (e) {
        console.error("[mobile/routes] error:", e);
        // Return empty (200) so the mobile UI can still render gracefully
        return NextResponse.json([], { status: 200 });
    }
}

