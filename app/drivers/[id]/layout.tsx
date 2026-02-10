import { supabase } from '@/lib/supabase';
import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { data: driver } = await supabase.from('drivers').select('name').eq('id', id).single();
  if (driver?.name) return { title: `Route ${driver.name}` };
  const { data: route } = await supabase.from('routes').select('name').eq('id', id).single();
  const name = route?.name ?? 'Route';
  return { title: `Route ${name}` };
}

export default function DriverRouteLayout({ children }: Props) {
  return <>{children}</>;
}
