import { ClientProfileDetail } from '@/components/clients/ClientProfile';
import { getSession } from '@/lib/session';
import { getClientProfilePageData, getClient } from '@/lib/actions';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (id === 'new') return { title: 'New Client' };
  const client = await getClient(id);
  const name = client?.fullName ?? 'Client';
  return { title: name };
}

export default async function ClientProfilePage({ params }: Props) {
    const { id } = await params;
    const session = await getSession();
    const currentUser = session ? { role: session.role, id: session.userId } : null;

    if (id === 'new') {
        return (
            <ClientProfileDetail
                clientId="new"
                currentUser={currentUser}
            />
        );
    }

    const payload = await getClientProfilePageData(id);
    if (!payload) {
        return (
            <ClientProfileDetail
                clientId={id}
                currentUser={currentUser}
            />
        );
    }

    const initialData = {
        client: payload.c,
        history: payload.historyData,
        orderHistory: payload.orderHistoryData,
        billingHistory: payload.billingHistoryData,
        activeOrder: payload.activeOrderData,
        upcomingOrder: payload.upcomingOrderDataInitial,
        submissions: payload.submissions ?? [],
        mealPlanData: payload.mealPlanData ?? []
    };

    return (
        <ClientProfileDetail
            clientId={id}
            initialData={initialData}
            statuses={payload.s ?? []}
            navigators={payload.n ?? []}
            vendors={payload.v ?? []}
            menuItems={payload.m ?? []}
            boxTypes={payload.b ?? []}
            currentUser={currentUser}
            initialSettings={payload.appSettings ?? null}
            initialCategories={payload.catData}
            initialAllClients={payload.allClientsData?.filter((c): c is NonNullable<typeof c> => c != null) ?? []}
            initialRegularClients={payload.regularClientsData?.filter((c): c is NonNullable<typeof c> => c != null) ?? []}
            initialDependents={payload.dependentsData}
        />
    );
}
