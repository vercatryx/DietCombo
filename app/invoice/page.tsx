import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getSession } from '@/lib/session';
import { InvoicePageClient } from '@/components/invoice/InvoicePageClient';

export const metadata: Metadata = {
    title: 'Invoice',
};

function InvoiceFallback() {
    return (
        <div style={{ padding: '2rem', color: '#334155' }}>
            Loading invoice…
        </div>
    );
}

export default async function InvoicePage() {
    const session = await getSession();
    const brooklynOnly = session?.role === 'brooklyn_admin';
    return (
        <Suspense fallback={<InvoiceFallback />}>
            <InvoicePageClient brooklynOnly={!!brooklynOnly} />
        </Suspense>
    );
}
