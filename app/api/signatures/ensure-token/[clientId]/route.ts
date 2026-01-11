import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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

        const { data: found } = await supabase
            .from('clients')
            .select('sign_token')
            .eq('id', clientId)
            .single();

        if (!found) {
            return NextResponse.json({ error: "Client not found" }, { status: 404 });
        }

        const token = found.sign_token ?? randomUUID();

        if (!found.sign_token) {
            await supabase
                .from('clients')
                .update({ sign_token: token })
                .eq('id', clientId);
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

