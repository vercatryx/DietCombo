import { OrdersList } from '@/components/orders/OrdersList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Orders',
};

export default function OrdersPage() {
    return (
        <main style={{ padding: '2rem' }}>
            <OrdersList />
        </main>
    );
}
