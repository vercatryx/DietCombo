import { VendorDetail } from '@/components/vendors/VendorDetail';
import { getVendor, getOrdersByVendor } from '@/lib/actions';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const vendor = await getVendor(id);
  const name = vendor?.name ?? 'Vendor';
  return { title: name };
}

export default async function VendorDetailPage({ params }: Props) {
    const { id } = await params;
    const vendor = await getVendor(id);
    // Do NOT pass initialOrders from server - the vendor cccccccc-cccc-cccc-cccc-cccccccccccc
    // aggregates all orders and the payload causes "RangeError: Maximum call stack size exceeded"
    // at Map.set during RSC serialization/hydration. VendorDetail.loadData() fetches on client.
    return (
        <VendorDetail
            vendorId={id}
            vendor={vendor ?? undefined}
            initialOrders={[]}
        />
    );
}

