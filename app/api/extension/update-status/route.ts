import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
    try {
        // --- Authentication ---
        const authHeader = request.headers.get('authorization');
        const apiKey = process.env.EXTENSION_API_KEY;

        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'API key not configured on server'
            }, { status: 500 });
        }

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({
                success: false,
                error: 'Missing or invalid authorization header'
            }, { status: 401 });
        }

        const providedKey = authHeader.substring(7);
        if (providedKey !== apiKey) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key'
            }, { status: 401 });
        }

        // --- Input Parsing ---
        const body = await request.json();
        const { orderNumber, status } = body;

        if (!orderNumber) {
            return NextResponse.json({
                success: false,
                error: 'Missing orderNumber'
            }, { status: 400 });
        }

        if (!status) {
            return NextResponse.json({
                success: false,
                error: 'Missing status'
            }, { status: 400 });
        }

        // --- Update Logic ---
        const { data, error } = await supabase
            .from('orders')
            .update({ status: status })
            .eq('order_number', orderNumber)
            .select();

        if (error) {
            console.error('Error updating order status:', error);
            return NextResponse.json({
                success: false,
                error: error.message
            }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'Order not found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            order: data[0]
        });

    } catch (error: any) {
        console.error('Error in update-status API:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    }
}
