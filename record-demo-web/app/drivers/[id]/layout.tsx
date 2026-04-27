import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Driver route',
};

export default function DriverDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
