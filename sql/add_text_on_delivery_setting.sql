ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS text_on_delivery BOOLEAN DEFAULT false;
