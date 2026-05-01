/**
 * Privacy Settings
 */
export interface PrivacySettings {
  shareAnonymousData: boolean;
  shareDiagnostics: boolean;
}

/**
 * AI Customization Settings
 */
export interface AICustomizationSettings {
  aiNickname: string;
  userNickname: string;
  userProfession: string;
  preferredTopics: string;
  avoidTopics: string;
  moreAboutYou: string;
  aiTone: 'default' | 'friendly' | 'warmer' | 'professional' | 'gen-z';
  responseLength: 'default' | 'concise' | 'detail';
  customInstructions: string;
  memoryEnabled: boolean;
}

/**
 * Default privacy settings
 */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  shareAnonymousData: true,
  shareDiagnostics: true,
};

/**
 * Default AI customization settings
 */
export const DEFAULT_AI_CUSTOMIZATION_SETTINGS: AICustomizationSettings = {
  aiNickname: '',
  userNickname: '',
  userProfession: '',
  preferredTopics: '',
  avoidTopics: '',
  moreAboutYou: '',
  aiTone: 'default',
  responseLength: 'default',
  customInstructions: '',
  memoryEnabled: true,
};

/**
 * Privacy settings API response
 */
export interface PrivacySettingsResponse {
  id: string;
  clerk_user_id: string;
  privacy_settings: PrivacySettings;
  created_at: string;
  updated_at: string;
}

/**
 * AI customization settings API response
 */
export interface AICustomizationSettingsResponse {
  id: string;
  clerk_user_id: string;
  ai_customization_settings: AICustomizationSettings;
  created_at: string;
  updated_at: string;
}
