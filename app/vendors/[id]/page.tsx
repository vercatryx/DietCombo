import { VendorDetail } from '@/components/vendors/VendorDetail';
import { getVendor } from '@/lib/actions';
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
    return <VendorDetail vendorId={id} />;
}

