import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getVendor } from '@/lib/actions';
import { VendorDetail } from '@/components/vendors/VendorDetail';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendor Portal',
};

export default async function VendorPage() {
    const session = await getSession();

    // Verify session is valid and user is a vendor
    if (!session || session.role !== 'vendor') {
        redirect('/login');
    }

    const vendorId = session.userId;
    // Fetch vendor details securely server-side to pass to client component
    const vendorData = await getVendor(vendorId);

    return (
        <VendorDetail
            vendorId={vendorId}
            isVendorView={true}
            vendor={vendorData || undefined}
        />
    );
}
