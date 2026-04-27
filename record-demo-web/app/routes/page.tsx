'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { getStoreSnapshot } from '../../lib/demo-store';
import {
  improveRouteTwoOpt,
  orderStopsNearestNeighbor,
  partitionStopsByBearingBands,
} from '../../lib/order-stops-nearest-neighbor';

const DriversMapLeaflet = dynamic(() => import('@/components/routes/DriversMapLeaflet'), {
  ssr: false,
}) as unknown as ComponentType<Record<string, unknown>>;

export default function RoutesDemoPage() {
  const drivers = useMemo(() => {
    const clients = getStoreSnapshot().filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));

    const rawStops = clients.map((c) => ({
      id: c.id,
      lat: c.latitude as number,
      lng: c.longitude as number,
      latitude: c.latitude as number,
      longitude: c.longitude as number,
      fullName: c.fullName,
      address: c.address,
      apt: c.apt ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      zip: c.zip ?? '',
      serviceType: c.serviceType,
    }));

    const DRIVER_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c'];
    /** Synthetic kitchen / dispatch — NN and bearing wedges use this so tours read “out and back” locally */
    const DEPOT = { lat: 39.9612, lng: -83.0026 };

    const clusters = partitionStopsByBearingBands(rawStops, 3, DEPOT);

    return clusters.map((cluster, i) => {
      const nn = orderStopsNearestNeighbor(cluster, DEPOT);
      const stops = improveRouteTwoOpt(nn);
      return {
        driverId: `demo-route-0${i + 1}`,
        name: `Driver 0${i + 1}`,
        color: DRIVER_COLORS[i % DRIVER_COLORS.length],
        stops,
      };
    });
  }, []);

  return (
    <div style={{ height: 'calc(100vh - 24px)', display: 'flex', flexDirection: 'column', minHeight: 400 }}>
      <DriversMapLeaflet
        drivers={drivers}
        unrouted={[]}
        initialCenter={[39.965, -83.002]}
        initialZoom={12}
        showRouteLinesDefault
        readonly
        busy={false}
        logoSrc=""
        dataSourceLabel="record-demo synthetic clients"
      />
    </div>
  );
}
