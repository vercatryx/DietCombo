import type { ClientProfile } from '../../lib/types';
import { getStoreSnapshot } from './demo-store';
import {
  improveRouteTwoOpt,
  orderStopsNearestNeighbor,
  partitionStopsByBearingBands,
  type LatLngStop,
} from './order-stops-nearest-neighbor';

const DEPOT = { lat: 39.9612, lng: -83.0026 };

export const DEMO_DRIVER_ROUTES = [
  { id: 'demo-route-01', name: 'Driver 01', color: '#1f77b4' },
  { id: 'demo-route-02', name: 'Driver 02', color: '#ff7f0e' },
  { id: 'demo-route-03', name: 'Driver 03', color: '#2ca02c' },
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type RawStop = LatLngStop & {
  clientId: string;
  fullName: string;
  address: string;
  apt: string | null;
  city: string;
  state: string;
  zip: string;
  phone?: string;
};

function toApiStop(raw: RawStop, dateNorm: string, seq: number) {
  const id = `demo-stop-${raw.clientId}`;
  const h = hashStr(`${id}:${dateNorm}`);
  const hasProof = h % 4 === 0 || h % 9 === 0;
  const orderNumber = 100000 + (h % 899999);

  return {
    id,
    name: raw.fullName,
    address: raw.address,
    city: raw.city,
    state: raw.state,
    zip: raw.zip,
    apt: raw.apt,
    lat: raw.lat,
    lng: raw.lng,
    latitude: raw.lat,
    longitude: raw.lng,
    phone: raw.phone,
    delivery_date: dateNorm,
    deliveryDate: dateNorm,
    orderNumber,
    order_number: orderNumber,
    orderId: `demo-ord-${raw.clientId}`,
    proofUrl: hasProof ? `https://picsum.photos/seed/${encodeURIComponent(raw.clientId)}/400/300` : '',
    proof_url: hasProof ? `https://picsum.photos/seed/${encodeURIComponent(raw.clientId)}/400/300` : '',
    completed: hasProof,
    dislikes: null as string | null,
    order: seq + 1,
  };
}

/** Same geographic split + ordering as `/routes` — feeds driver mobile UI + `lib/api` shims */
export function buildDriversPageSimulation(deliveryDateNorm: string) {
  const dateNorm = deliveryDateNorm.trim().slice(0, 10);

  const clients = getStoreSnapshot().filter(
    (c): c is ClientProfile & { latitude: number; longitude: number } =>
      !c.parentClientId && Number.isFinite(c.latitude) && Number.isFinite(c.longitude),
  );

  const rawStops: RawStop[] = clients.map((c) => ({
    lat: c.latitude,
    lng: c.longitude,
    clientId: c.id,
    fullName: c.fullName,
    address: c.address,
    apt: c.apt ?? null,
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ?? '',
    phone: c.phoneNumber ?? undefined,
  }));

  const clusters = partitionStopsByBearingBands(rawStops, 3, DEPOT);

  const drivers = clusters.map((cluster, i) => {
    const meta = DEMO_DRIVER_ROUTES[i] ?? DEMO_DRIVER_ROUTES[0];
    const nn = orderStopsNearestNeighbor(cluster, DEPOT);
    const ordered = improveRouteTwoOpt(nn);
    const stops = ordered.map((s, idx) => toApiStop(s, dateNorm, idx));
    return {
      id: meta.id,
      name: meta.name,
      color: meta.color,
      stops,
      stopIds: stops.map((s) => s.id),
      totalStops: stops.length,
      completedStops: stops.filter((s) => s.completed).length,
    };
  });

  const allStops = drivers.flatMap((d) => d.stops);
  return { drivers, allStops };
}
