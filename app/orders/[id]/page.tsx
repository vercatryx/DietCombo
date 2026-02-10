import { getOrderById } from '@/lib/actions-orders-billing';
import { notFound } from 'next/navigation';
import { OrderDetailView } from '@/components/orders/OrderDetailView';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) return { title: 'Order' };
  const num = order.orderNumber ?? order.id;
  return { title: `Order #${num}` };
}

export default async function OrderDetailPage({ params }: Props) {
    const { id } = await params;

    const order = await getOrderById(id);
    if (!order) notFound();

    return <OrderDetailView order={order} />;
}






