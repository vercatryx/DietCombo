import { OrdersList } from '@/components/orders/OrdersList';
import { verifySession } from '@/lib/session';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Orders',
};

export default async function OrdersPage() {
    const session = await verifySession();
    return (
        <main style={{ padding: '2rem' }}>
            <OrdersList userRole={session?.role ?? ''} />
        </main>
    );
}
