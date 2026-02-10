import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Routes',
};

export default function RoutesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
