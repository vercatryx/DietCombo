// utils/addressHelpers.js
export function stripUnitFromAddressLine(line = "") {
    return String(line)
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function buildGeocodeQuery(userOrRow) {
    const street = stripUnitFromAddressLine(userOrRow.address || "");
    const parts = [
        street,
        userOrRow.city?.trim() || "",
        userOrRow.state?.trim() || "",
        userOrRow.zip?.trim() || "",
    ];
    return parts.filter(Boolean).join(", ");
}