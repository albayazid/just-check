-- ============================================================================
-- SETTINGS SEPARATION
-- Split user_settings.settings_data into privacy_settings and ai_customization_settings
-- Version: 014
-- ============================================================================

BEGIN;

-- Add two new columns
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS privacy_settings JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_customization_settings JSONB NOT NULL DEFAULT '{}';

-- Migrate data from monolithic settings_data
UPDATE public.user_settings
SET
  privacy_settings = COALESCE(settings_data->'privacySettings', '{}'),
  ai_customization_settings = COALESCE(settings_data->'aiCustomizationSettings', '{}')
WHERE settings_data IS NOT NULL AND settings_data != '{}'::jsonb;

-- Drop old column
ALTER TABLE public.user_settings DROP COLUMN IF EXISTS settings_data;

COMMIT;
