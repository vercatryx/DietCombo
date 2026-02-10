import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify Order',
};

export default function VerifyOrderLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return <>{children}</>;
}
