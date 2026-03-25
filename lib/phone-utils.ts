/** Normalize a raw phone string to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.length < 10) return null;
  return cleaned.startsWith('+') ? cleaned : `+1${cleaned}`;
}

/**
 * Parse a phone field that may contain multiple numbers separated by `/`.
 * Returns an array of cleaned individual number strings (not yet E.164).
 */
export function parsePhoneField(field: string | null | undefined): string[] {
  if (!field) return [];
  return field.split('/').map(s => s.trim()).filter(Boolean);
}

/**
 * Get all individual phone numbers for a client, parsed from both
 * phone_number and secondary_phone_number (splitting on `/`).
 */
export function getAllClientNumbers(client: {
  phone_number?: string | null;
  secondary_phone_number?: string | null;
  phoneNumber?: string | null;
  secondaryPhoneNumber?: string | null;
}): string[] {
  return [
    ...parsePhoneField(client.phone_number ?? client.phoneNumber),
    ...parsePhoneField(client.secondary_phone_number ?? client.secondaryPhoneNumber),
  ];
}

/**
 * From the full list of client numbers, filter out any that have been
 * flagged in the do_not_text_numbers map.
 */
export function getTextableNumbers(
  allNumbers: string[],
  flaggedMap: Record<string, string>,
): string[] {
  return allNumbers.filter(raw => {
    const e164 = normalizePhone(raw);
    return e164 && !flaggedMap[e164];
  });
}
