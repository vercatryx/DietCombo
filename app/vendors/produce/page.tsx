import { ProduceDetail } from '@/components/vendors/ProduceDetail';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendor Produce',
};

export default function ProducePage() {
    return <ProduceDetail />;
}
