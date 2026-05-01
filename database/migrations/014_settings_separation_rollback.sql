-- ============================================================================
-- SETTINGS SEPARATION ROLLBACK
-- Re-create settings_data column from separated columns
-- Version: 014 rollback
-- ============================================================================

BEGIN;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS settings_data JSONB NOT NULL DEFAULT '{}';

UPDATE public.user_settings
SET settings_data = jsonb_build_object(
  'privacySettings', privacy_settings,
  'aiCustomizationSettings', ai_customization_settings
);

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS privacy_settings,
  DROP COLUMN IF EXISTS ai_customization_settings;

COMMIT;
