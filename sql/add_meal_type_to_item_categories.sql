-- Add meal_type column to item_categories table
ALTER TABLE item_categories 
ADD COLUMN IF NOT EXISTS meal_type TEXT NOT NULL DEFAULT 'Lunch';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_item_categories_meal_type ON item_categories(meal_type);
