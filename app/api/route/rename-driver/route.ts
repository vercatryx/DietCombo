export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const driverId = body?.driverId ? String(body.driverId) : null;
        const newNumber = body?.newNumber;

        if (!driverId) {
            return NextResponse.json(
                { error: "driverId is required" },
                { status: 400 }
            );
        }

        if (newNumber === undefined || newNumber === null) {
            return NextResponse.json(
                { error: "newNumber is required" },
                { status: 400 }
            );
        }

        const num = Number(newNumber);
        if (!Number.isFinite(num) || num < 0) {
            return NextResponse.json(
                { error: "newNumber must be a non-negative number" },
                { status: 400 }
            );
        }

        // Get the driver
        const { data: driver } = await supabase
            .from('drivers')
            .select('id, name, day')
            .eq('id', driverId)
            .single();

        if (!driver) {
            return NextResponse.json(
                { error: "Driver not found" },
                { status: 404 }
            );
        }

        const oldName = driver.name || "Unknown";

        // Check if it's Driver 0 and trying to rename to something else
        if (/driver\s+0/i.test(oldName) && num !== 0) {
            return NextResponse.json(
                { error: "Cannot rename Driver 0 to a different number" },
                { status: 400 }
            );
        }

        // Check if another driver with this number already exists (for the same day)
        const day = driver.day || "all";
        const { data: existingDrivers } = await supabase
            .from('drivers')
            .select('id, name')
            .eq('day', day)
            .eq('name', `Driver ${num}`);

        // If another driver exists with this name and it's not the same driver, error
        if (existingDrivers && existingDrivers.length > 0 && existingDrivers[0].id !== driverId) {
            return NextResponse.json(
                { error: `Driver ${num} already exists` },
                { status: 400 }
            );
        }

        // Update the driver name
        const newName = `Driver ${num}`;
        await supabase
            .from('drivers')
            .update({ name: newName })
            .eq('id', driverId);

        return NextResponse.json(
            { 
                success: true, 
                message: `Driver renamed from ${oldName} to ${newName}`,
                oldName,
                newName
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/rename-driver] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

