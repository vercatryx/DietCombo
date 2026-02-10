import { BillingList } from '@/components/billing/BillingList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Billing',
};

export default function BillingPage() {
    return <BillingList />;
}
