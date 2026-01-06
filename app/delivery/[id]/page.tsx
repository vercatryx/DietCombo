import { createClient } from '@supabase/supabase-js';
import { OrderDeliveryFlow } from './OrderDeliveryFlow';
import { notFound } from 'next/navigation';
import '../delivery.css';
import '../delivery.css';

export default async function OrderDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Use Service Role to bypass RLS for public delivery page
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify if it is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // Fetch order details
    let query = supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, delivery_proof_url');

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

    if (!order) {
        // Try upcoming_orders
        let upcomingQuery = supabaseAdmin
            .from('upcoming_orders')
            .select('id, order_number, client_id, scheduled_delivery_date, delivery_proof_url');

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

        const { data: upcomingOrder } = await upcomingQuery.maybeSingle();
        if (upcomingOrder) {
            order = {
                ...upcomingOrder,
                // delivery_proof_url matches column name now
            };
            isUpcoming = true;
        }
    }

    if (orderError || !order) {
        return (
            <main className="delivery-page">
                <div className="delivery-container text-center">
                    <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <h1 className="text-title">Order Not Found</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem' }}>
                        We couldn't find order <span style={{ fontFamily: 'monospace', color: 'white' }}>#{id}</span>. Please check the number and try again.
                    </p>
                    <a href="/delivery" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Number
                    </a>
                </div>
            </main>
        );
    }

    // Fetch Client Name/Address
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('full_name, address')
        .eq('id', order.client_id)
        .single();

    const orderDetails = {
        id: order.id,
        orderNumber: order.order_number,
        clientName: client?.full_name || 'Unknown Client',
        address: client?.address || 'Unknown Address',
        deliveryDate: order.scheduled_delivery_date,
        alreadyDelivered: !!order.delivery_proof_url
    };

    return (
        <main className="delivery-page">
            <h1 className="text-subtitle" style={{ marginBottom: '1.5rem', opacity: 0.7 }}>Driver Delivery App</h1>
            <div className="delivery-container">
                <OrderDeliveryFlow order={orderDetails} />
            </div>
        </main>
    );
}
