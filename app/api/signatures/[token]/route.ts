import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const { data: user } = await supabase
            .from('clients')
            .select('id, full_name, first_name, last_name')
            .eq('sign_token', token)
            .single();

        if (!user) {
            return new NextResponse("Not found", { status: 404 });
        }

        // If first_name or last_name are null, parse from full_name
        let firstName = user.first_name || "";
        let lastName = user.last_name || "";
        if (!firstName && !lastName && user.full_name) {
            const nameParts = user.full_name.trim().split(/\s+/);
            if (nameParts.length > 0) {
                firstName = nameParts[0];
                lastName = nameParts.slice(1).join(" ") || "";
            }
        }

        const { data: sigs } = await supabase
            .from('signatures')
            .select('slot')
            .eq('client_id', user.id)
            .order('slot', { ascending: true });

        return NextResponse.json({
            user: {
                id: user.id,
                first: firstName,
                last: lastName,
            },
            collected: sigs.length,
            slots: sigs.map((s) => s.slot),
        });
    } catch (error: any) {
        console.error("[signatures GET] error:", error);
        return NextResponse.json(
            { error: "Internal error", detail: error?.message },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const { data: user } = await supabase
            .from('clients')
            .select('id')
            .eq('sign_token', token)
            .single();

        if (!user) {
            return new NextResponse("Not found", { status: 404 });
        }

        const body = await req.json().catch(() => null);
        const slot = Number(body?.slot);
        const strokes = body?.strokes;
        const orderId = body?.orderId || null; // Optional order_id to link signature to specific order

        if (![1, 2, 3, 4, 5].includes(slot)) {
            return new NextResponse("Invalid slot", { status: 400 });
        }
        if (!Array.isArray(strokes) || strokes.length === 0) {
            return new NextResponse("Invalid strokes", { status: 400 });
        }

        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
        const ua = req.headers.get("user-agent") || undefined;

        // Check if signature already exists
        const { data: existing } = await supabase
            .from('signatures')
            .select('id')
            .eq('client_id', user.id)
            .eq('slot', slot)
            .maybeSingle();

        // Handle signature insert/update (order_id is optional and only used if provided and column exists)
        const payload: any = {
            strokes,
            ip: ip || null,
            user_agent: ua || null,
            signed_at: new Date().toISOString()
        };
        if (orderId) {
            payload.order_id = orderId;
        }

        if (existing) {
            // Update existing signature
            const { error: updateError } = await supabase
                .from('signatures')
                .update(payload)
                .eq('client_id', user.id)
                .eq('slot', slot);
            if (updateError) {
                // If error is about missing column, try without order_id
                if (updateError.message?.includes('order_id') || updateError.code === 'PGRST116') {
                    delete payload.order_id;
                    const { error: retryError } = await supabase
                        .from('signatures')
                        .update(payload)
                        .eq('client_id', user.id)
                        .eq('slot', slot);
                    if (retryError) throw retryError;
                } else {
                    throw updateError;
                }
            }
        } else {
            // Insert new signature
            const id = randomUUID();
            const insertPayload = { ...payload, id, client_id: user.id, slot };
            const { error: insertError } = await supabase
                .from('signatures')
                .insert([insertPayload]);
            if (insertError) {
                // If error is about missing column, try without order_id
                if (insertError.message?.includes('order_id') || insertError.code === 'PGRST116') {
                    delete insertPayload.order_id;
                    const { error: retryError } = await supabase
                        .from('signatures')
                        .insert([insertPayload]);
                    if (retryError) throw retryError;
                } else {
                    throw insertError;
                }
            }
        }

        const { data: after } = await supabase
            .from('signatures')
            .select('slot')
            .eq('client_id', user.id)
            .order('slot', { ascending: true });

        return NextResponse.json({
            ok: true,
            collected: after.length,
            slots: after.map((s) => s.slot),
        });
    } catch (error: any) {
        console.error("[signatures POST] error:", error);
        return NextResponse.json(
            { error: "Internal error", detail: error?.message },
            { status: 500 }
        );
    }
}

