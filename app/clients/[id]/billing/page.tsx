import { BillingDetail } from '@/components/clients/BillingDetail';

export default function Page({ params }: { params: { id: string } }) {
    return <BillingDetail clientId={params.id} />;
}
