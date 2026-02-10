import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign',
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
