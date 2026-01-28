-- AlterTable
ALTER TABLE "orders" ADD COLUMN "vendor_id" VARCHAR(36);

-- CreateIndex
CREATE INDEX "idx_orders_vendor_id" ON "orders"("vendor_id");

-- Update existing orders to use default vendor
-- First, get the default vendor ID (vendor with is_default = true, or first vendor if none)
-- Then update all orders to use that vendor_id
DO $$
DECLARE
    default_vendor_id VARCHAR(36);
BEGIN
    -- Find default vendor (is_default = true, or first active vendor)
    SELECT id INTO default_vendor_id
    FROM vendors
    WHERE is_default = true
    LIMIT 1;
    
    -- If no default vendor, use first active vendor
    IF default_vendor_id IS NULL THEN
        SELECT id INTO default_vendor_id
        FROM vendors
        WHERE is_active != false
        LIMIT 1;
    END IF;
    
    -- If still no vendor, use first vendor
    IF default_vendor_id IS NULL THEN
        SELECT id INTO default_vendor_id
        FROM vendors
        LIMIT 1;
    END IF;
    
    -- Update all existing orders to use default vendor
    IF default_vendor_id IS NOT NULL THEN
        UPDATE "orders" SET "vendor_id" = default_vendor_id WHERE "vendor_id" IS NULL;
    END IF;
END $$;
