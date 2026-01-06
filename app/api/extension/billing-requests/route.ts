import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
// We might need to use the service role key if we need access to restricted tables,
// but usually for reading orders/clients the anon key might suffice if RLS allows.
// However, since this is an extension/admin API, usually a service role is safer or ensuring we claim a user.
// Given strict RLS potentially, and this being a "system" API, let's stick to the pattern in other extension routes.
// Other extension routes use 'getStatuses' from 'lib/actions' which uses the default singleton supabase client
// which likely uses the anon key but might rely on RLS being open for public read or specific policies.
// For `billing_pending` orders which might be sensitive, we should probably check if `lib/actions` has a helper
// or just use a direct client. The user mentioned "orders whose status is billing pending".

// Let's grab the env vars for Supabase.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
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

        // --- Data Fetching ---

        // 1. Fetch Orders with status 'billing_pending' and join Clients
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select(`
                *,
                clients (
                    id,
                    full_name,
                    authorized_amount,
                    parent_client_id
                )
            `)
            .eq('status', 'billing_pending');

        if (ordersError) {
            console.error('Error fetching orders:', ordersError);
            throw new Error(ordersError.message);
        }

        if (!orders || orders.length === 0) {
            return NextResponse.json([]);
        }

        // 2. Fetch Dependents
        // We need to find dependents for any client involved in these orders.
        // A dependent is a client where parent_client_id is not null.
        // We want to find all clients where parent_client_id is in the list of client IDs we just returned.
        const clientIds = orders.map((o: any) => o.clients?.id).filter(Boolean);

        // Map to store dependents by parentClientId
        const dependentsMap: Record<string, any[]> = {};

        if (clientIds.length > 0) {
            const { data: dependents, error: dependentsError } = await supabase
                .from('clients')
                .select('id, full_name, dob, cin, parent_client_id')
                .in('parent_client_id', clientIds);

            if (dependentsError) {
                console.error('Error fetching dependents:', dependentsError);
                // We'll proceed without dependents if this fails, or maybe throw? Let's log and proceed empty.
            } else if (dependents) {
                dependents.forEach((dep: any) => {
                    const pid = dep.parent_client_id;
                    if (!dependentsMap[pid]) {
                        dependentsMap[pid] = [];
                    }
                    dependentsMap[pid].push(dep);
                });
            }
        }

        // 3. Format Response
        const billingRequests = orders.map((order: any) => {
            const client = order.clients || {};
            const dependents = dependentsMap[client.id] || [];

            // Format dependents
            const formattedDependents = dependents.map((d: any) => ({
                name: d.full_name,
                // Ensure date format is MM/DD/YYYY if possible, or ISO. User example: "05/29/2007"
                // DB likely returns YYYY-MM-DD. Let's try to format it.
                Birthday: formatDate(d.dob),
                CIN: d.cin ? String(d.cin) : ""
            }));

            // Determine date to show
            // User example: "2025-12-18". Prioritize actual_delivery_date, fallback to scheduled.
            const dateStr = order.actual_delivery_date || order.scheduled_delivery_date;

            // Determine amount
            // User: "amount": 336.
            // Logic: client.authorized_amount > 0 ? client.authorized_amount : order.total_value
            // Fallback to 0 if neither.
            const amount = client.authorized_amount ?? order.total_value ?? 0;

            return {
                name: client.full_name || "Unknown Client",
                url: order.case_id || "",
                orderNumber: order.order_number,
                // Assuming YYYY-MM-DD is acceptable for top level Date based on "2025-12-18" example
                date: dateStr || "",
                amount: Number(amount),
                proofURL: order.delivery_proof_url || "",
                dependants: formattedDependents
            };
        });

        return NextResponse.json(billingRequests);

    } catch (error: any) {
        console.error('Error in billing-requests API:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    }
}

function formatDate(isoDateString: string | null): string {
    if (!isoDateString) return "";
    try {
        // Assume YYYY-MM-DD coming from DB
        const [year, month, day] = isoDateString.split('-');
        if (year && month && day) {
            return `${month}/${day}/${year}`;
        }
        return isoDateString; // Fallback
    } catch (e) {
        return isoDateString || "";
    }
}
