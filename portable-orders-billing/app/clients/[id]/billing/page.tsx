/**
 * Client billing history page. Renders BillingDetail for one client.
 * Route: /clients/[id]/billing
 */
import { BillingDetail } from '@/components/clients/BillingDetail';

export default async function ClientBillingPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <BillingDetail clientId={id} />;
}
