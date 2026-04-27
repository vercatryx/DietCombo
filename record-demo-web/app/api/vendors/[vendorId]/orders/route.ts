import { NextRequest } from 'next/server';
import {
  buildSyntheticVendorOrders,
  demoVendorHandles,
  filterVendorOrdersByDeliveryDate,
} from '../../../../../lib/demo-vendor-orders';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  const { vendorId } = await params;
  const date = request.nextUrl.searchParams.get('date');

  if (!vendorId) {
    return Response.json({ error: 'vendorId required' }, { status: 400 });
  }

  if (!demoVendorHandles(vendorId)) {
    return Response.json({ error: 'Not available in record-demo' }, { status: 404 });
  }

  const all = buildSyntheticVendorOrders();
  const filtered = filterVendorOrdersByDeliveryDate(all, date ?? undefined);
  return Response.json(filtered);
}
