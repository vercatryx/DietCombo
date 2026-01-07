// lib/maps.js
export function mapsUrlFromAddress({ address, city, state, zip }) {
    const q = encodeURIComponent(`${address}, ${city}, ${state} ${zip ?? ""}`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

