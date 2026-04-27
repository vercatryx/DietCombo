export interface GeocodeResult {
  lat: number;
  lng: number;
  provider?: string;
  formatted?: string;
  place_id?: string;
  ts?: number;
}

/** Deterministic demo coordinates (Columbus, OH) — no external API calls. */
export async function geocodeOneClient(query: string): Promise<GeocodeResult> {
  const q = String(query || '').trim();
  return {
    lat: 39.965,
    lng: -83.002,
    provider: 'record-demo',
    formatted: q || 'Columbus, OH',
    ts: Date.now(),
  };
}
