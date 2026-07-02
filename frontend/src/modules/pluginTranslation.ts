import i18n from '../i18n'
import { useTranslation } from 'react-i18next'

export interface PluginTranslationHookResult {
  t: (key: string, options?: any) => string;
  i18n: any;
  ready?: boolean;
}

export interface PluginTranslationsApi {
  useTranslation: () => PluginTranslationHookResult;
  t: (key: string, options?: any) => string;
}

export function definePluginTranslations(pluginId: string): PluginTranslationsApi {
  if (!i18n.hasResourceBundle('en', pluginId)) {
    console.warn(
      `[plugins] "${pluginId}" has no English locale; missing translations cannot fall back to English`
    )
  }

  return {
    useTranslation: () => useTranslation(pluginId) as unknown as PluginTranslationHookResult,
    t: i18n.getFixedT(null, pluginId) as unknown as (key: string, options?: any) => string
  }
}
