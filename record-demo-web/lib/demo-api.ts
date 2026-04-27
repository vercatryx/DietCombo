/**
 * Drop-in for parent `lib/api.js` — no HTTP; uses synthetic routes aligned with `/routes`.
 */

import { getTodayInAppTz } from '../../lib/timezone';
import { buildDriversPageSimulation } from './demo-mobile-simulation';

export type DemoDriverBundle = ReturnType<typeof buildDriversPageSimulation>;

export async function fetchJSON(): Promise<null> {
  return null;
}

export async function fetchDriversPageData(
  deliveryDate: string | null | undefined,
): Promise<DemoDriverBundle> {
  if (!deliveryDate) return { drivers: [], allStops: [] };
  const norm = String(deliveryDate).split('T')[0].split(' ')[0];
  return buildDriversPageSimulation(norm);
}

export async function fetchDrivers(deliveryDate: string | null = null) {
  const norm = (deliveryDate ?? getTodayInAppTz()).split('T')[0].split(' ')[0];
  const { drivers } = await fetchDriversPageData(norm);
  return drivers;
}

export async function fetchDriver(driverId: string, deliveryDate: string | null = null) {
  const norm = (deliveryDate ?? getTodayInAppTz()).split('T')[0].split(' ')[0];
  const { drivers } = await fetchDriversPageData(norm);
  const found = drivers.find((r) => String(r.id) === String(driverId));
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    color: found.color,
    stopIds: found.stopIds,
  };
}

export async function fetchStops(deliveryDate: string | null = null) {
  const norm = (deliveryDate ?? getTodayInAppTz()).split('T')[0].split(' ')[0];
  const { allStops } = await fetchDriversPageData(norm);
  return allStops;
}

export async function fetchStopsByIds(ids: string[] = [], deliveryDate: string | null = null) {
  if (!ids?.length) return [];
  const all = (await fetchStops(deliveryDate)) as { id: string }[];
  const byId = new Map(all.map((s) => [String(s.id), s]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

export async function setStopCompleted(_userId: string, _stopId: string, _completed: boolean) {
  return { ok: true };
}
