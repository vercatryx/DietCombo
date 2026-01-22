import { getOrderById } from '@/lib/actions';
import { notFound } from 'next/navigation';
import { OrderDetailView } from '@/components/orders/OrderDetailView';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    
    try {
        console.log('[OrderDetailPage] Fetching order with id:', id);
        const order = await getOrderById(id);
        console.log('[OrderDetailPage] Order result:', order ? 'found' : 'not found');

        if (!order) {
            console.warn('[OrderDetailPage] Order not found, calling notFound()');
            notFound();
        }

        return <OrderDetailView order={order} />;
    } catch (error) {
        console.error('[OrderDetailPage] Error fetching order:', error);
        notFound();
    }
}






