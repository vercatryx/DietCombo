import { NextRequest, NextResponse } from 'next/server';
import { getStoreSnapshot } from '../../../../lib/demo-store';
import { buildFakeSmsUsage } from '../../../../lib/demo-sms-usage';

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to date params' }, { status: 400 });
  }

  const payload = buildFakeSmsUsage(from, to, getStoreSnapshot());
  return NextResponse.json(payload);
}
