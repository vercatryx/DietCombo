-- Add cutoff_hours column to vendors table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'cutoff_hours') THEN
        ALTER TABLE vendors ADD COLUMN cutoff_hours INTEGER DEFAULT 0;
    END IF;
END $$;
