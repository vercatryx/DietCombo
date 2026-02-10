import { NextRequest, NextResponse } from 'next/server';
import { saveClientFoodOrder, syncCurrentOrderToUpcoming, getClientProfilePageData } from '@/lib/actions';
import { ServiceType } from '@/lib/types';

/**
 * API Route: Create or update order for a client
 * 
 * POST /api/extension/create-order
 * 
 * Requires API key in Authorization header: Bearer <API_KEY>
 * 
 * Body:
 * {
 *   clientId: string (required)
 *   serviceType: 'Food' | 'Boxes' | 'Meal' | 'Custom' (required)
 *   caseId?: string (optional)
 *   deliveryDayOrders?: {
 *     [day: string]: {  // e.g. "Monday", "Tuesday", etc.
 *       vendorSelections: [{
 *         vendorId: string
 *         items: { [itemId: string]: number }  // itemId -> quantity
 *         itemNotes?: { [itemId: string]: string }
 *       }]
 *     }
 *   }
 * }
 */
export async function OPTIONS(request: NextRequest) {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    });
}

export async function POST(request: NextRequest) {
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

        const body = await request.json();
        const { clientId, serviceType, caseId, deliveryDayOrders } = body;

        // Validate required fields
        if (!clientId || !clientId.trim()) {
            return NextResponse.json({
                success: false,
                error: 'Missing required field: clientId'
            }, { status: 400 });
        }

        if (!serviceType) {
            return NextResponse.json({
                success: false,
                error: 'Missing required field: serviceType'
            }, { status: 400 });
        }

        // Validate serviceType
        const validServiceTypes = ['Food', 'Boxes', 'Meal', 'Equipment', 'Custom', 'Vendor', 'Produce'];
        if (!validServiceTypes.includes(serviceType)) {
            return NextResponse.json({
                success: false,
                error: `serviceType must be one of: ${validServiceTypes.join(', ')}`
            }, { status: 400 });
        }

        // Verify client exists
        const clientData = await getClientProfilePageData(clientId);
        if (!clientData || !clientData.c) {
            return NextResponse.json({
                success: false,
                error: 'Client not found'
            }, { status: 404 });
        }

        const client = clientData.c;

        // Build activeOrder structure
        const activeOrder: any = {
            serviceType: serviceType as ServiceType,
            ...(caseId && { caseId: caseId.trim() })
        };

        // For Food service, support deliveryDayOrders format
        if (serviceType === 'Food' && deliveryDayOrders) {
            // Validate deliveryDayOrders structure
            if (typeof deliveryDayOrders !== 'object' || Array.isArray(deliveryDayOrders)) {
                return NextResponse.json({
                    success: false,
                    error: 'deliveryDayOrders must be an object mapping day names to vendor selections'
                }, { status: 400 });
            }

            // Validate day names and structure
            const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            for (const [day, dayOrder] of Object.entries(deliveryDayOrders)) {
                if (!validDays.includes(day)) {
                    return NextResponse.json({
                        success: false,
                        error: `Invalid day name: ${day}. Must be one of: ${validDays.join(', ')}`
                    }, { status: 400 });
                }

                if (!dayOrder || typeof dayOrder !== 'object' || !('vendorSelections' in dayOrder) || !Array.isArray((dayOrder as any).vendorSelections)) {
                    return NextResponse.json({
                        success: false,
                        error: `Invalid structure for ${day}: must have vendorSelections array`
                    }, { status: 400 });
                }

                // Validate vendor selections
                for (const vs of (dayOrder as any).vendorSelections) {
                    if (!vs.vendorId || !vs.items || typeof vs.items !== 'object') {
                        return NextResponse.json({
                            success: false,
                            error: `Invalid vendor selection for ${day}: must have vendorId and items`
                        }, { status: 400 });
                    }
                }
            }

            activeOrder.deliveryDayOrders = deliveryDayOrders;
        }

        // Save the order
        if (serviceType === 'Food') {
            await saveClientFoodOrder(clientId, {
                caseId: caseId?.trim() || undefined,
                ...(deliveryDayOrders && { deliveryDayOrders })
            }, activeOrder);
        }

        // Sync to upcoming_orders table
        await syncCurrentOrderToUpcoming(clientId, {
            ...client,
            activeOrder: activeOrder
        }, false);

        return NextResponse.json({
            success: true,
            message: 'Order created/updated successfully',
            clientId: clientId,
            serviceType: serviceType,
            deliveryDays: deliveryDayOrders ? Object.keys(deliveryDayOrders) : []
        }, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });

    } catch (error: any) {
        console.error('Error creating/updating order:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to create/update order'
        }, { status: 500 });
    }
}
