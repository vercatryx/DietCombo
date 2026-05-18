/** Unite account values selectable in the main app client editor. */
export const UNITE_ACCOUNT_UI_OPTIONS = [
    { value: 'Regular', label: 'Regular' },
    { value: 'Brooklyn', label: 'Brooklyn' },
    { value: 'DF', label: 'DF' },
] as const;

export type UniteAccountUiValue = (typeof UNITE_ACCOUNT_UI_OPTIONS)[number]['value'];
