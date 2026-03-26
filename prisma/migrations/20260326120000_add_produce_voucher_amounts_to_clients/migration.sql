-- Produce-only voucher amounts (free text). Hidden in UI for Food clients; cleared when service type is not Produce.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "voucher_amount_regular" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "voucher_amount_dependents" TEXT;
