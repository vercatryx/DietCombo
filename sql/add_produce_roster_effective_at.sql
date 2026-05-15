-- Produce weekly roster: when the client became eligible for vendor rosters (new produce or vendor switch).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS produce_roster_effective_at TIMESTAMPTZ;

-- Backfill from account creation; Food→Produce transitions will be corrected on next save or can be re-run after app deploy sets the field on updates.
UPDATE clients
SET produce_roster_effective_at = created_at
WHERE produce_roster_effective_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_produce_roster_effective_at ON clients (produce_roster_effective_at)
WHERE produce_roster_effective_at IS NOT NULL;
