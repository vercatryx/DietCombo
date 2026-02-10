import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Driver Delivery',
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
