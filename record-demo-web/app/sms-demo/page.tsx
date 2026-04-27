import type { Metadata } from 'next';
import { SmsDemoView } from '../../components/sms-demo/SmsDemoView';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Record-only SMS simulation.',
};

export default function SmsDemoPage() {
  return <SmsDemoView />;
}
