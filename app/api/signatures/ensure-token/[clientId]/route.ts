import { NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/mysql";
import { randomUUID } from "crypto";

export async function POST(
    _req: Request,
    ctx: { params: Promise<{ clientId: string }> }
) {
    try {
        const { clientId } = await ctx.params;
        if (!clientId) {
            return NextResponse.json({ error: "Bad clientId" }, { status: 400 });
        }

        const found = await queryOne<{ sign_token: string | null }>(
            `SELECT sign_token FROM clients WHERE id = ?`,
            [clientId]
        );

        if (!found) {
            return NextResponse.json({ error: "Client not found" }, { status: 404 });
        }

        const token = found.sign_token ?? randomUUID();

        if (!found.sign_token) {
            await execute(
                `UPDATE clients SET sign_token = ? WHERE id = ?`,
                [token, clientId]
            );
        }

        return NextResponse.json({ sign_token: token });
    } catch (err: any) {
        console.error("[ensure-token POST] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}

