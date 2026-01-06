import { NextRequest, NextResponse } from 'next/server';
import { addClient } from '@/lib/actions';
import { ServiceType } from '@/lib/types';

/**
 * API Route: Create a new client from Chrome extension
 * 
 * POST /api/extension/create-client
 * 
 * Requires API key in Authorization header: Bearer <API_KEY>
 * 
 * Body:
 * {
 *   fullName: string
 *   statusId: string
 *   navigatorId?: string
 *   address: string
 *   phone: string
 *   email?: string
 *   notes?: string
 *   serviceType: 'Food' | 'Boxes'
 *   caseId: string (required, must be valid case URL)
 *   approvedMealsPerWeek?: number
 *   authorizedAmount?: number | null
 *   expirationDate?: string | null (ISO date string or YYYY-MM-DD format)
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
        const {
            fullName,
            statusId,
            navigatorId,
            address,
            phone,
            secondaryPhone,
            email,
            notes,
            serviceType,
            caseId,
            approvedMealsPerWeek,
            authorizedAmount,
            expirationDate
        } = body;

        // Validate required fields
        if (!fullName || !statusId || !navigatorId || !address || !phone || !serviceType || !caseId) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: fullName, statusId, navigatorId, address, phone, serviceType, and caseId are required'
            }, { status: 400 });
        }

        // Validate serviceType
        if (serviceType !== 'Food' && serviceType !== 'Boxes') {
            return NextResponse.json({
                success: false,
                error: 'serviceType must be either "Food" or "Boxes"'
            }, { status: 400 });
        }

        // Validate case URL format
        const caseUrlPattern = /^https:\/\/app\.uniteus\.io\/dashboard\/cases\/open\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/contact\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!caseUrlPattern.test(caseId.trim())) {
            return NextResponse.json({
                success: false,
                error: 'Please make sure you are on the clients open case page or enter the real case url'
            }, { status: 400 });
        }

        // Create client data
        const clientData = {
            fullName: fullName.trim(),
            email: email?.trim() || null,
            address: address.trim(),
            phoneNumber: phone.trim(),
            secondaryPhoneNumber: secondaryPhone?.trim() || null,
            navigatorId: navigatorId,
            endDate: '',
            screeningTookPlace: false,
            screeningSigned: false,
            notes: notes?.trim() || '',
            statusId: statusId,
            serviceType: serviceType as ServiceType,
            approvedMealsPerWeek: approvedMealsPerWeek ? parseInt(approvedMealsPerWeek.toString(), 10) : 0,
            authorizedAmount: authorizedAmount !== undefined && authorizedAmount !== null ? parseFloat(authorizedAmount.toString()) : null,
            expirationDate: expirationDate?.trim() || null,
            activeOrder: {
                serviceType: serviceType as ServiceType,
                caseId: caseId.trim()
            }
        };

        const newClient = await addClient(clientData);

        return NextResponse.json({
            success: true,
            client: {
                id: newClient.id,
                fullName: newClient.fullName,
                email: newClient.email,
                address: newClient.address,
                phoneNumber: newClient.phoneNumber
            }
        }, {
            status: 201,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });

    } catch (error: any) {
        console.error('Error creating client:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to create client'
        }, { status: 500 });
    }
}

