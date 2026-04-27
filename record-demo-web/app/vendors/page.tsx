import { redirect } from 'next/navigation';

const SINGLE_VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export default function VendorsPage() {
  redirect(`/vendors/${SINGLE_VENDOR_ID}`);
}
