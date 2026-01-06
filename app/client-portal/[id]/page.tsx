import { getPublicClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getCategories, getUpcomingOrderForClient, getActiveOrderForClient, getOrderHistory } from '@/lib/actions';
import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { notFound } from 'next/navigation';
import { logout } from '@/lib/auth-actions';
import { LogOut } from 'lucide-react';

export default async function ClientPortalPage({ params }: { params: { id: string } }) {
    const { id } = await params;

    // Fetch all data in parallel - matching ClientProfile pattern
    const [
        client,
        statuses,
        navigators,
        vendors,
        menuItems,
        boxTypes,
        categories,
        upcomingOrder,
        activeOrder,
        previousOrders
    ] = await Promise.all([
        getPublicClient(id),
        getStatuses(),
        getNavigators(),
        getVendors(),
        getMenuItems(),
        getBoxTypes(),
        getCategories(),
        getUpcomingOrderForClient(id),
        getActiveOrderForClient(id),
        getOrderHistory(id)
    ]);

    if (!client) {
        notFound();
    }

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 32, height: 32, background: 'var(--primary)', borderRadius: '8px' }} />
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Client Portal</h1>
                </div>
                <form action={logout}>
                    <button
                        type="submit"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 500,
                            color: 'var(--text-secondary)',
                            transition: 'all 0.2s'
                        }}
                    >
                        <LogOut size={16} />
                        Log out
                    </button>
                </form>
            </div>

            <div style={{ marginBottom: '30px' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '10px' }}>Hello, {client.fullName}</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Manage your service and orders below.</p>
            </div>

            <ClientPortalInterface
                client={client}
                statuses={statuses}
                navigators={navigators}
                vendors={vendors}
                menuItems={menuItems}
                boxTypes={boxTypes}
                categories={categories}
                upcomingOrder={upcomingOrder}
                activeOrder={activeOrder}
                previousOrders={previousOrders || []}
            />
        </div>
    );
}
