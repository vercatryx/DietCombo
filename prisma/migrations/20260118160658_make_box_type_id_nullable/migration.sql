/*
  Warnings:

  - The primary key for the `admins` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `admins` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(36)`.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- DropForeignKey
ALTER TABLE "billing_records" DROP CONSTRAINT "billing_records_client_id_fkey";

-- DropForeignKey
ALTER TABLE "billing_records" DROP CONSTRAINT "billing_records_order_id_fkey";

-- DropForeignKey
ALTER TABLE "box_quotas" DROP CONSTRAINT "box_quotas_box_type_id_fkey";

-- DropForeignKey
ALTER TABLE "box_quotas" DROP CONSTRAINT "box_quotas_category_id_fkey";

-- DropForeignKey
ALTER TABLE "box_types" DROP CONSTRAINT "box_types_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_navigator_id_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_parent_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_status_id_fkey";

-- DropForeignKey
ALTER TABLE "delivery_history" DROP CONSTRAINT "delivery_history_client_id_fkey";

-- DropForeignKey
ALTER TABLE "delivery_history" DROP CONSTRAINT "delivery_history_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "filled_forms" DROP CONSTRAINT "filled_forms_form_id_fkey";

-- DropForeignKey
ALTER TABLE "form_answers" DROP CONSTRAINT "form_answers_filled_form_id_fkey";

-- DropForeignKey
ALTER TABLE "form_answers" DROP CONSTRAINT "form_answers_question_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_client_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_form_id_fkey";

-- DropForeignKey
ALTER TABLE "menu_items" DROP CONSTRAINT "menu_items_category_id_fkey";

-- DropForeignKey
ALTER TABLE "menu_items" DROP CONSTRAINT "menu_items_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "navigator_logs" DROP CONSTRAINT "navigator_logs_client_id_fkey";

-- DropForeignKey
ALTER TABLE "navigator_logs" DROP CONSTRAINT "navigator_logs_navigator_id_fkey";

-- DropForeignKey
ALTER TABLE "order_box_selections" DROP CONSTRAINT "order_box_selections_box_type_id_fkey";

-- DropForeignKey
ALTER TABLE "order_box_selections" DROP CONSTRAINT "order_box_selections_order_id_fkey";

-- DropForeignKey
ALTER TABLE "order_box_selections" DROP CONSTRAINT "order_box_selections_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "order_history" DROP CONSTRAINT "order_history_client_id_fkey";

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_menu_item_id_fkey";

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_vendor_selection_id_fkey";

-- DropForeignKey
ALTER TABLE "order_vendor_selections" DROP CONSTRAINT "order_vendor_selections_order_id_fkey";

-- DropForeignKey
ALTER TABLE "order_vendor_selections" DROP CONSTRAINT "order_vendor_selections_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_client_id_fkey";

-- DropForeignKey
ALTER TABLE "questions" DROP CONSTRAINT "questions_form_id_fkey";

-- DropForeignKey
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_client_id_fkey";

-- DropForeignKey
ALTER TABLE "signatures" DROP CONSTRAINT "signatures_client_id_fkey";

-- DropForeignKey
ALTER TABLE "signatures" DROP CONSTRAINT "signatures_order_id_fkey";

-- DropForeignKey
ALTER TABLE "stops" DROP CONSTRAINT "stops_assigned_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "stops" DROP CONSTRAINT "stops_client_id_fkey";

-- DropForeignKey
ALTER TABLE "stops" DROP CONSTRAINT "stops_order_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_box_selections" DROP CONSTRAINT "upcoming_order_box_selections_box_type_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_box_selections" DROP CONSTRAINT "upcoming_order_box_selections_upcoming_order_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_box_selections" DROP CONSTRAINT "upcoming_order_box_selections_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_items" DROP CONSTRAINT "upcoming_order_items_menu_item_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_items" DROP CONSTRAINT "upcoming_order_items_upcoming_order_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_items" DROP CONSTRAINT "upcoming_order_items_upcoming_vendor_selection_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_items" DROP CONSTRAINT "upcoming_order_items_vendor_selection_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_vendor_selections" DROP CONSTRAINT "upcoming_order_vendor_selections_upcoming_order_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_order_vendor_selections" DROP CONSTRAINT "upcoming_order_vendor_selections_vendor_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_orders" DROP CONSTRAINT "upcoming_orders_client_id_fkey";

-- DropForeignKey
ALTER TABLE "upcoming_orders" DROP CONSTRAINT "upcoming_orders_processed_order_id_fkey";

-- AlterTable
ALTER TABLE "admins" DROP CONSTRAINT "admins_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(36),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "app_settings" ALTER COLUMN "weekly_cutoff_day" DROP NOT NULL,
ALTER COLUMN "weekly_cutoff_time" DROP NOT NULL,
ALTER COLUMN "enable_passwordless_login" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "box_quotas" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "box_types" ALTER COLUMN "is_active" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "city_colors" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "client_statuses" ALTER COLUMN "is_system_default" DROP NOT NULL,
ALTER COLUMN "deliveries_allowed" DROP NOT NULL,
ALTER COLUMN "requires_units_on_change" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "medicaid" DROP NOT NULL,
ALTER COLUMN "paused" DROP NOT NULL,
ALTER COLUMN "complex" DROP NOT NULL,
ALTER COLUMN "bill" DROP NOT NULL,
ALTER COLUMN "delivery" DROP NOT NULL,
ALTER COLUMN "screening_took_place" DROP NOT NULL,
ALTER COLUMN "screening_signed" DROP NOT NULL,
ALTER COLUMN "screening_status" DROP NOT NULL,
ALTER COLUMN "cin" SET DATA TYPE VARCHAR(50),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "drivers" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "equipment" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "form_submissions" ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "forms" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "item_categories" ADD COLUMN     "meal_type" TEXT NOT NULL DEFAULT 'Lunch',
ADD COLUMN     "sort_order" INTEGER DEFAULT 0,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "sort_order" INTEGER DEFAULT 0,
ALTER COLUMN "is_active" DROP NOT NULL,
ALTER COLUMN "minimum_order" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "navigators" ALTER COLUMN "is_active" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "nutritionists" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "order_box_selections" ALTER COLUMN "box_type_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "custom_name" TEXT,
ADD COLUMN     "custom_price" DECIMAL(10,2),
ADD COLUMN     "meal_item_id" VARCHAR(36),
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "menu_item_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "order_vendor_selections" ALTER COLUMN "id" SET DEFAULT (uuid_generate_v4())::text,
ALTER COLUMN "vendor_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "passwordless_codes" ALTER COLUMN "expires_at" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "attempts" DROP NOT NULL;

-- AlterTable
ALTER TABLE "questions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "routes" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "schedules" ALTER COLUMN "monday" DROP NOT NULL,
ALTER COLUMN "tuesday" DROP NOT NULL,
ALTER COLUMN "wednesday" DROP NOT NULL,
ALTER COLUMN "thursday" DROP NOT NULL,
ALTER COLUMN "friday" DROP NOT NULL,
ALTER COLUMN "saturday" DROP NOT NULL,
ALTER COLUMN "sunday" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "stops" ALTER COLUMN "completed" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "upcoming_order_box_selections" ALTER COLUMN "box_type_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "upcoming_order_items" ADD COLUMN     "custom_name" TEXT,
ADD COLUMN     "custom_price" DECIMAL(10,2),
ADD COLUMN     "meal_item_id" VARCHAR(36),
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "menu_item_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "upcoming_order_vendor_selections" ALTER COLUMN "vendor_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "upcoming_orders" ADD COLUMN     "meal_type" TEXT DEFAULT 'Lunch';

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "delivery_frequency" DROP NOT NULL,
ALTER COLUMN "is_active" DROP NOT NULL,
ALTER COLUMN "minimum_meals" DROP NOT NULL,
ALTER COLUMN "cutoff_hours" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "breakfast_categories" (
    "id" VARCHAR(36) NOT NULL DEFAULT (uuid_generate_v4())::text,
    "name" TEXT NOT NULL,
    "set_value" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT timezone('utc'::text, now()),
    "meal_type" TEXT NOT NULL DEFAULT 'Breakfast',
    "sort_order" INTEGER DEFAULT 0,

    CONSTRAINT "breakfast_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breakfast_items" (
    "id" VARCHAR(36) NOT NULL DEFAULT (uuid_generate_v4())::text,
    "category_id" VARCHAR(36),
    "name" TEXT NOT NULL,
    "quota_value" DECIMAL(10,2) DEFAULT 1,
    "price_each" DECIMAL(10,2),
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT timezone('utc'::text, now()),
    "sort_order" INTEGER DEFAULT 0,
    "image_url" TEXT,

    CONSTRAINT "breakfast_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_box_orders" (
    "id" VARCHAR(36) NOT NULL DEFAULT (uuid_generate_v4())::text,
    "client_id" VARCHAR(36) NOT NULL,
    "case_id" TEXT,
    "box_type_id" VARCHAR(36),
    "vendor_id" VARCHAR(36),
    "quantity" INTEGER DEFAULT 1,
    "items" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_box_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_breakfast_categories_meal_type" ON "breakfast_categories"("meal_type");

-- CreateIndex
CREATE INDEX "breakfast_items_category_id_idx" ON "breakfast_items"("category_id");

-- CreateIndex
CREATE INDEX "idx_item_categories_meal_type" ON "item_categories"("meal_type");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_meal_item_id_fkey" FOREIGN KEY ("meal_item_id") REFERENCES "breakfast_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "fk_stops_order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "upcoming_order_items" ADD CONSTRAINT "upcoming_order_items_meal_item_id_fkey" FOREIGN KEY ("meal_item_id") REFERENCES "breakfast_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "breakfast_items" ADD CONSTRAINT "breakfast_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "breakfast_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_box_orders" ADD CONSTRAINT "client_box_orders_box_type_id_fkey" FOREIGN KEY ("box_type_id") REFERENCES "box_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_box_orders" ADD CONSTRAINT "client_box_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_box_orders" ADD CONSTRAINT "client_box_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
