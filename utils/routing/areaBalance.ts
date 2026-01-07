// Outliers-to-Driver0 via 10mi components -> DP cuts with size bounds & angular compactness
// -> Cheapest Insertion seed (farthest pair) -> 2-opt (many passes) -> rotate to DF

export type LatLng = { id: number; lat: number | string; lng: number | string };

/** Diet Fantasy HQ */
const DF = { lat: 41.146139747821344, lng: -73.98944108338935 };

/** ---- Tunables ---- */
const TEN_MI_KM = 16.09344;                 // 10 miles in km
const MIN_CLUSTER_SIZE = 3;                  // components smaller than this -> Driver 0
const SLACK_PERC_SEQUENCE = [0.15, 0.25, 0.35, 0.50]; // size slack for DP balance

// Weights in chunk compactness cost (slightly stronger diag penalty)
const DIAG_WEIGHT = 1200;
const SIZE_PENALTY = 0.25;
const ANGULAR_WEIGHT = 300;

/* ---------------- utils ---------------- */
function num(v: unknown) {
    const n = typeof v === "string" ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? n : NaN;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const x = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
}

function quotas(n: number, k: number) {
    const res: number[] = [];
    for (let i = 0; i < k; i++) {
        const a = Math.round(((i + 1) * n) / k) - Math.round((i * n) / k);
        res.push(a);
    }
    return res;
}

function part1by1(v: number) {
    v &= 0x0000ffff;
    v = (v | (v << 8)) & 0x00FF00FF;
    v = (v | (v << 4)) & 0x0F0F0F0F;
    v = (v | (v << 2)) & 0x33333333;
    v = (v | (v << 1)) & 0x55555555;
    return v >>> 0;
}
function morton(x: number, y: number) { return (part1by1(x) | (part1by1(y) << 1)) >>> 0; }

function toGrid(
    p: { lat: number; lng: number },
    bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    flipX = false,
    flipY = false
) {
    const { minLat, maxLat, minLng, maxLng } = bbox;
    const width = Math.max(1e-9, maxLng - minLng);
    const height = Math.max(1e-9, maxLat - minLat);
    let nx = (p.lng - minLng) / width;
    let ny = (p.lat - minLat) / height;
    if (flipX) nx = 1 - nx;
    if (flipY) ny = 1 - ny;
    const x = Math.max(0, Math.min(65535, Math.floor(nx * 65535)));
    const y = Math.max(0, Math.min(65535, Math.floor(ny * 65535)));
    return { x, y };
}

/* ---------------- intra-chunk ordering ---------------- */
type P = { id: number; lat: number; lng: number };

/** Seed route with the farthest pair, then cheapest-insertion, then 2-opt */
function orderCheapestInsertion(points: P[]) {
    if (points.length <= 2) return points.map(p => p.id);

    // find farthest pair
    let a = 0, b = 1, best = -1;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const d = haversine(points[i], points[j]);
            if (d > best) { best = d; a = i; b = j; }
        }
    }

    const unused = points.map((p, i) => i).filter(i => i !== a && i !== b);
    let routeIdxs = [a, b]; // route is array of indices into points

    // cheapest insertion
    while (unused.length) {
        let bestIns = { idxInUnused: 0, pos: 1, cost: Infinity };
        for (let uu = 0; uu < unused.length; uu++) {
            const pi = unused[uu];
            for (let pos = 0; pos < routeIdxs.length; pos++) {
                const q = routeIdxs[pos];
                const r = routeIdxs[(pos + 1) % routeIdxs.length];
                const cost = haversine(points[q], points[pi]) + haversine(points[pi], points[r]) - haversine(points[q], points[r]);
                if (cost < bestIns.cost) bestIns = { idxInUnused: uu, pos: pos + 1, cost };
            }
        }
        const [take] = unused.splice(bestIns.idxInUnused, 1);
        routeIdxs.splice(bestIns.pos, 0, take);
    }

    // return id order
    return routeIdxs.map(i => points[i].id);
}

function twoOpt(ids: number[], idToPt: Map<number, P>, maxPasses = 25) {
    const n = ids.length; if (n < 4) return ids;
    const D = (i: number, j: number) => haversine(idToPt.get(ids[i])!, idToPt.get(ids[j])!);
    let improved = true, pass = 0;
    while (improved && pass++ < maxPasses) {
        improved = false;
        for (let i = 0; i < n - 3; i++) {
            for (let k = i + 2; k < n - 1; k++) {
                const d1 = D(i, i + 1) + D(k, k + 1);
                const d2 = D(i, k) + D(i + 1, k + 1);
                if (d2 + 1e-9 < d1) {
                    const mid = ids.slice(i + 1, k + 1).reverse();
                    ids = ids.slice(0, i + 1).concat(mid, ids.slice(k + 1));
                    improved = true;
                }
            }
        }
    }
    return ids;
}

function rotateIdsToDF(ids: number[], idToPt: Map<number, P>) {
    if (!ids.length) return ids;
    let bestIdx = 0, bestD = Infinity;
    for (let i = 0; i < ids.length; i++) {
        const p = idToPt.get(ids[i]); if (!p) continue;
        const d = haversine(DF, p);
        if (d < bestD) { bestD = d; bestIdx = i; }
    }
    return bestIdx === 0 ? ids : ids.slice(bestIdx).concat(ids.slice(0, bestIdx));
}

/* ---------------- angular helpers ---------------- */
function angleFromDF(p: P) {
    const dy = p.lat - DF.lat, dx = p.lng - DF.lng;
    return Math.atan2(dy, dx);
}
function circularVariance(angles: number[]) {
    if (!angles.length) return 0;
    let C = 0, S = 0;
    for (const a of angles) { C += Math.cos(a); S += Math.sin(a); }
    const R = Math.sqrt(C * C + S * S) / angles.length;
    return 1 - R;
}

/* ---------------- 10-mile components + strict D0 split ---------------- */
type Component = { ids: number[]; pts: P[] };

function buildComponents(points: P[], radiusKm = TEN_MI_KM): Component[] {
    const n = points.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (haversine(points[i], points[j]) <= radiusKm) {
                adj[i].push(j); adj[j].push(i);
            }
        }
    }
    const seen = new Array<boolean>(n).fill(false);
    const comps: Component[] = [];
    for (let i = 0; i < n; i++) {
        if (seen[i]) continue;
        const stack = [i]; seen[i] = true;
        const idxs: number[] = [];
        while (stack.length) {
            const u = stack.pop()!;
            idxs.push(u);
            for (const v of adj[u]) if (!seen[v]) { seen[v] = true; stack.push(v); }
        }
        const pts = idxs.map(ix => points[ix]);
        const ids = pts.map(p => p.id);
        comps.push({ ids, pts });
    }
    return comps;
}


function splitOutliersByComponents(points: P[]) {
    const comps = buildComponents(points, TEN_MI_KM);

    if (comps.length === 0) return { keep: [] as P[], toD0: [] as P[] };

    if (comps.length === 1) {
        // Single component: keep it (even if small). Do not send to D0.
        return { keep: comps[0].pts, toD0: [] as P[] };
    }

    // Compute min inter-component distances
    const compMinDist: number[] = comps.map(() => Infinity);
    for (let a = 0; a < comps.length; a++) {
        for (let b = a + 1; b < comps.length; b++) {
            let best = Infinity;
            for (const pa of comps[a].pts) {
                for (const pb of comps[b].pts) {
                    const d = haversine(pa, pb);
                    if (d < best) best = d;
                    if (best <= TEN_MI_KM) break;
                }
                if (best <= TEN_MI_KM) break;
            }
            compMinDist[a] = Math.min(compMinDist[a], best);
            compMinDist[b] = Math.min(compMinDist[b], best);
        }
    }

    // New rule: send a component to D0 only if it's BOTH tiny AND far-from-all
    const keep: P[] = [];
    const toD0: P[] = [];
    comps.forEach((c, idx) => {
        const tooSmall = c.ids.length < MIN_CLUSTER_SIZE;
        const farFromAll = compMinDist[idx] > TEN_MI_KM;
        if (tooSmall && farFromAll) toD0.push(...c.pts);
        else keep.push(...c.pts);
    });

    // Safety guard: never let D0 steal (almost) everything
    const total = points.length;
    if (!keep.length || keep.length < Math.ceil(0.4 * total)) {
        // Reclaim largest components from D0 until at least ~50% are kept
        const compsBySize = comps.slice().sort((a, b) => b.ids.length - a.ids.length);
        const targetKeep = Math.max(1, Math.ceil(0.5 * total));
        const keepSet = new Set(keep.map((p) => p.id));

        // rebuild toD0 as a set of ids for fast delete
        const toD0Set = new Set(toD0.map((p) => p.id));

        for (const c of compsBySize) {
            const anyInKeep = c.ids.some((id) => keepSet.has(id));
            if (!anyInKeep) {
                // move this component from D0 to keep
                keep.push(...c.pts);
                c.ids.forEach((id) => toD0Set.delete(id));
                if (keep.length >= targetKeep) break;
            }
        }

        // rebuild toD0 array
        const idToP = new Map(points.map((p) => [p.id, p]));
        const nextToD0: P[] = [];
        toD0Set.forEach((id) => { const p = idToP.get(id); if (p) nextToD0.push(p); });
        toD0.length = 0;
        toD0.push(...nextToD0);
    }

    return { keep, toD0 };
}

/* ---------------- compactness + bounded DP cuts ---------------- */
function chunkCost(sorted: P[], i: number, jInclusive: number) {
    if (jInclusive < i) return 0;
    if (i === jInclusive) return 0.05;
    let minLat = +Infinity, maxLat = -Infinity, minLng = +Infinity, maxLng = -Infinity;
    const angs: number[] = [];
    for (let t = i; t <= jInclusive; t++) {
        const p = sorted[t];
        if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
        angs.push(angleFromDF(p));
    }
    const diag = Math.hypot(maxLat - minLat, maxLng - minLng);
    const len = jInclusive - i + 1;
    const angVar = circularVariance(angs);
    return diag * DIAG_WEIGHT + Math.sqrt(len) * SIZE_PENALTY + angVar * ANGULAR_WEIGHT;
}

function chooseCutsDPWithQuotas(sorted: P[], k: number) {
    const n = sorted.length;
    const target = quotas(n, k);
    const avg = n / k;

    for (const perc of SLACK_PERC_SEQUENCE) {
        const slack = Math.max(2, Math.round(avg * perc));
        const lo = target.map(t => Math.max(1, t - slack));
        const hi = target.map(t => Math.min(n, t + slack));

        const dp = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(+Infinity));
        const parent = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
        dp[0][0] = 0;

        for (let c = 1; c <= k; c++) {
            for (let end = 1; end <= n; end++) {
                const minSize = lo[c - 1];
                const maxSize = hi[c - 1];
                const startMin = Math.max(c - 1, end - maxSize);
                const startMax = Math.min(end - 1, end - minSize);
                for (let mid = startMin; mid <= startMax; mid++) {
                    const cost = dp[c - 1][mid] + chunkCost(sorted, mid, end - 1);
                    if (cost < dp[c][end]) { dp[c][end] = cost; parent[c][end] = mid; }
                }
            }
        }

        if (isFinite(dp[k][n])) {
            const bounds: Array<[number, number]> = [];
            let c = k, e = n;
            while (c > 0) {
                const m = parent[c][e];
                bounds.push([m, e]);
                e = m; c--;
            }
            bounds.reverse();
            return bounds;
        }
    }

    // fallback: equal contiguous chunks
    const q = quotas(n, k);
    const out: Array<[number, number]> = [];
    let off = 0;
    for (let i = 0; i < k; i++) { const sz = q[i]; out.push([off, off + sz]); off += sz; }
    return out;
}

/* ---------------- main ---------------- */
export function planRoutesByAreaBalanced(points: LatLng[], driverCount: number) {
    if (driverCount <= 0) throw new Error("driverCount must be >= 1");

    // Coerce numeric strings, drop only truly invalid entries
    const geocoded: P[] = points
        .map(p => ({ id: p.id, lat: num(p.lat), lng: num(p.lng) }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (geocoded.length === 0) {
        return [{ driverIndex: 0, center: { lat: 0, lng: 0 }, stopIds: [], count: 0 }];
    }

    // STRICT: Split outliers/tiny components → Driver 0 (no relaxation)
    const { keep, toD0 } = splitOutliersByComponents(geocoded);
    const keepPoints = keep;               // never "relax"
    const toD0Points = toD0;

    // If nothing left for regular drivers, just return Driver 0 bucket
    if (!keepPoints.length) {
        const d0Sorted = toD0Points.slice().sort((a, b) => angleFromDF(a) - angleFromDF(b)).map(p => p.id);
        return [{
            driverIndex: 0,
            center: toD0Points.length ? { lat: toD0Points[0].lat, lng: toD0Points[0].lng } : { lat: 0, lng: 0 },
            stopIds: d0Sorted,
            count: d0Sorted.length,
        }];
    }

    // Make a Morton-sorted master list (we'll cut contiguous spans by DP)
    const idToPt = new Map<number, P>(keepPoints.map(p => [p.id, p]));
    const minLat = Math.min(...keepPoints.map(p => p.lat));
    const maxLat = Math.max(...keepPoints.map(p => p.lat));
    const minLng = Math.min(...keepPoints.map(p => p.lng));
    const maxLng = Math.max(...keepPoints.map(p => p.lng));
    const bbox = { minLat, maxLat, minLng, maxLng };

    const orientations = [
        { flipX: false, flipY: false },
        { flipX: true,  flipY: false },
        { flipX: false, flipY: true  },
        { flipX: true,  flipY: true  },
    ];

    let bestSorted: P[] = keepPoints, bestScore = Infinity;
    for (const o of orientations) {
        const sorted = keepPoints
            .map(p => { const g = toGrid(p, bbox, o.flipX, o.flipY); return { p, code: morton(g.x, g.y) }; })
            .sort((a, b) => a.code - b.code)
            .map(x => x.p);

        const q = quotas(keepPoints.length, Math.min(driverCount, keepPoints.length));
        let off = 0, score = 0;
        for (let i = 0; i < q.length; i++) {
            const sz = q[i];
            score += chunkCost(sorted, off, off + sz - 1);
            off += sz;
        }
        if (score < bestScore) { bestScore = score; bestSorted = sorted; }
    }

    const k = Math.min(driverCount, bestSorted.length);
    const bounds = chooseCutsDPWithQuotas(bestSorted, k);

    const planned: { driverIndex: number; center: { lat: number; lng: number }; stopIds: number[]; count: number }[] = [];
    for (let i = 0; i < bounds.length; i++) {
        const [s, e] = bounds[i];
        const chunk = bestSorted.slice(s, e);

        // stronger ordering: cheapest insertion seed + 2-opt (many passes) + rotate toward DF
        let ids = orderCheapestInsertion(chunk);
        ids = twoOpt(ids, idToPt, 25);
        ids = rotateIdsToDF(ids, idToPt);

        const center = {
            lat: chunk.reduce((sum, p) => sum + p.lat, 0) / Math.max(1, chunk.length),
            lng: chunk.reduce((sum, p) => sum + p.lng, 0) / Math.max(1, chunk.length),
        };

        planned.push({ driverIndex: i + 1, center, stopIds: ids, count: ids.length });
    }

    // Driver 0 transfer bucket (sorted by angle around DF)
    const d0Sorted = toD0Points.slice().sort((a, b) => angleFromDF(a) - angleFromDF(b)).map(p => p.id);
    const transferBucket = {
        driverIndex: 0,
        center: toD0Points.length ? { lat: toD0Points[0].lat, lng: toD0Points[0].lng } : { lat: 0, lng: 0 },
        stopIds: d0Sorted,
        count: d0Sorted.length,
    };

    return [transferBucket, ...planned];
}

