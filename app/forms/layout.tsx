import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forms',
};

export default function FormsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
