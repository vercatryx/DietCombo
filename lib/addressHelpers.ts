// lib/addressHelpers.ts
export function stripUnitFromAddressLine(line = ""): string {
    return String(line)
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

export interface AddressInput {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
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
