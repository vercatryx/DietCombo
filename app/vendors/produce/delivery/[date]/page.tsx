import { ProduceDeliveryOrders } from '@/components/vendors/ProduceDeliveryOrders';

export default async function ProduceDeliveryOrdersPage({ 
    params 
}: { 
    params: Promise<{ date: string }> 
}) {
    const { date } = await params;
    return <ProduceDeliveryOrders deliveryDate={date} />;
}
