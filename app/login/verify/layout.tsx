import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify Login',
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
