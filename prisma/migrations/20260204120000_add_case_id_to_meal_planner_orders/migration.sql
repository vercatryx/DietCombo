-- Add case_id to meal_planner_orders (same as upcoming_orders.case_id for Food clients)
ALTER TABLE "meal_planner_orders" ADD COLUMN "case_id" VARCHAR(255);

CREATE INDEX "idx_meal_planner_orders_case_id" ON "meal_planner_orders"("case_id");
