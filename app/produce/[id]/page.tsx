import { createClient } from '@supabase/supabase-js';
import { OrderProduceFlow } from './OrderProduceFlow';
import { notFound } from 'next/navigation';
import '../produce.css';
import '../produce.css';

export default async function OrderProducePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Use Service Role to bypass RLS for public produce page
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify if it is a UUID (client_id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!isUuid) {
        // Client ID must be a UUID
        return (
            <main className="produce-page">
                <div className="produce-container text-center">
                    <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <h1 className="text-title">Invalid Client ID</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem' }}>
                        Client ID must be a valid UUID format. Please check and try again.
                    </p>
                    <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Client ID
                    </a>
                </div>
            </main>
        );
    }

    // Fetch orders by client_id - get the most recent order that hasn't been processed
    // Priority: 1) Orders without proof_of_delivery_url, ordered by scheduled_delivery_date DESC
    //           2) If none, get the most recent order
    let order = null;
    let isUpcoming = false;
    let orderError = null;
    let upcomingOrderError = null;

    // First, try to get an unprocessed order (no proof_of_delivery_url)
    const { data: unprocessedOrders, error: unprocessedError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, proof_of_delivery_url')
        .eq('client_id', id)
        .is('proof_of_delivery_url', null)
        .order('scheduled_delivery_date', { ascending: false })
        .limit(1);

    if (unprocessedError) {
        orderError = unprocessedError;
    } else if (unprocessedOrders && unprocessedOrders.length > 0) {
        order = unprocessedOrders[0];
    } else {
        // If no unprocessed orders, get the most recent order for this client
        const { data: recentOrders, error: recentError } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, client_id, scheduled_delivery_date, proof_of_delivery_url')
            .eq('client_id', id)
            .order('scheduled_delivery_date', { ascending: false })
            .limit(1);

        if (recentError) {
            orderError = recentError;
        } else if (recentOrders && recentOrders.length > 0) {
            order = recentOrders[0];
        }
    }

    // If no order found in orders table, try upcoming_orders
    if (!order && !orderError) {
        const { data: upcomingOrders, error: upcomingErr } = await supabaseAdmin
            .from('upcoming_orders')
            .select('id, order_number, client_id, scheduled_delivery_date')
            .eq('client_id', id)
            .order('scheduled_delivery_date', { ascending: false })
            .limit(1);

        upcomingOrderError = upcomingErr;
        
        if (upcomingOrders && upcomingOrders.length > 0) {
            order = {
                ...upcomingOrders[0],
                // upcoming_orders doesn't have delivery_proof_url, so set it to null
                proof_of_delivery_url: null
            };
            isUpcoming = true;
        }
    }

    if (orderError || upcomingOrderError || !order) {
        return (
            <main className="produce-page">
                <div className="produce-container text-center">
                    <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <h1 className="text-title">No Order Found</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem' }}>
                        We couldn't find any orders for client ID <span style={{ fontFamily: 'monospace', color: 'white' }}>{id}</span>. Please check the client ID and try again.
                    </p>
                    <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Client ID
                    </a>
                </div>
            </main>
        );
    }

    // Fetch Client Name/Address and signature token
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('full_name, address, sign_token')
        .eq('id', order.client_id)
        .single();

    const orderDetails = {
        id: order.id,
        orderNumber: order.order_number,
        clientName: client?.full_name || 'Unknown Client',
        address: client?.address || 'Unknown Address',
        deliveryDate: order.scheduled_delivery_date,
        alreadyDelivered: !!(order.proof_of_delivery_url || (order as any).delivery_proof_url),
        clientSignToken: client?.sign_token || null
    };

    return (
        <main className="produce-page">
            <h1 className="text-subtitle" style={{ marginBottom: '1.5rem', opacity: 0.7 }}>Produce Order Processing App</h1>
            <div className="produce-container">
                <OrderProduceFlow order={orderDetails} />
            </div>
        </main>
    );
}
