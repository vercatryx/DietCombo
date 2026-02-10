import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Clients',
};

export default function Home() {
  redirect('/clients');
}
