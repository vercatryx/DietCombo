// app/api/mobile/stop/complete/route.ts
import { NextResponse } from "next/server";
import { execute } from "@/lib/mysql";

export async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const userId = body?.userId;
    const stopId = body?.stopId;
    const completed = Boolean(body?.completed);

    if (!stopId) {
        return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
    }

    try {
        await execute(
            `UPDATE stops SET completed = ? WHERE id = ?`,
            [completed ? 1 : 0, stopId]
        );

        return NextResponse.json({ ok: true, stop: { id: stopId, completed } });
    } catch (error) {
        console.error("[mobile/stop/complete] error:", error);
        return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }
}

