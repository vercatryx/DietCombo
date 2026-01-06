
import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function VendorDeliveryPage({
    params
}: {
    params: Promise<{ date: string }>
}) {
    const session = await getSession();
    if (!session || session.role !== 'vendor') {
        redirect('/login');
    }

    // Vendor can only see their own orders
    const vendorId = session.userId;
    const { date } = await params;

    return (
        <VendorDeliveryOrders
            vendorId={vendorId}
            deliveryDate={date}
            isVendorView={true}
        />
    );
}
