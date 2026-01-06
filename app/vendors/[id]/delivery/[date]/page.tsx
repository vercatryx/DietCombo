import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';

export default async function VendorDeliveryOrdersPage({ 
    params 
}: { 
    params: Promise<{ id: string; date: string }> 
}) {
    const { id, date } = await params;
    return <VendorDeliveryOrders vendorId={id} deliveryDate={date} />;
}

