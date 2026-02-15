// lib/addressHelpers.ts
export function stripUnitFromAddressLine(line = ""): string {
    return String(line)
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

export interface AddressInput {
    address?: string | null;
    apt?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
}

/** Format a full address line for labels/display: street, apt, city, state zip */
export function formatFullAddress(userOrRow: AddressInput & { apt?: string | null }): string {
    const street = (userOrRow.address ?? "").trim();
    const apt = (userOrRow.apt ?? "").trim();
    const city = (userOrRow.city ?? "").trim();
    const state = (userOrRow.state ?? "").trim();
    const zip = (userOrRow.zip ?? "").trim();
    const parts: string[] = [];
    if (street) parts.push(street);
    if (apt) parts.push(apt.startsWith("Apt") || apt.startsWith("Unit") || apt.startsWith("#") ? apt : `Apt ${apt}`);
    const cityStateZip = [city, state, zip].filter(Boolean).join(", ");
    if (cityStateZip) parts.push(cityStateZip);
    return parts.join(", ") || "";
}

export function buildGeocodeQuery(userOrRow: AddressInput): string {
    const street = stripUnitFromAddressLine(userOrRow.address || "");
    const parts = [
        street,
        userOrRow.city?.trim() || "",
        userOrRow.state?.trim() || "",
        userOrRow.zip?.trim() || "",
    ];
    return parts.filter(Boolean).join(", ");
}
