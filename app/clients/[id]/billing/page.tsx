import { BillingDetail } from '@/components/clients/BillingDetail';
import { getClient } from '@/lib/actions';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  const name = client?.fullName ?? 'Client';
  return { title: `${name} – Billing` };
}

export default async function Page({ params }: Props) {
    const { id } = await params;
    return <BillingDetail clientId={id} />;
}
