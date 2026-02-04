import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Public API: Process orders (step 1 — scan)
 *
 * GET/POST /api/process-orders
 *
 * First step: scans order data from:
 * - clients.upcoming_order (JSON field on clients — current order request per client)
 * - meal_planner_orders table (all rows)
 * (upcoming_orders table scan disabled for now)
 * No authentication required (public access).
 *
 * Response includes:
 * - from_clients: upcoming order data from clients.upcoming_order (id, full_name, service_type, upcoming_order)
 * - meal_planner_orders: all rows from meal_planner_orders table
 * - counts and scannedAt timestamp
 */
async function scanOrderTables() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const [clientsResult, mealPlannerResult] = await Promise.all([
    supabase
      .from('clients')
      .select('id, full_name, service_type, upcoming_order')
      .not('upcoming_order', 'is', null)
      .order('full_name'),
    supabase.from('meal_planner_orders').select('*').order('scheduled_delivery_date', { ascending: false }),
  ]);

  if (clientsResult.error) {
    throw new Error(`clients (upcoming_order) scan failed: ${clientsResult.error.message}`);
  }
  if (mealPlannerResult.error) {
    throw new Error(`meal_planner_orders scan failed: ${mealPlannerResult.error.message}`);
  }

  const fromClients = (clientsResult.data ?? []).map((row: { id: string; full_name: string | null; service_type: string | null; upcoming_order: unknown }) => ({
    client_id: row.id,
    full_name: row.full_name ?? null,
    service_type: row.service_type ?? null,
    upcoming_order:
        typeof row.upcoming_order === 'string'
          ? (() => {
              try {
                return JSON.parse(row.upcoming_order);
              } catch {
                return row.upcoming_order;
              }
            })()
          : row.upcoming_order ?? {},
  }));

  return {
    from_clients: fromClients,
    meal_planner_orders: mealPlannerResult.data ?? [],
    counts: {
      from_clients: fromClients.length,
      meal_planner_orders: (mealPlannerResult.data ?? []).length,
    },
    scannedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const scan = await scanOrderTables();
    return NextResponse.json({
      success: true,
      message: 'Scan completed (step 1: scan clients.upcoming_order, meal_planner_orders)',
      ...scan,
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    console.error('[process-orders] GET error:', error);
    return NextResponse.json({
      success: false,
      error: message,
      scannedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const scan = await scanOrderTables();
    return NextResponse.json({
      success: true,
      message: 'Scan completed (step 1: scan clients.upcoming_order, meal_planner_orders)',
      ...scan,
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Scan failed';
    console.error('[process-orders] POST error:', error);
    return NextResponse.json({
      success: false,
      error: message,
      scannedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
