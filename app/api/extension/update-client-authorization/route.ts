import { NextRequest, NextResponse } from 'next/server';
import { getClient, updateClient } from '@/lib/actions';

/**
 * API Route: Attach Authorized Amount and Expiration Date to a client
 *
 * POST /api/extension/update-client-authorization
 *
 * Requires API key in Authorization header: Bearer <API_KEY>
 *
 * Body:
 * {
 *   clientId: string (required)
 *   authorizedAmount?: number | null
 *   expirationDate?: string | null (ISO date or YYYY-MM-DD)
 * }
 */
export async function OPTIONS(request: NextRequest) {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        const apiKey = process.env.EXTENSION_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key not configured on server' },
                { status: 500 }
            );
        }

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { success: false, error: 'Missing or invalid authorization header' },
                { status: 401 }
            );
        }

        const providedKey = authHeader.substring(7);
        if (providedKey !== apiKey) {
            return NextResponse.json(
                { success: false, error: 'Invalid API key' },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { clientId, authorizedAmount, expirationDate } = body;

        if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
            return NextResponse.json(
                { success: false, error: 'clientId is required' },
                { status: 400 }
            );
        }

        const client = await getClient(clientId.trim());
        if (!client) {
            return NextResponse.json(
                { success: false, error: 'Client not found' },
                { status: 404 }
            );
        }

        if (authorizedAmount === undefined && expirationDate === undefined) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'At least one of authorizedAmount or expirationDate is required',
                },
                { status: 400 }
            );
        }

        const updateData: { authorizedAmount?: number | null; expirationDate?: string | null } = {};
        if (authorizedAmount !== undefined) {
            if (authorizedAmount !== null && (typeof authorizedAmount !== 'number' || Number.isNaN(authorizedAmount) || authorizedAmount < 0)) {
                return NextResponse.json(
                    { success: false, error: 'authorizedAmount must be a non-negative number or null' },
                    { status: 400 }
                );
            }
            updateData.authorizedAmount = authorizedAmount == null ? null : Number(authorizedAmount);
        }
        if (expirationDate !== undefined) {
            if (expirationDate !== null && expirationDate !== '') {
                const dateStr = typeof expirationDate === 'string' ? expirationDate.trim() : String(expirationDate);
                const parsed = new Date(dateStr);
                if (Number.isNaN(parsed.getTime())) {
                    return NextResponse.json(
                        { success: false, error: 'expirationDate must be a valid date string (e.g. YYYY-MM-DD or ISO) or null' },
                        { status: 400 }
                    );
                }
                updateData.expirationDate = parsed.toISOString().slice(0, 10);
            } else {
                updateData.expirationDate = null;
            }
        }

        const updated = await updateClient(clientId.trim(), updateData, { skipOrderSync: true });

        return NextResponse.json({
            success: true,
            client: {
                id: updated.id,
                fullName: updated.fullName,
                authorizedAmount: updated.authorizedAmount ?? null,
                expirationDate: updated.expirationDate ?? null,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('Error in update-client-authorization API:', error);
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
