-- Single free-text voucher amount per client (each dependent row has its own value).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "voucher_amount" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'voucher_amount_regular'
    ) THEN
        UPDATE "clients" SET "voucher_amount" = (
            CASE
                WHEN NULLIF(btrim(COALESCE("voucher_amount", '')), '') IS NOT NULL THEN btrim("voucher_amount")
                WHEN NULLIF(btrim(COALESCE("voucher_amount_regular", '')), '') IS NOT NULL
                 AND NULLIF(btrim(COALESCE("voucher_amount_dependents", '')), '') IS NOT NULL
                THEN btrim("voucher_amount_regular") || ' | ' || btrim("voucher_amount_dependents")
                WHEN NULLIF(btrim(COALESCE("voucher_amount_regular", '')), '') IS NOT NULL THEN btrim("voucher_amount_regular")
                WHEN NULLIF(btrim(COALESCE("voucher_amount_dependents", '')), '') IS NOT NULL THEN btrim("voucher_amount_dependents")
                ELSE "voucher_amount"
            END
        );
    END IF;
END $$;

ALTER TABLE "clients" DROP COLUMN IF EXISTS "voucher_amount_regular";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "voucher_amount_dependents";
