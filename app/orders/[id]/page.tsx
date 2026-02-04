import { getOrderById } from '@/lib/actions-orders-billing';
import { notFound } from 'next/navigation';
import { OrderDetailView } from '@/components/orders/OrderDetailView';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const order = await getOrderById(id);
    if (!order) notFound();

    return <OrderDetailView order={order} />;
}






