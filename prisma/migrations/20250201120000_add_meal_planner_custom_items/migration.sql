-- CreateTable
CREATE TABLE "meal_planner_custom_items" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36),
    "calendar_date" DATE NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(10,2),
    "sort_order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_planner_custom_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_meal_planner_custom_items_client_id" ON "meal_planner_custom_items"("client_id");

-- CreateIndex
CREATE INDEX "idx_meal_planner_custom_items_calendar_date" ON "meal_planner_custom_items"("calendar_date");

-- CreateIndex
CREATE INDEX "idx_meal_planner_custom_items_client_date" ON "meal_planner_custom_items"("client_id", "calendar_date");

-- AddForeignKey
ALTER TABLE "meal_planner_custom_items" ADD CONSTRAINT "meal_planner_custom_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
