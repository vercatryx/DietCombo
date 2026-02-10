import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';
import { getVendor } from '@/lib/actions';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string; date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, date } = await params;
  const vendor = await getVendor(id);
  const name = vendor?.name ?? 'Vendor';
  return { title: `${name} – Delivery ${date}` };
}

export default async function VendorDeliveryOrdersPage({ params }: Props) {
    const { id, date } = await params;
    return <VendorDeliveryOrders vendorId={id} deliveryDate={date} />;
}

