import { NextRequest, NextResponse } from 'next/server';
import { addClient, addPlaceholderDependents, getProduceVendors, getStatuses, getNavigators } from '@/lib/actions';
import { sendEmail } from '@/lib/email';
import { ServiceType, type ClientProfile } from '@/lib/types';
import { isValidUniteUsUrl } from '@/lib/utils';

export const runtime = 'nodejs';

/** Same support address used elsewhere (e.g. cron notifications). */
const BROOKLYN_NOTIFY_TO = ['customersupport@thedietfantasy.com', 'hshloimie@gmail.com'].join(', ');

function escapeHtml(s: string | null | undefined): string {
    if (s === null || s === undefined || s === '') return '—';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtBool(v: boolean | null | undefined): string {
    return v ? 'Yes' : 'No';
}

async function sendBrooklynNewClientNotification(
    client: ClientProfile,
    opts: { dependentsCreated: number; produceVendorName: string | null }
): Promise<void> {
    try {
        const [statuses, navigators] = await Promise.all([getStatuses(), getNavigators()]);
        const statusName = statuses.find((s) => s.id === client.statusId)?.name ?? client.statusId;
        const navigatorName = navigators.find((n) => n.id === client.navigatorId)?.name ?? client.navigatorId;

        const serviceLabelRaw =
            client.serviceType === 'Produce' && opts.produceVendorName
                ? `Produce — ${opts.produceVendorName}`
                : String(client.serviceType ?? '');

        const caseUrlRaw = client.caseIdExternal?.trim() || '';
        const caseCellHtml =
            caseUrlRaw && /^https:\/\//i.test(caseUrlRaw)
                ? `<a href="${escapeHtml(caseUrlRaw)}">${escapeHtml(caseUrlRaw)}</a>`
                : escapeHtml(caseUrlRaw || undefined);

        const rows: [string, string][] = [
            ['Client ID', escapeHtml(client.id)],
            ['Full name', escapeHtml(client.fullName)],
            ['Email', escapeHtml(client.email)],
            ['Phone', escapeHtml(client.phoneNumber)],
            ['Secondary phone', escapeHtml(client.secondaryPhoneNumber)],
            ['Street address', escapeHtml(client.address)],
            ['Apt', escapeHtml(client.apt)],
            ['City', escapeHtml(client.city)],
            ['State', escapeHtml(client.state)],
            ['ZIP', escapeHtml(client.zip)],
            ['County', escapeHtml(client.county)],
            ['Date of birth', escapeHtml(client.dob)],
            ['Notes', escapeHtml(client.notes)],
            ['Dislikes / dietary', escapeHtml(client.dislikes)],
            ['Service', escapeHtml(serviceLabelRaw)],
            ['Produce vendor ID', escapeHtml(client.produceVendorId)],
            [
                'Auth units / week (Food)',
                escapeHtml(
                    client.approvedMealsPerWeek != null ? String(client.approvedMealsPerWeek) : undefined
                )
            ],
            [
                'Authorized amount',
                escapeHtml(client.authorizedAmount != null ? String(client.authorizedAmount) : undefined)
            ],
            ['Expiration date', escapeHtml(client.expirationDate)],
            ['Unite account', escapeHtml(client.uniteAccount ?? 'Brooklyn')],
            ['Status', escapeHtml(`${statusName} (${client.statusId})`)],
            ['Navigator', escapeHtml(`${navigatorName} (${client.navigatorId})`)],
            ['Case URL', caseCellHtml],
            ['Latitude', escapeHtml(client.lat != null ? String(client.lat) : undefined)],
            ['Longitude', escapeHtml(client.lng != null ? String(client.lng) : undefined)],
            ['Paused', escapeHtml(fmtBool(client.paused))],
            ['Complex', escapeHtml(fmtBool(client.complex))],
            ['Bill', escapeHtml(fmtBool(client.bill))],
            ['Delivery', escapeHtml(fmtBool(client.delivery))],
            ['Medicaid', escapeHtml(fmtBool(client.medicaid))]
        ];

        const tableRows = rows
            .map(
                ([label, val]) =>
                    `<tr><td style="padding:6px 14px 6px 0;font-weight:600;vertical-align:top;color:#334155;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top">${val}</td></tr>`
            )
            .join('');

        const depNote =
            opts.dependentsCreated > 0
                ? `<p style="margin:16px 0 0"><strong>Placeholder dependents created:</strong> ${opts.dependentsCreated} (names 1, 2, …)</p>`
                : '';

        const html = `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.45;color:#0f172a;max-width:640px">
<p style="margin:0 0 16px"><strong>New Brooklyn client</strong> — added via Chrome extension API.</p>
<table style="border-collapse:collapse;width:100%">${tableRows}</table>
${depNote}
</body></html>`;

        const subjectSafe = (client.fullName || 'Client').replace(/[\r\n]/g, ' ').slice(0, 200);
        const result = await sendEmail({
            to: BROOKLYN_NOTIFY_TO,
            subject: `[Brooklyn] New client: ${subjectSafe}`,
            html
        });
        if (!result.success) {
            console.error('[extension/create-client] Brooklyn notify email failed:', result.error);
        }
    } catch (e) {
        console.error('[extension/create-client] Brooklyn notify email error:', e);
    }
}

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
 *   uniteAccount: 'Regular' | 'Brooklyn' (required)
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
            uniteAccount,
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
            delivery,
            dependentCount,
            produceVendorId,
            dob
        } = body;

        // Validate required fields
        if (!fullName || !fullName.trim() || !statusId || !navigatorId || !address || !phone || !serviceType || !caseId) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: fullName, statusId, navigatorId, address, phone, serviceType, and caseId are required'
            }, { status: 400 });
        }

        // Unite account is required (Regular or Brooklyn)
        const validUniteAccounts = ['Regular', 'Brooklyn'];
        if (!uniteAccount || typeof uniteAccount !== 'string' || !validUniteAccounts.includes(uniteAccount.trim())) {
            return NextResponse.json({
                success: false,
                error: 'uniteAccount is required and must be "Regular" or "Brooklyn"'
            }, { status: 400 });
        }

        // Extension only sends Food or Produce (produce = specific vendor from /api/extension/produce-vendors)
        if (serviceType !== 'Food' && serviceType !== 'Produce') {
            return NextResponse.json({
                success: false,
                error: 'serviceType must be "Food" or "Produce"'
            }, { status: 400 });
        }

        let resolvedProduceVendorId: string | null = null;
        let resolvedProduceVendorName: string | null = null;
        if (serviceType === 'Produce') {
            const vid = typeof produceVendorId === 'string' ? produceVendorId.trim() : '';
            if (!vid) {
                return NextResponse.json({
                    success: false,
                    error: 'produceVendorId is required when service type is Produce'
                }, { status: 400 });
            }
            const vendors = await getProduceVendors();
            const match = vendors.find((v) => v.id === vid && v.isActive);
            if (!match) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid or inactive produce vendor'
                }, { status: 400 });
            }
            resolvedProduceVendorId = vid;
            resolvedProduceVendorName = match.name;
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
            dob: typeof dob === 'string' && dob.trim() ? dob.trim().slice(0, 10) : null,
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
            uniteAccount: uniteAccount.trim(),
            caseIdExternal: caseId.trim(), // Store Unite Us link in case_id_external
            produceVendorId: resolvedProduceVendorId,
            activeOrder: {
                serviceType: serviceType as ServiceType,
                caseId: caseId.trim()
            }
        };

        const newClient = await addClient(clientData);

        let dependentsCreated = 0;
        const rawCount = dependentCount !== undefined && dependentCount !== null ? Number(dependentCount) : 0;
        const n = Number.isFinite(rawCount) ? Math.floor(rawCount) : 0;
        if (n > 0) {
            if (n > 50) {
                return NextResponse.json({
                    success: false,
                    error: 'dependentCount cannot exceed 50'
                }, { status: 400 });
            }
            await addPlaceholderDependents(newClient.id, n);
            dependentsCreated = n;
        }

        if (uniteAccount.trim() === 'Brooklyn') {
            await sendBrooklynNewClientNotification(newClient, {
                dependentsCreated,
                produceVendorName: resolvedProduceVendorName
            });
        }

        return NextResponse.json({
            success: true,
            dependentsCreated,
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

