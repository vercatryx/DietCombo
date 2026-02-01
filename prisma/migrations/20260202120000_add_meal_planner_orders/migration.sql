-- CreateTable
CREATE TABLE "meal_planner_orders" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "scheduled_delivery_date" DATE,
    "delivery_day" VARCHAR(50),
    "total_value" DECIMAL(10, 2),
    "total_items" INTEGER,
    "items" JSONB,
    "notes" TEXT,
    "processed_order_id" VARCHAR(36),
    "processed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_planner_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_meal_planner_orders_client_id" ON "meal_planner_orders"("client_id");

-- CreateIndex
CREATE INDEX "idx_meal_planner_orders_status" ON "meal_planner_orders"("status");

-- CreateIndex
CREATE INDEX "idx_meal_planner_orders_scheduled_delivery_date" ON "meal_planner_orders"("scheduled_delivery_date");

-- CreateIndex
CREATE INDEX "idx_meal_planner_orders_processed_order_id" ON "meal_planner_orders"("processed_order_id");

-- AddForeignKey
ALTER TABLE "meal_planner_orders" ADD CONSTRAINT "meal_planner_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
