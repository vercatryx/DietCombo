import { VendorDetail } from '@/components/vendors/VendorDetail';

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <VendorDetail vendorId={id} />;
}

