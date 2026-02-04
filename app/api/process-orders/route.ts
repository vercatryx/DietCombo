import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Public API: Process orders (step 1 — scan)
 *
 * GET/POST /api/process-orders
 *
 * First step: scans the entire upcoming_orders and meal_planner_orders tables
 * and returns their contents. No authentication required (public access).
 *
 * Response includes:
 * - upcoming_orders: all rows
 * - meal_planner_orders: all rows
 * - counts and scannedAt timestamp
 */
async function scanOrderTables() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const [upcomingResult, mealPlannerResult] = await Promise.all([
    supabase.from('upcoming_orders').select('*').order('created_at', { ascending: false }),
    supabase.from('meal_planner_orders').select('*').order('scheduled_delivery_date', { ascending: false }),
  ]);

  if (upcomingResult.error) {
    throw new Error(`upcoming_orders scan failed: ${upcomingResult.error.message}`);
  }
  if (mealPlannerResult.error) {
    throw new Error(`meal_planner_orders scan failed: ${mealPlannerResult.error.message}`);
  }

  return {
    upcoming_orders: upcomingResult.data ?? [],
    meal_planner_orders: mealPlannerResult.data ?? [],
    counts: {
      upcoming_orders: (upcomingResult.data ?? []).length,
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
      message: 'Scan completed (step 1: scan upcoming_orders and meal_planner_orders)',
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
      message: 'Scan completed (step 1: scan upcoming_orders and meal_planner_orders)',
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
