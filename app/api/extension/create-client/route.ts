import { NextRequest, NextResponse } from 'next/server';
import { addClient } from '@/lib/actions';
import { ServiceType } from '@/lib/types';
import { isValidUniteUsUrl } from '@/lib/utils';

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
            firstName,
            lastName,
            statusId,
            navigatorId,
            address,
            apt,
            city,
            state,
            zip,
            county,
            phone,
            secondaryPhone,
            email,
            notes,
            dislikes,
            serviceType,
            caseId,
            approvedMealsPerWeek,
            authorizedAmount,
            expirationDate,
            latitude,
            longitude,
            lat,
            lng,
            medicaid,
            paused,
            complex,
            bill,
            delivery
        } = body;

        // Validate required fields
        if (!fullName || !fullName.trim() || !statusId || !navigatorId || !address || !phone || !serviceType || !caseId) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: fullName, statusId, navigatorId, address, phone, serviceType, and caseId are required'
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

        // Validate case URL format
        if (!isValidUniteUsUrl(caseId)) {
            return NextResponse.json({
                success: false,
                error: 'Please make sure you are on the clients open case page or enter the real case url'
            }, { status: 400 });
        }

        // Geocode address if coordinates not provided
        let finalLat = lat ?? latitude ?? null;
        let finalLng = lng ?? longitude ?? null;
        
        if (!finalLat || !finalLng) {
            // Try to geocode the address
            try {
                const { geocodeIfNeeded } = await import('@/lib/geocodeOneClient');
                const addressInput = {
                    address: address.trim(),
                    apt: apt?.trim() || null,
                    city: city?.trim() || null,
                    state: state?.trim() || null,
                    zip: zip?.trim() || null
                };
                const geocodeResult = await geocodeIfNeeded(addressInput, true);
                if (geocodeResult) {
                    finalLat = geocodeResult.lat;
                    finalLng = geocodeResult.lng;
                }
            } catch (geocodeError) {
                console.warn('Geocoding failed, continuing without coordinates:', geocodeError);
            }
        }

        // Create client data
        const clientData = {
            fullName: fullName.trim(),
            firstName: firstName?.trim() || null,
            lastName: lastName?.trim() || null,
            email: email?.trim() || null,
            address: address.trim(),
            apt: apt?.trim() || null,
            city: city?.trim() || null,
            state: state?.trim()?.toUpperCase() || null,
            zip: zip?.trim() || null,
            county: county?.trim() || null,
            phoneNumber: phone.trim(),
            secondaryPhoneNumber: secondaryPhone?.trim() || null,
            navigatorId: navigatorId,
            endDate: '',
            screeningTookPlace: false,
            screeningSigned: false,
            notes: notes?.trim() || '',
            dislikes: dislikes?.trim() || null,
            statusId: statusId,
            serviceType: serviceType as ServiceType,
            approvedMealsPerWeek: approvedMealsPerWeek ? parseInt(approvedMealsPerWeek.toString(), 10) : 0,
            authorizedAmount: authorizedAmount !== undefined && authorizedAmount !== null ? parseFloat(authorizedAmount.toString()) : null,
            expirationDate: expirationDate?.trim() || null,
            latitude: finalLat,
            longitude: finalLng,
            lat: finalLat,
            lng: finalLng,
            geocodedAt: (finalLat && finalLng) ? new Date().toISOString() : null,
            medicaid: medicaid ?? false,
            paused: paused ?? false,
            complex: complex ?? false,
            bill: bill ?? true,
            delivery: delivery ?? true,
            caseIdExternal: caseId.trim(), // Store Unite Us link in case_id_external
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

