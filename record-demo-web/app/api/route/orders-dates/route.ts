import { NextResponse } from 'next/server';

/** DateFilter (`datesSource="orders"`) — synthetic day counts so the calendar shows dots */
export async function GET() {
  const dates: Record<string, number> = {};
  const base = new Date();
  for (let i = -14; i <= 21; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dates[key] = 3 + ((i * 7) % 15);
  }
  return NextResponse.json({ dates });
}
