export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { geocodeIfNeeded } from "@/lib/geocodeOneClient";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const { data: client } = await supabase
        .from('clients')
        .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, complex')
        .eq('id', id)
        .single();
    
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    
    return NextResponse.json({
        id: client.id,
        first: client.first_name || "",
        last: client.last_name || "",
        address: client.address || "",
        apt: client.apt || null,
        city: client.city || "",
        state: client.state || "",
        zip: client.zip || "",
        phone: client.phone_number || null,
        lat: client.lat ? Number(client.lat) : null,
        lng: client.lng ? Number(client.lng) : null,
        dislikes: client.dislikes || null,
        paused: Boolean(client.paused),
        delivery: client.delivery !== undefined ? Boolean(client.delivery) : true,
        complex: Boolean(client.complex),
    });
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const userId = id;
    const b = await req.json();
    
    const clearGeocode = !!b.clearGeocode;
    const cascadeStopsFlag = !!b.cascadeStops;
    
    // Get current client
    const { data: current } = await supabase
        .from('clients')
        .select('lat, lng, address, apt, city, state, zip, phone_number, first_name, last_name')
        .eq('id', userId)
        .single();
    
    if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    
    // Detect address changes
    const addressChanged =
        (current?.address ?? "") !== (b.address ?? "") ||
        (current?.apt ?? "") !== (b.apt ?? "") ||
        (current?.city ?? "") !== (b.city ?? "") ||
        (current?.state ?? "") !== (b.state ?? "") ||
        (current?.zip ?? "") !== (b.zip ?? "");
    
    // Determine final coordinates
    let finalLat = clearGeocode ? null : (b.lat !== undefined ? Number(b.lat) : null);
    let finalLng = clearGeocode ? null : (b.lng !== undefined ? Number(b.lng) : null);
    
    // Geocode if needed
    if (!clearGeocode && (finalLat == null || finalLng == null)) {
        const result = await geocodeIfNeeded(
            {
                address: b.address ?? current.address,
                apt: b.apt ?? current.apt,
                city: b.city ?? current.city,
                state: b.state ?? current.state,
                zip: b.zip ?? current.zip,
            },
            addressChanged
        );
        if (result && result.lat && result.lng) {
            finalLat = Number(result.lat);
            finalLng = Number(result.lng);
        }
    }
    
    // Build update payload
    const payload: any = {};
    
    if (b.first !== undefined) payload.first_name = b.first;
    if (b.last !== undefined) payload.last_name = b.last;
    if (b.address !== undefined) payload.address = b.address ?? null;
    if (b.apt !== undefined) payload.apt = b.apt ?? null;
    if (b.city !== undefined) payload.city = b.city ?? null;
    if (b.state !== undefined) payload.state = b.state ?? null;
    if (b.zip !== undefined) payload.zip = b.zip ?? null;
    if (b.phone !== undefined) payload.phone_number = b.phone ?? null;
    if (b.dislikes !== undefined) payload.dislikes = b.dislikes ?? null;
    if (b.paused !== undefined) payload.paused = b.paused;
    if (b.delivery !== undefined) payload.delivery = b.delivery;
    if (b.complex !== undefined) payload.complex = b.complex;
    if (finalLat !== undefined) payload.lat = finalLat;
    if (finalLng !== undefined) payload.lng = finalLng;
    
    if (Object.keys(payload).length > 0) {
        await supabase
            .from('clients')
            .update(payload)
            .eq('id', userId);
    }
    
    // Cascade to stops if needed
    if (cascadeStopsFlag && (finalLat !== null || finalLng !== null)) {
        const stopPayload: any = {};
        
        if (b.first !== undefined || b.last !== undefined) {
            const firstName = b.first ?? current?.first_name ?? "";
            const lastName = b.last ?? current?.last_name ?? "";
            stopPayload.name = `${firstName} ${lastName}`.trim();
        }
        if (b.address !== undefined) stopPayload.address = b.address ?? null;
        if (b.apt !== undefined) stopPayload.apt = b.apt ?? null;
        if (b.city !== undefined) stopPayload.city = b.city ?? null;
        if (b.state !== undefined) stopPayload.state = b.state ?? null;
        if (b.zip !== undefined) stopPayload.zip = b.zip ?? null;
        if (b.phone !== undefined) stopPayload.phone = b.phone ?? null;
        if (finalLat !== null) stopPayload.lat = finalLat;
        if (finalLng !== null) stopPayload.lng = finalLng;
        
        if (Object.keys(stopPayload).length > 0) {
            const { error } = await supabase
                .from('stops')
                .update(stopPayload)
                .eq('client_id', userId);
            if (error) {
                console.error("Failed to cascade to stops:", error);
            }
        }
    }
    
    // Return updated client
    const { data: updated } = await supabase
        .from('clients')
        .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, complex')
        .eq('id', userId)
        .single();
    
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    
    return NextResponse.json({
        id: updated.id,
        first: updated.first_name || "",
        last: updated.last_name || "",
        address: updated.address || "",
        apt: updated.apt || null,
        city: updated.city || "",
        state: updated.state || "",
        zip: updated.zip || "",
        phone: updated.phone_number || null,
        lat: updated.lat ? Number(updated.lat) : null,
        lng: updated.lng ? Number(updated.lng) : null,
        dislikes: updated.dislikes || null,
        paused: Boolean(updated.paused),
        delivery: updated.delivery !== undefined ? Boolean(updated.delivery) : true,
        complex: Boolean(updated.complex),
    });
}

