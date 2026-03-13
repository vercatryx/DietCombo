import { getClient, getClientPortalPageData } from '@/lib/actions';
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

export default async function AdminClientPortalPage({ params }: Props) {
  const { id } = await params;

  // Admin-only: only admin and super-admin may view this page
  const session = await getSession();
  if (session?.role !== 'admin' && session?.role !== 'super-admin') {
    redirect('/clients');
  }

  const payload = await getClientPortalPageData(id);
  if (!payload) {
    notFound();
  }

  const { client, householdPeople, statuses, navigators, vendors, menuItems, boxTypes, categories, activeOrder, previousOrders, mealPlanData } = payload;

  // Produce clients cannot use the client portal (e.g. admin opened their URL)
  if (client.serviceType === 'Produce') {
    return (
      <div style={{ padding: '20px', maxWidth: '480px', margin: '2rem auto', textAlign: 'center' }}>
        <div style={{
          padding: '24px',
          background: 'var(--bg-surface)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
        }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
            Portal not available
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
            Produce account holders cannot sign in or access the client portal. Please contact support.
          </p>
          <form action={logout}>
            <button
              type="submit"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-app)',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: 500,
                color: 'var(--text-secondary)'
              }}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // For Food clients, portal uses only day-based meal plan (clients.meal_planner_data). Do not pass
  // upcoming_order so we never read or write it for the client's order.
  const upcomingOrder = client.serviceType === 'Food' ? null : (client.activeOrder ?? null);

  if (client.serviceType === 'Food' && Array.isArray(mealPlanData)) {
    console.log('[MealPlan Step 0] client-portal page: mealPlanData (initialMealPlanOrders) length=', mealPlanData.length, 'first order items=', mealPlanData[0]?.items?.length ?? 0, 'first order item ids sample=', mealPlanData[0]?.items?.slice(0, 2).map((i: any) => i?.id) ?? []);
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

      <ClientPortalInterface
        client={client}
        householdPeople={householdPeople}
        statuses={statuses}
        navigators={navigators}
        vendors={vendors}
        menuItems={menuItems}
        boxTypes={boxTypes}
        categories={categories}
        upcomingOrder={upcomingOrder}
        activeOrder={activeOrder}
        previousOrders={previousOrders}
        orderAndMealPlanOnly={true}
        initialMealPlanOrders={Array.isArray(mealPlanData) ? mealPlanData : null}
      />
    </div>
  );
}
