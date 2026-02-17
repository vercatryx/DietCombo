-- CreateTable: per-date config for meal planner (expected total meals for that delivery date).
-- One row per (calendar_date, client_id). client_id NULL = default template.
CREATE TABLE "meal_planner_date_config" (
    "id" VARCHAR(36) NOT NULL,
    "calendar_date" DATE NOT NULL,
    "client_id" VARCHAR(36),
    "expected_total_meals" INTEGER,

    CONSTRAINT "meal_planner_date_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_meal_planner_date_config_calendar_date" ON "meal_planner_date_config"("calendar_date");
CREATE INDEX "idx_meal_planner_date_config_client_date" ON "meal_planner_date_config"("client_id", "calendar_date");

-- One row per (calendar_date, client_id). Partial uniques handle NULL client_id.
CREATE UNIQUE INDEX "meal_planner_date_config_date_client_key" ON "meal_planner_date_config"("calendar_date", "client_id") WHERE "client_id" IS NOT NULL;
CREATE UNIQUE INDEX "meal_planner_date_config_date_default_key" ON "meal_planner_date_config"("calendar_date") WHERE "client_id" IS NULL;

ALTER TABLE "meal_planner_date_config" ADD CONSTRAINT "meal_planner_date_config_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
