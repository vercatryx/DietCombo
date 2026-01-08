// app/api/mobile/stop/complete/route.ts
import { NextResponse } from "next/server";
import { execute } from "@/lib/mysql";

export async function POST(req: Request) {
    let body;
    try {
        body = await req.json();
    } catch (error) {
        console.error("[mobile/stop/complete] JSON parse error:", error);
        return NextResponse.json({ 
            ok: false, 
            error: "Invalid JSON payload",
            details: "Failed to parse request body"
        }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
        return NextResponse.json({ 
            ok: false, 
            error: "Bad payload",
            details: "Request body must be a JSON object"
        }, { status: 400 });
    }

    const userId = body?.userId;
    const stopId = body?.stopId;
    const completed = Boolean(body?.completed);

    // Validate stopId - must be a non-empty string (UUID format)
    if (stopId === undefined || stopId === null || stopId === "") {
        console.error("[mobile/stop/complete] Missing stopId. Received body:", JSON.stringify(body));
        return NextResponse.json({ 
            ok: false, 
            error: "Bad payload",
            details: "stopId is required and must be a valid string"
        }, { status: 400 });
    }

    // Convert to string and validate (stop IDs are UUIDs, not numbers)
    const stopIdStr = String(stopId).trim();
    if (!stopIdStr || stopIdStr.length === 0) {
        console.error("[mobile/stop/complete] Invalid stopId (empty after trim):", stopId, "type:", typeof stopId);
        return NextResponse.json({ 
            ok: false, 
            error: "Bad payload",
            details: `stopId must be a non-empty string, received: ${stopId} (${typeof stopId})`
        }, { status: 400 });
    }

    try {
        await execute(
            `UPDATE stops SET completed = ? WHERE id = ?`,
            [completed ? 1 : 0, stopIdStr]
        );

        return NextResponse.json({ ok: true, stop: { id: stopIdStr, completed } });
    } catch (error) {
        console.error("[mobile/stop/complete] Database error:", error);
        return NextResponse.json({ 
            ok: false, 
            error: "Database error",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

