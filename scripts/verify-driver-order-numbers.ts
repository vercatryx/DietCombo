/**
 * Verifies that the route API returns orderNumber on stops.
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/verify-driver-order-numbers.ts
 * Requires: dev server running (npm run dev) or set BASE_URL.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  // With DELIVERY_DATE: filter by date. Without: get all routes (more likely to have stops)
  const deliveryDate = process.env.DELIVERY_DATE;
  const url = deliveryDate
    ? `${BASE_URL}/api/route/routes?delivery_date=${encodeURIComponent(deliveryDate)}&light=1`
    : `${BASE_URL}/api/route/routes?light=1`;
  console.log('Fetching', url);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error('Fetch failed. Is the dev server running?', e);
    process.exit(1);
  }
  if (!res.ok) {
    console.error('API returned', res.status, res.statusText);
    process.exit(1);
  }
  const data = await res.json();
  const routes = data?.routes || [];
  const allStops = routes.flatMap((r: any) => r.stops || []);
  console.log('Routes:', routes.length, 'Total stops:', allStops.length);
  if (allStops.length === 0) {
    console.log('No stops for this date. Set DELIVERY_DATE=YYYY-MM-DD if needed.');
    return;
  }
  const withOrderNumber = allStops.filter((s: any) => (s.orderNumber ?? s.order_number) != null && (s.orderNumber ?? s.order_number) !== '');
  const missing = allStops.filter((s: any) => !(s.orderNumber ?? s.order_number));
  console.log('Stops WITH order number:', withOrderNumber.length);
  console.log('Stops MISSING order number:', missing.length);
  if (missing.length > 0) {
    console.log('\nFirst 5 stops missing order number:');
    missing.slice(0, 5).forEach((s: any, i: number) => {
      console.log(`  ${i + 1}. id=${s.id} client_id=${s.userId ?? s.client_id} order_id=${s.order_id} orderNumber=${s.orderNumber} order_number=${s.order_number} delivery_date=${s.delivery_date}`);
    });
  }
  if (withOrderNumber.length > 0) {
    console.log('\nFirst 3 stops WITH order number (sample):');
    withOrderNumber.slice(0, 3).forEach((s: any, i: number) => {
      console.log(`  ${i + 1}. id=${s.id} orderNumber=${s.orderNumber ?? s.order_number} orderId=${s.orderId ?? s.order_id}`);
    });
  }
  const pct = allStops.length ? ((withOrderNumber.length / allStops.length) * 100).toFixed(1) : '0';
  console.log('\nResult:', withOrderNumber.length, '/', allStops.length, `(${pct}%) have order number`);
  if (missing.length > 0 && missing.length === allStops.length) {
    console.error('\nFAIL: No stops have order number. Check API order lookup and DB order_number.');
    process.exit(1);
  }
  if (missing.length > 0) {
    console.warn('\nWARN: Some stops missing order number. See above for sample.');
  } else {
    console.log('\nOK: All stops have order number.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
