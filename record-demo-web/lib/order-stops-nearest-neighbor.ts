/**
 * Order geographic stops for a readable demo route polyline (greedy nearest-neighbor).
 * Snapshot order (e.g. client id) is arbitrary and produces zig‑zag lines if used as-is.
 */

export type LatLngStop = { lat: number; lng: number };

function dist2(a: LatLngStop, b: LatLngStop): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return dx * dx + dy * dy;
}

function edgeDist(a: LatLngStop, b: LatLngStop): number {
  return Math.sqrt(dist2(a, b));
}

/**
 * Uncross edges on an open tour (nearest-neighbor output). Cheap alternative to a full TSP solver;
 * removes many visual zig-zags on dense stop sets.
 * Applies one improving 2-opt move and rescans until no improvement.
 */
export function improveRouteTwoOpt<T extends LatLngStop>(route: T[]): T[] {
  if (route.length < 4) return [...route];

  let path = [...route];
  const maxPasses = 300;
  for (let pass = 0; pass < maxPasses; pass++) {
    let swapped = false;
    outer: for (let i = 0; i < path.length - 3; i++) {
      for (let j = i + 2; j < path.length - 1; j++) {
        const a = path[i];
        const b = path[i + 1];
        const c = path[j];
        const d = path[j + 1];
        const before = edgeDist(a, b) + edgeDist(c, d);
        const after = edgeDist(a, c) + edgeDist(b, d);
        if (after + 1e-9 < before) {
          const reversed = path.slice(i + 1, j + 1).reverse();
          path = [...path.slice(0, i + 1), ...reversed, ...path.slice(j + 1)];
          swapped = true;
          break outer;
        }
      }
    }
    if (!swapped) break;
  }
  return path;
}

/** Mutates nothing; returns a new array. */
export function orderStopsNearestNeighbor<T extends LatLngStop>(stops: T[], depot?: LatLngStop): T[] {
  if (stops.length <= 1) return [...stops];

  let centerLat = 0;
  let centerLng = 0;
  for (const s of stops) {
    centerLat += s.lat;
    centerLng += s.lng;
  }
  centerLat /= stops.length;
  centerLng /= stops.length;

  const startRef = depot ?? { lat: centerLat, lng: centerLng };

  const unvisited: T[] = [...stops];
  let current =
    unvisited.reduce((best, p) => (dist2(p, startRef) < dist2(best, startRef) ? p : best), unvisited[0]);

  const ordered: T[] = [];
  ordered.push(current);
  unvisited.splice(unvisited.indexOf(current), 1);

  while (unvisited.length) {
    let nearest = unvisited[0];
    let best = dist2(current, nearest);
    for (let i = 1; i < unvisited.length; i++) {
      const p = unvisited[i];
      const d = dist2(current, p);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    ordered.push(nearest);
    current = nearest;
    unvisited.splice(unvisited.indexOf(nearest), 1);
  }

  return ordered;
}

/**
 * Partition stops into k geographic clusters (k-means on lat/lng), then each cluster can be
 * ordered with {@link orderStopsNearestNeighbor} for efficient per-driver polylines.
 */
export function partitionStopsByKMeans<T extends LatLngStop>(points: T[], k: number, iterations = 20): T[][] {
  if (points.length === 0) return [];
  if (k <= 1 || points.length <= k) return [points];

  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const centroids: LatLngStop[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.min(sorted.length - 1, Math.floor(((i + 0.5) * sorted.length) / k));
    centroids.push({ lat: sorted[idx].lat, lng: sorted[idx].lng });
  }

  const assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < points.length; i++) {
      let bestJ = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = dist2(points[i], centroids[j]);
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      assignments[i] = bestJ;
    }

    const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const g = assignments[i];
      sums[g].lat += points[i].lat;
      sums[g].lng += points[i].lng;
      sums[g].n++;
    }
    for (let j = 0; j < k; j++) {
      if (sums[j].n > 0) {
        centroids[j] = { lat: sums[j].lat / sums[j].n, lng: sums[j].lng / sums[j].n };
      }
    }
  }

  const groups: T[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < points.length; i++) {
    groups[assignments[i]].push(points[i]);
  }

  return groups.filter((g) => g.length > 0);
}

/**
 * Split stops into k contiguous compass “wedges” from a depot (equal count per wedge).
 * Usually looks more like real territory splits than k-means blobs and pairs well with NN + 2-opt.
 */
export function partitionStopsByBearingBands<T extends LatLngStop>(
  points: T[],
  k: number,
  depot: LatLngStop,
): T[][] {
  if (points.length === 0) return [];
  if (k <= 1 || points.length <= k) return [points];

  const scored = points.map((p) => ({
    p,
    angle: Math.atan2(p.lng - depot.lng, p.lat - depot.lat),
  }));
  scored.sort((a, b) => a.angle - b.angle);

  const groups: T[][] = Array.from({ length: k }, () => []);
  const n = scored.length;
  for (let i = 0; i < n; i++) {
    const bucket = Math.min(k - 1, Math.floor((i * k) / n));
    groups[bucket].push(scored[i].p);
  }

  return groups.filter((g) => g.length > 0);
}
