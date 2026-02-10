import { ProduceDeliveryOrders } from '@/components/vendors/ProduceDeliveryOrders';
import type { Metadata } from 'next';

type Props = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  return { title: `Produce Delivery – ${date}` };
}

export default async function ProduceDeliveryOrdersPage({ params }: Props) {
    const { date } = await params;
    return <ProduceDeliveryOrders deliveryDate={date} />;
}
