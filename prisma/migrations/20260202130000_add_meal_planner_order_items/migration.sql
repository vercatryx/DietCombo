-- CreateTable
CREATE TABLE "meal_planner_order_items" (
    "id" VARCHAR(36) NOT NULL,
    "meal_planner_order_id" VARCHAR(36) NOT NULL,
    "meal_type" VARCHAR(50) NOT NULL,
    "menu_item_id" VARCHAR(36),
    "meal_item_id" VARCHAR(36),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "custom_name" VARCHAR(255),
    "custom_price" DECIMAL(10, 2),
    "sort_order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_planner_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_meal_planner_order_items_order_id" ON "meal_planner_order_items"("meal_planner_order_id");

-- CreateIndex
CREATE INDEX "idx_meal_planner_order_items_menu_item_id" ON "meal_planner_order_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "idx_meal_planner_order_items_meal_item_id" ON "meal_planner_order_items"("meal_item_id");

-- CreateIndex
CREATE INDEX "idx_meal_planner_order_items_meal_type" ON "meal_planner_order_items"("meal_type");

-- AddForeignKey
ALTER TABLE "meal_planner_order_items" ADD CONSTRAINT "meal_planner_order_items_meal_planner_order_id_fkey" FOREIGN KEY ("meal_planner_order_id") REFERENCES "meal_planner_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_planner_order_items" ADD CONSTRAINT "meal_planner_order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_planner_order_items" ADD CONSTRAINT "meal_planner_order_items_meal_item_id_fkey" FOREIGN KEY ("meal_item_id") REFERENCES "breakfast_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
