import { VendorList } from '@/components/vendors/VendorList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendors',
};

export default function VendorsPage() {
    return <VendorList />;
}

