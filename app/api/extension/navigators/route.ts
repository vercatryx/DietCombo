import { NextRequest, NextResponse } from 'next/server';
import { getNavigators } from '@/lib/actions';

/**
 * API Route: Get available navigators for Chrome extension
 * 
 * GET /api/extension/navigators
 * 
 * Requires API key in Authorization header: Bearer <API_KEY>
 */
export async function OPTIONS(request: NextRequest) {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    });
}

export async function GET(request: NextRequest) {
    try {
        // Check API key
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

        const providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix
        if (providedKey !== apiKey) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key'
            }, { status: 401 });
        }

        const navigators = await getNavigators();

        return NextResponse.json({
            success: true,
            navigators: navigators.filter(n => n.isActive) // Only return active navigators
        }, { 
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });

    } catch (error: any) {
        console.error('Error fetching navigators:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to fetch navigators'
        }, { status: 500 });
    }
}

