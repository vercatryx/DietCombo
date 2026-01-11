// app/api/route/reverse/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const routeId = body?.routeId;

        if (!routeId) {
            return NextResponse.json({ ok: false, error: "Missing routeId" }, { status: 400 });
        }

        // Fetch driver's current stopIds
        const { data: driver } = await supabase
            .from('drivers')
            .select('stop_ids, day')
            .eq('id', routeId)
            .single();

        if (!driver) {
            return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
        }

        const stopIds = Array.isArray(driver.stop_ids) 
            ? driver.stop_ids 
            : (typeof driver.stop_ids === 'string' ? JSON.parse(driver.stop_ids) : []);

        if (stopIds.length === 0) {
            return NextResponse.json({ ok: true, message: "No stops to reverse" });
        }

        // Reverse the array
        const reversed = [...stopIds].reverse();

        // Update driver
        await supabase
            .from('drivers')
            .update({ stop_ids: reversed })
            .eq('id', routeId);

        return NextResponse.json({ 
            ok: true, 
            message: `Reversed ${reversed.length} stops` 
        });
    } catch (error: any) {
        console.error("[route/reverse] error:", error);
        return NextResponse.json({ 
            ok: false, 
            error: error.message || "Failed to reverse route" 
        }, { status: 500 });
    }
}

