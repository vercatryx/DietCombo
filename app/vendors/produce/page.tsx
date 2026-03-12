import { Suspense } from 'react';
import { ProduceDetail } from '@/components/vendors/ProduceDetail';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vendor Produce',
};

export default function ProducePage() {
    return (
        <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
            <ProduceDetail />
        </Suspense>
    );
}
