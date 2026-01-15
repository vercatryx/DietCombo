-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" VARCHAR(36) NOT NULL DEFAULT '1',
    "weekly_cutoff_day" VARCHAR(50) NOT NULL DEFAULT 'Friday',
    "weekly_cutoff_time" VARCHAR(50) NOT NULL DEFAULT '17:00',
    "report_email" VARCHAR(255),
    "enable_passwordless_login" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_records" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "order_id" VARCHAR(36),
    "status" VARCHAR(50) NOT NULL,
    "remarks" TEXT,
    "navigator" VARCHAR(255),
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_quotas" (
    "id" VARCHAR(36) NOT NULL,
    "box_type_id" VARCHAR(36) NOT NULL,
    "category_id" VARCHAR(36) NOT NULL,
    "target_value" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "box_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_types" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "vendor_id" VARCHAR(36),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "price_each" DECIMAL(10,2),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "box_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_colors" (
    "id" VARCHAR(36) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "updated_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_statuses" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "is_system_default" BOOLEAN NOT NULL DEFAULT false,
    "deliveries_allowed" BOOLEAN NOT NULL DEFAULT true,
    "requires_units_on_change" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "client_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" VARCHAR(36) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(255),
    "last_name" VARCHAR(255),
    "email" VARCHAR(255),
    "address" TEXT,
    "apt" VARCHAR(50),
    "city" VARCHAR(100),
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "county" VARCHAR(100),
    "phone_number" VARCHAR(255),
    "secondary_phone_number" VARCHAR(255),
    "client_id_external" VARCHAR(100),
    "case_id_external" VARCHAR(100),
    "medicaid" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "complex" BOOLEAN NOT NULL DEFAULT false,
    "bill" BOOLEAN NOT NULL DEFAULT true,
    "delivery" BOOLEAN NOT NULL DEFAULT true,
    "dislikes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geocoded_at" TIMESTAMP,
    "billings" JSONB,
    "visits" JSONB,
    "sign_token" VARCHAR(255),
    "navigator_id" VARCHAR(36),
    "end_date" DATE,
    "screening_took_place" BOOLEAN NOT NULL DEFAULT false,
    "screening_signed" BOOLEAN NOT NULL DEFAULT false,
    "screening_status" VARCHAR(50) NOT NULL DEFAULT 'not_started',
    "notes" TEXT,
    "status_id" VARCHAR(36),
    "service_type" VARCHAR(50) NOT NULL,
    "approved_meals_per_week" INTEGER,
    "parent_client_id" VARCHAR(36),
    "dob" DATE,
    "cin" DECIMAL(10,0),
    "authorized_amount" DECIMAL(10,2),
    "expiration_date" DATE,
    "active_order" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,
    "updated_by" VARCHAR(255),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_history" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36) NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "delivery_date" DATE NOT NULL,
    "items_summary" TEXT,
    "proof_of_delivery_image" VARCHAR(500),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" VARCHAR(36) NOT NULL,
    "day" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(7),
    "stop_ids" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "vendor_id" VARCHAR(36),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filled_forms" (
    "id" VARCHAR(36) NOT NULL,
    "form_id" VARCHAR(36) NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filled_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" VARCHAR(36) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_answers" (
    "id" VARCHAR(36) NOT NULL,
    "filled_form_id" VARCHAR(36) NOT NULL,
    "question_id" VARCHAR(36) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" VARCHAR(36) NOT NULL,
    "form_id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36),
    "token" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "data" JSONB,
    "signature_url" VARCHAR(500),
    "pdf_url" VARCHAR(500),
    "comments" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "set_value" DECIMAL(10,2),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36),
    "name" VARCHAR(255) NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "price_each" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_id" VARCHAR(36),
    "quota_value" DECIMAL(10,2),
    "minimum_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "navigators" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "password" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "navigators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "navigator_logs" (
    "id" VARCHAR(36) NOT NULL,
    "navigator_id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "navigator_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutritionists" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "nutritionists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "case_id" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "scheduled_delivery_date" DATE,
    "actual_delivery_date" DATE,
    "delivery_day" VARCHAR(50),
    "delivery_distribution" JSONB,
    "total_value" DECIMAL(10,2),
    "total_items" INTEGER,
    "notes" TEXT,
    "proof_of_delivery_url" VARCHAR(500),
    "order_number" INTEGER,
    "last_updated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_box_selections" (
    "id" VARCHAR(36) NOT NULL,
    "order_id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36) NOT NULL,
    "box_type_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_box_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_history" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "who" VARCHAR(255) NOT NULL,
    "summary" TEXT NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" VARCHAR(36) NOT NULL,
    "vendor_selection_id" VARCHAR(36) NOT NULL,
    "menu_item_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_vendor_selections" (
    "id" VARCHAR(36) NOT NULL,
    "order_id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36) NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_vendor_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passwordless_codes" (
    "id" VARCHAR(36) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "passwordless_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" VARCHAR(36) NOT NULL,
    "form_id" VARCHAR(36) NOT NULL,
    "text" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "options" JSONB,
    "conditional_text_inputs" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(7),
    "stop_ids" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_runs" (
    "id" VARCHAR(36) NOT NULL,
    "day" VARCHAR(20) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "monday" BOOLEAN NOT NULL DEFAULT true,
    "tuesday" BOOLEAN NOT NULL DEFAULT true,
    "wednesday" BOOLEAN NOT NULL DEFAULT true,
    "thursday" BOOLEAN NOT NULL DEFAULT true,
    "friday" BOOLEAN NOT NULL DEFAULT true,
    "saturday" BOOLEAN NOT NULL DEFAULT true,
    "sunday" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" VARCHAR(36) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "order_id" VARCHAR(36),
    "slot" INTEGER NOT NULL,
    "strokes" JSONB NOT NULL,
    "signed_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" VARCHAR(36) NOT NULL,
    "day" VARCHAR(20) NOT NULL,
    "delivery_date" DATE,
    "client_id" VARCHAR(36),
    "order_id" VARCHAR(36),
    "order" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "apt" VARCHAR(50),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "zip" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20),
    "dislikes" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "proof_url" VARCHAR(500),
    "assigned_driver_id" VARCHAR(36),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upcoming_orders" (
    "id" VARCHAR(36) NOT NULL,
    "client_id" VARCHAR(36) NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "case_id" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    "scheduled_delivery_date" DATE,
    "take_effect_date" DATE,
    "delivery_day" VARCHAR(50),
    "delivery_distribution" JSONB,
    "total_value" DECIMAL(10,2),
    "total_items" INTEGER,
    "notes" TEXT,
    "order_number" INTEGER,
    "processed_order_id" VARCHAR(36),
    "processed_at" TIMESTAMP,
    "last_updated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upcoming_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upcoming_order_box_selections" (
    "id" VARCHAR(36) NOT NULL,
    "upcoming_order_id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36) NOT NULL,
    "box_type_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upcoming_order_box_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upcoming_order_items" (
    "id" VARCHAR(36) NOT NULL,
    "upcoming_order_id" VARCHAR(36) NOT NULL,
    "vendor_selection_id" VARCHAR(36),
    "upcoming_vendor_selection_id" VARCHAR(36),
    "menu_item_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upcoming_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upcoming_order_vendor_selections" (
    "id" VARCHAR(36) NOT NULL,
    "upcoming_order_id" VARCHAR(36) NOT NULL,
    "vendor_id" VARCHAR(36) NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upcoming_order_vendor_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "password" VARCHAR(255),
    "service_type" VARCHAR(255),
    "delivery_days" JSONB,
    "delivery_frequency" VARCHAR(50) NOT NULL DEFAULT 'Once',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "minimum_meals" INTEGER NOT NULL DEFAULT 0,
    "cutoff_hours" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE INDEX "idx_billing_records_client_id" ON "billing_records"("client_id");

-- CreateIndex
CREATE INDEX "idx_billing_records_order_id" ON "billing_records"("order_id");

-- CreateIndex
CREATE INDEX "idx_box_quotas_box_type_id" ON "box_quotas"("box_type_id");

-- CreateIndex
CREATE INDEX "idx_box_quotas_category_id" ON "box_quotas"("category_id");

-- CreateIndex
CREATE INDEX "idx_box_types_vendor_id" ON "box_types"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "city_colors_city_key" ON "city_colors"("city");

-- CreateIndex
CREATE UNIQUE INDEX "clients_sign_token_key" ON "clients"("sign_token");

-- CreateIndex
CREATE INDEX "idx_clients_client_id_external" ON "clients"("client_id_external");

-- CreateIndex
CREATE INDEX "idx_clients_case_id_external" ON "clients"("case_id_external");

-- CreateIndex
CREATE INDEX "idx_clients_sign_token" ON "clients"("sign_token");

-- CreateIndex
CREATE INDEX "idx_clients_navigator_id" ON "clients"("navigator_id");

-- CreateIndex
CREATE INDEX "idx_clients_status_id" ON "clients"("status_id");

-- CreateIndex
CREATE INDEX "idx_clients_parent_client_id" ON "clients"("parent_client_id");

-- CreateIndex
CREATE INDEX "idx_delivery_history_client_id" ON "delivery_history"("client_id");

-- CreateIndex
CREATE INDEX "idx_delivery_history_vendor_id" ON "delivery_history"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_drivers_day" ON "drivers"("day");

-- CreateIndex
CREATE INDEX "idx_drivers_name" ON "drivers"("name");

-- CreateIndex
CREATE INDEX "idx_equipment_vendor_id" ON "equipment"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_filled_forms_form_id" ON "filled_forms"("form_id");

-- CreateIndex
CREATE INDEX "idx_form_answers_filled_form_id" ON "form_answers"("filled_form_id");

-- CreateIndex
CREATE INDEX "idx_form_answers_question_id" ON "form_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_token_key" ON "form_submissions"("token");

-- CreateIndex
CREATE INDEX "idx_form_submissions_token" ON "form_submissions"("token");

-- CreateIndex
CREATE INDEX "idx_form_submissions_client_id" ON "form_submissions"("client_id");

-- CreateIndex
CREATE INDEX "idx_form_submissions_form_id" ON "form_submissions"("form_id");

-- CreateIndex
CREATE INDEX "idx_menu_items_vendor_id" ON "menu_items"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_menu_items_category_id" ON "menu_items"("category_id");

-- CreateIndex
CREATE INDEX "idx_navigator_logs_navigator_id" ON "navigator_logs"("navigator_id");

-- CreateIndex
CREATE INDEX "idx_navigator_logs_client_id" ON "navigator_logs"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "idx_orders_order_number" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "idx_orders_client_id" ON "orders"("client_id");

-- CreateIndex
CREATE INDEX "idx_orders_status" ON "orders"("status");

-- CreateIndex
CREATE INDEX "idx_orders_scheduled_delivery_date" ON "orders"("scheduled_delivery_date");

-- CreateIndex
CREATE INDEX "idx_order_box_selections_order_id" ON "order_box_selections"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_box_selections_vendor_id" ON "order_box_selections"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_order_box_selections_box_type_id" ON "order_box_selections"("box_type_id");

-- CreateIndex
CREATE INDEX "idx_order_history_client_id" ON "order_history"("client_id");

-- CreateIndex
CREATE INDEX "idx_order_items_vendor_selection_id" ON "order_items"("vendor_selection_id");

-- CreateIndex
CREATE INDEX "idx_order_items_menu_item_id" ON "order_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "idx_order_vendor_selections_order_id" ON "order_vendor_selections"("order_id");

-- CreateIndex
CREATE INDEX "idx_order_vendor_selections_vendor_id" ON "order_vendor_selections"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_passwordless_codes_email" ON "passwordless_codes"("email");

-- CreateIndex
CREATE INDEX "idx_questions_form_id" ON "questions"("form_id");

-- CreateIndex
CREATE INDEX "idx_routes_name" ON "routes"("name");

-- CreateIndex
CREATE INDEX "idx_route_runs_day" ON "route_runs"("day");

-- CreateIndex
CREATE INDEX "idx_route_runs_created_at" ON "route_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_client_id_key" ON "schedules"("client_id");

-- CreateIndex
CREATE INDEX "idx_schedules_client_id" ON "schedules"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "idx_settings_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "idx_signatures_client_id" ON "signatures"("client_id");

-- CreateIndex
CREATE INDEX "idx_signatures_signed_at" ON "signatures"("signed_at");

-- CreateIndex
CREATE INDEX "idx_signatures_order_id" ON "signatures"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_client_id_slot_key" ON "signatures"("client_id", "slot");

-- CreateIndex
CREATE INDEX "idx_stops_day" ON "stops"("day");

-- CreateIndex
CREATE INDEX "idx_stops_delivery_date" ON "stops"("delivery_date");

-- CreateIndex
CREATE INDEX "idx_stops_client_id" ON "stops"("client_id");

-- CreateIndex
CREATE INDEX "idx_stops_order_id" ON "stops"("order_id");

-- CreateIndex
CREATE INDEX "idx_stops_completed" ON "stops"("completed");

-- CreateIndex
CREATE INDEX "idx_upcoming_orders_order_number" ON "upcoming_orders"("order_number");

-- CreateIndex
CREATE INDEX "idx_upcoming_orders_processed_order_id" ON "upcoming_orders"("processed_order_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_orders_client_id" ON "upcoming_orders"("client_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_orders_status" ON "upcoming_orders"("status");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_box_selections_upcoming_order_id" ON "upcoming_order_box_selections"("upcoming_order_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_box_selections_vendor_id" ON "upcoming_order_box_selections"("vendor_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_box_selections_box_type_id" ON "upcoming_order_box_selections"("box_type_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_items_upcoming_order_id" ON "upcoming_order_items"("upcoming_order_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_items_vendor_selection_id" ON "upcoming_order_items"("vendor_selection_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_items_upcoming_vendor_selection_id" ON "upcoming_order_items"("upcoming_vendor_selection_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_items_menu_item_id" ON "upcoming_order_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_vendor_selections_upcoming_order_id" ON "upcoming_order_vendor_selections"("upcoming_order_id");

-- CreateIndex
CREATE INDEX "idx_upcoming_order_vendor_selections_vendor_id" ON "upcoming_order_vendor_selections"("vendor_id");

-- AddForeignKey
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_quotas" ADD CONSTRAINT "box_quotas_box_type_id_fkey" FOREIGN KEY ("box_type_id") REFERENCES "box_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_quotas" ADD CONSTRAINT "box_quotas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_types" ADD CONSTRAINT "box_types_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_navigator_id_fkey" FOREIGN KEY ("navigator_id") REFERENCES "navigators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "client_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_parent_client_id_fkey" FOREIGN KEY ("parent_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_history" ADD CONSTRAINT "delivery_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_history" ADD CONSTRAINT "delivery_history_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filled_forms" ADD CONSTRAINT "filled_forms_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_filled_form_id_fkey" FOREIGN KEY ("filled_form_id") REFERENCES "filled_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigator_logs" ADD CONSTRAINT "navigator_logs_navigator_id_fkey" FOREIGN KEY ("navigator_id") REFERENCES "navigators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigator_logs" ADD CONSTRAINT "navigator_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_box_selections" ADD CONSTRAINT "order_box_selections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_box_selections" ADD CONSTRAINT "order_box_selections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_box_selections" ADD CONSTRAINT "order_box_selections_box_type_id_fkey" FOREIGN KEY ("box_type_id") REFERENCES "box_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendor_selection_id_fkey" FOREIGN KEY ("vendor_selection_id") REFERENCES "order_vendor_selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_vendor_selections" ADD CONSTRAINT "order_vendor_selections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_vendor_selections" ADD CONSTRAINT "order_vendor_selections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stops" ADD CONSTRAINT "stops_assigned_driver_id_fkey" FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_orders" ADD CONSTRAINT "upcoming_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_orders" ADD CONSTRAINT "upcoming_orders_processed_order_id_fkey" FOREIGN KEY ("processed_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_box_selections" ADD CONSTRAINT "upcoming_order_box_selections_upcoming_order_id_fkey" FOREIGN KEY ("upcoming_order_id") REFERENCES "upcoming_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_box_selections" ADD CONSTRAINT "upcoming_order_box_selections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_box_selections" ADD CONSTRAINT "upcoming_order_box_selections_box_type_id_fkey" FOREIGN KEY ("box_type_id") REFERENCES "box_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_items" ADD CONSTRAINT "upcoming_order_items_upcoming_order_id_fkey" FOREIGN KEY ("upcoming_order_id") REFERENCES "upcoming_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_items" ADD CONSTRAINT "upcoming_order_items_vendor_selection_id_fkey" FOREIGN KEY ("vendor_selection_id") REFERENCES "order_vendor_selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_items" ADD CONSTRAINT "upcoming_order_items_upcoming_vendor_selection_id_fkey" FOREIGN KEY ("upcoming_vendor_selection_id") REFERENCES "upcoming_order_vendor_selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_items" ADD CONSTRAINT "upcoming_order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_vendor_selections" ADD CONSTRAINT "upcoming_order_vendor_selections_upcoming_order_id_fkey" FOREIGN KEY ("upcoming_order_id") REFERENCES "upcoming_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upcoming_order_vendor_selections" ADD CONSTRAINT "upcoming_order_vendor_selections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
