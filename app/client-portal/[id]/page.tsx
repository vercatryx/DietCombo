import {
  getClient,
  getStatuses,
  getNavigators,
  getVendors,
  getMenuItems,
  getBoxTypes,
  getCategories,
  getActiveOrderForClient,
  getOrderHistory,
  getClientMealPlannerData
} from '@/lib/actions';
import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { notFound, redirect } from 'next/navigation';
import { logout } from '@/lib/auth-actions';
import { LogOut } from 'lucide-react';
import type { Metadata } from 'next';
import { getSession } from '@/lib/session';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) return { title: 'Client Portal' };
  return { title: `${client.fullName} – Portal` };
}

export default async function ClientPortalPage({ params }: Props) {
  const { id } = await params;

  // Clients may only view their own portal — redirect to their page if they try another
  const session = await getSession();
  if (session?.role === 'client' && session.userId !== id) {
    redirect(`/client-portal/${session.userId}`);
  }

  // Use getClient (same as client profile) so client.activeOrder comes from clients.upcoming_order
  const client = await getClient(id);
  if (!client) {
    notFound();
  }

  // Upcoming order from same source as profile: clients.upcoming_order via client.activeOrder
  const upcomingOrder = client.activeOrder ?? null;

  // Portal-specific data fetch (independent of admin getClientProfilePageData)
  const [
    statuses,
    navigators,
    vendors,
    menuItems,
    boxTypes,
    categories,
    activeOrder,
    previousOrders,
    mealPlanData
  ] = await Promise.all([
    getStatuses(),
    getNavigators(),
    getVendors(),
    getMenuItems(),
    getBoxTypes(),
    getCategories(),
    getActiveOrderForClient(id),
    getOrderHistory(id),
    client.serviceType === 'Food' ? getClientMealPlannerData(id) : Promise.resolve([])
  ]);

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
        previousOrders={previousOrders ?? []}
        orderAndMealPlanOnly={true}
        initialMealPlanOrders={Array.isArray(mealPlanData) ? mealPlanData : null}
      />
    </div>
  );
}
