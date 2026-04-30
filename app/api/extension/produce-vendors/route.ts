import { NextRequest, NextResponse } from 'next/server';
import { getProduceVendors } from '@/lib/actions';

/**
 * GET /api/extension/produce-vendors
 *
 * Active produce vendors for the Chrome extension service dropdown (Food + vendor list).
 * Requires: Authorization: Bearer <EXTENSION_API_KEY>
 *
 * Does not expose vendor tokens.
 */
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        const apiKey = process.env.EXTENSION_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'API key not configured on server' }, { status: 500 });
        }

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ success: false, error: 'Missing or invalid authorization header' }, { status: 401 });
        }

        const providedKey = authHeader.substring(7);
        if (providedKey !== apiKey) {
            return NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 });
        }

        const all = await getProduceVendors();
        const produceVendors = all.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name }));

        return NextResponse.json(
            { success: true, produceVendors },
            {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            }
        );
    } catch (error: any) {
        console.error('Error fetching produce vendors for extension:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to fetch produce vendors' },
            { status: 500 }
        );
    }
}
