/** Same normalization as web `makeAddressKey` in DriversGrid. */
export function makeAddressKey(stop: any): string {
    if (!stop) return '';
    const addrRaw = String(stop.address || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    let addrNoUnit = addrRaw
        .replace(/\b(apt|apartment|ste|suite|unit|fl|floor|bldg|building)\b\.?\s*[a-z0-9-]+/gi, '')
        .replace(/#\s*\w+/g, '')
        .replace(/[.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    addrNoUnit = addrNoUnit
        .replace(/\bstreet\b/g, 'st')
        .replace(/\bavenue\b/g, 'ave')
        .replace(/\broad\b/g, 'rd')
        .replace(/\bdrive\b/g, 'dr')
        .replace(/\bcourt\b/g, 'ct')
        .replace(/\blane\b/g, 'ln')
        .replace(/\bboulevard\b/g, 'blvd')
        .replace(/\bparkway\b/g, 'pkwy')
        .replace(/\bcircle\b/g, 'cir')
        .replace(/\bplace\b/g, 'pl')
        .replace(/\bnorth\b/g, 'n')
        .replace(/\bsouth\b/g, 's')
        .replace(/\beast\b/g, 'e')
        .replace(/\bwest\b/g, 'w');

    addrNoUnit = addrNoUnit
        .replace(/[.,;:]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return addrNoUnit;
}
