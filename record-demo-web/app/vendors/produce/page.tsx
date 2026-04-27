import { Suspense } from 'react';
import { ProduceDetail } from '@/components/vendors/ProduceDetail';

export default function ProducePage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
      <ProduceDetail />
    </Suspense>
  );
}
