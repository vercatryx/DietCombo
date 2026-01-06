
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getVendor } from '@/lib/actions';
import { VendorDetail } from '@/components/vendors/VendorDetail';

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
