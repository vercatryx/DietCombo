-- Driver color storage for manual color on Routes page.
-- drivers.color is used to show each driver's color on the map and in route labels.
-- Safe to run: adds column if missing; optionally widens to varchar(14) for hex colors.

-- Ensure column exists (no-op if already present)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS color VARCHAR(14);

-- Optional: ensure type is wide enough for hex colors (e.g. #RRGGBB or #RRGGBBAA)
-- Uncomment if your drivers table had color as VARCHAR(7) and you want to allow longer values:
-- ALTER TABLE drivers ALTER COLUMN color TYPE varchar(14);
