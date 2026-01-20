-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "is_default" BOOLEAN DEFAULT false;

-- Update the specific vendor to be the default
UPDATE "vendors" SET "is_default" = true WHERE "id" = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
