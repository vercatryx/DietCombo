import type { ClientProfile } from '@/lib/types';

/** Default values for client flags when creating new clients. */
export const CLIENT_FLAG_DEFAULTS = {
  paused: false,
  complex: false,
  bill: true,
  delivery: true,
} as const;

export type ClientFlagKey = keyof typeof CLIENT_FLAG_DEFAULTS;

/** Returns true if any client flag differs from the default. */
export function hasNonDefaultFlags(client: Pick<ClientProfile, 'paused' | 'complex' | 'bill' | 'delivery'> | null | undefined): boolean {
  if (!client) return false;
  return (
    (client.paused ?? CLIENT_FLAG_DEFAULTS.paused) !== CLIENT_FLAG_DEFAULTS.paused ||
    (client.complex ?? CLIENT_FLAG_DEFAULTS.complex) !== CLIENT_FLAG_DEFAULTS.complex ||
    (client.bill ?? CLIENT_FLAG_DEFAULTS.bill) !== CLIENT_FLAG_DEFAULTS.bill ||
    (client.delivery ?? CLIENT_FLAG_DEFAULTS.delivery) !== CLIENT_FLAG_DEFAULTS.delivery
  );
}

/** Returns short labels for flags that are not default (e.g. "Paused", "No bill", "Complex"). */
export function getNonDefaultFlagLabels(client: Pick<ClientProfile, 'paused' | 'complex' | 'bill' | 'delivery'> | null | undefined): string[] {
  if (!client) return [];
  const labels: string[] = [];
  if ((client.paused ?? CLIENT_FLAG_DEFAULTS.paused) !== CLIENT_FLAG_DEFAULTS.paused) labels.push('Paused');
  if ((client.complex ?? CLIENT_FLAG_DEFAULTS.complex) !== CLIENT_FLAG_DEFAULTS.complex) labels.push('Complex');
  if ((client.bill ?? CLIENT_FLAG_DEFAULTS.bill) !== CLIENT_FLAG_DEFAULTS.bill) labels.push('No bill');
  if ((client.delivery ?? CLIENT_FLAG_DEFAULTS.delivery) !== CLIENT_FLAG_DEFAULTS.delivery) labels.push('No delivery');
  return labels;
}

/** Filter value for the Flags column: all, any non-default, or a specific flag reason. */
export type FlagsFilterValue = 'all' | 'non-default' | 'paused' | 'complex' | 'no-bill' | 'no-delivery';

/** Options for the Flags filter dropdown (value + label). */
export const FLAGS_FILTER_OPTIONS: { value: FlagsFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'non-default', label: 'Non-default only' },
  { value: 'paused', label: 'Paused' },
  { value: 'complex', label: 'Complex' },
  { value: 'no-bill', label: 'No bill' },
  { value: 'no-delivery', label: 'No delivery' },
];

/** Returns true if the client matches the given flags filter. */
export function clientMatchesFlagFilter(
  client: Pick<ClientProfile, 'paused' | 'complex' | 'bill' | 'delivery'> | null | undefined,
  filter: FlagsFilterValue
): boolean {
  if (!client) return false;
  if (filter === 'all') return true;
  if (filter === 'non-default') return hasNonDefaultFlags(client);
  const paused = client.paused ?? CLIENT_FLAG_DEFAULTS.paused;
  const complex = client.complex ?? CLIENT_FLAG_DEFAULTS.complex;
  const bill = client.bill ?? CLIENT_FLAG_DEFAULTS.bill;
  const delivery = client.delivery ?? CLIENT_FLAG_DEFAULTS.delivery;
  switch (filter) {
    case 'paused':
      return paused === true;
    case 'complex':
      return complex === true;
    case 'no-bill':
      return bill === false;
    case 'no-delivery':
      return delivery === false;
    default:
      return true;
  }
}
