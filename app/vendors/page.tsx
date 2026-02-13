import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

const SINGLE_VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export const metadata: Metadata = {
  title: 'Vendors',
};

export default function VendorsPage() {
    redirect(`/vendors/${SINGLE_VENDOR_ID}`);
}

