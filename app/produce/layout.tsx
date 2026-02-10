import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Produce Orders',
};

export default function ProduceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
