export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncDependantGeoFromParents } from "@/lib/dependantParentGeoSync";
import { getSession } from "@/lib/session";

/**
 * Copies parent's lat/lng onto dependants who share the household location (no own address,
 * or same address as parent). Skips dependants with a different address — those need manual geocoding.
 */
export async function POST() {
    try {
        const session = await getSession();
        if (!session?.userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brooklynOnly = session.role === "brooklyn_admin";
        const result = await syncDependantGeoFromParents(supabase, { brooklynOnly });
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (e: unknown) {
        console.error("[POST /api/route/sync-dependant-geo-from-parent]", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 }
        );
    }
}
