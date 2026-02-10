import { CompletedDeliveriesList } from '@/components/clients/CompletedDeliveriesList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Completed Deliveries',
};

export default function CompletedDeliveriesPage() {
    return <CompletedDeliveriesList />;
}
