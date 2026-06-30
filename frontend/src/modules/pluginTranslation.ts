import i18n from '../i18n'
import { useTranslation } from 'react-i18next'

export function definePluginTranslations(pluginId: string) {
  if (!i18n.hasResourceBundle('en', pluginId)) {
    console.warn(
      `[plugins] "${pluginId}" has no English locale; missing translations cannot fall back to English`
    )
  }

  return {
    useTranslation: () => useTranslation(pluginId),
    t: i18n.getFixedT(null, pluginId)
  }
}
