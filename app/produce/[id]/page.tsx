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

    // Verify if it is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // Fetch order details
    let query = supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, proof_of_delivery_url');

    if (isUuid) {
        query = query.eq('id', id);
    } else {
        // Assume it's an order number - Parse as int for safety
        const idInt = parseInt(id, 10);
        if (!isNaN(idInt)) {
            query = query.eq('order_number', idInt);
        } else {
            // Fallback or prevent query if invalid number? 
            // If parse fails, it won't match anyway.
            query = query.eq('order_number', id);
        }
    }

    const { data: existingOrder, error: orderError } = await query.maybeSingle();

    let order = existingOrder;
    let isUpcoming = false;
    let upcomingOrderError = null;

    if (!order && !orderError) {
        // Try upcoming_orders
        // Note: upcoming_orders doesn't have a delivery_proof_url column
        let upcomingQuery = supabaseAdmin
            .from('upcoming_orders')
            .select('id, order_number, client_id, scheduled_delivery_date');

        if (isUuid) {
            upcomingQuery = upcomingQuery.eq('id', id);
        } else {
            const idInt = parseInt(id, 10);
            if (!isNaN(idInt)) {
                upcomingQuery = upcomingQuery.eq('order_number', idInt);
            } else {
                upcomingQuery = upcomingQuery.eq('order_number', id);
            }
        }

        const { data: upcomingOrder, error: upcomingErr } = await upcomingQuery.maybeSingle();
        upcomingOrderError = upcomingErr;
        
        if (upcomingOrder) {
            order = {
                ...upcomingOrder,
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
                    <h1 className="text-title">Order Not Found</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem' }}>
                        We couldn't find order <span style={{ fontFamily: 'monospace', color: 'white' }}>#{id}</span>. Please check the number and try again.
                    </p>
                    <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Number
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
