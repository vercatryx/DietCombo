-- Second delivery proof photo (first remains proof_of_delivery_url).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "proof_of_delivery_image" VARCHAR(500);
