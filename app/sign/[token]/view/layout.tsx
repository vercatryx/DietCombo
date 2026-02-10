import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'View Signatures',
};

export default function SignViewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
