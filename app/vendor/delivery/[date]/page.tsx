import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

type Props = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  return { title: `Delivery – ${date}` };
}

export default async function VendorDeliveryPage({ params }: Props) {
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
