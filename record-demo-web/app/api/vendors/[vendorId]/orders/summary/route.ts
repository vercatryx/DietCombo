import { NextRequest } from 'next/server';
import {
  buildVendorOrderSummaryAll,
  buildVendorOrderSummarySince,
  demoVendorHandles,
} from '../../../../../../lib/demo-vendor-orders';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  const { vendorId } = await params;

  if (!vendorId) {
    return Response.json({ error: 'vendorId required' }, { status: 400 });
  }

  if (!demoVendorHandles(vendorId)) {
    return Response.json({ error: 'Not available in record-demo' }, { status: 404 });
  }

  const since = request.nextUrl.searchParams.get('since');
  if (since) {
    return Response.json(buildVendorOrderSummarySince(since));
  }

  return Response.json(buildVendorOrderSummaryAll());
}
