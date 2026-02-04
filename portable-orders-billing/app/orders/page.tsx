/**
 * Orders list page. Renders OrdersList component (client).
 * Route: /orders
 */
import { OrdersList } from '@/components/orders/OrdersList';

export default function OrdersPage() {
    return (
        <main style={{ padding: '2rem' }}>
            <OrdersList />
        </main>
    );
}
