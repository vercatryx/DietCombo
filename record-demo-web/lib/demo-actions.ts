/** Drop-in replacement for ../lib/actions.ts when recording demo video (fast synthetic data). */

export type { MealPlannerOrderResult } from '../../lib/meal-planner-utils';

/** Used by Meal Plan Edits report page */
export type MealPlanEditEntry = {
  clientId: string;
  clientName: string;
  scheduledDeliveryDate: string;
  items: { id: string; name: string; quantity: number; value: number | null }[];
};

export type MealPlannerOrderDisplayItem = {
  id: string;
  name: string;
  quantity: number;
  value?: number | null;
  clientId?: string | null;
};

export * from './demo-actions-handmade';
export * from './demo-actions-stubs.generated';
