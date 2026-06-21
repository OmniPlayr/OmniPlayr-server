import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import JSON5 from 'json5'

type TranslationTree = Record<string, unknown>
type Resources = Record<string, Record<string, TranslationTree>>

const parseTranslation = (path: string, raw: string) =>
  path.endsWith('.json5') ? JSON5.parse(raw) : JSON.parse(raw)

const addResource = (
  resources: Resources,
  language: string,
  namespace: string,
  translation: TranslationTree
) => {
  resources[language] ??= {}
  resources[language][namespace] = translation
}

const loadTranslations = (): Resources => {
  const coreModules = import.meta.glob('../locales/**/translation.{json,json5}', {
    eager: true,
    query: '?raw',
    import: 'default'
  }) as Record<string, string>
  const pluginModules = import.meta.glob([
    '../plugins/*/locales/*.{json,json5}',
    '../plugins/*/locales/*/translation.{json,json5}'
  ], {
    eager: true,
    query: '?raw',
    import: 'default'
  }) as Record<string, string>

  const resources: Resources = {}

  for (const path in coreModules) {
    const lng = path.split('/')[2]
    addResource(resources, lng, 'translation', parseTranslation(path, coreModules[path]))
  }

  for (const path in pluginModules) {
    const parts = path.split('/')
    const pluginId = parts[2]
    const lng = parts[4].replace(/\.(json5?|JSON5?)$/, '')
    addResource(resources, lng, pluginId, parseTranslation(path, pluginModules[path]))
  }

  return resources
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: loadTranslations(),
    defaultNS: 'translation',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    missingKeyHandler: (lngs, ns, key) => {
      console.error(`[i18n missing key] lngs=${lngs} ns=${ns} key=${key}`)
    }
  })

i18n.on('failedLoading', (lng, ns, msg) => {
  console.error(`[i18n failed loading] lng=${lng} ns=${ns} msg=${msg}`)
})

if (import.meta.hot) {
  import.meta.hot.accept(
    Object.keys(
      import.meta.glob('../locales/**/translation.{json,json5}', { query: '?raw' })
    ),
    (modules) => {
      if (!modules) return
      for (const mod of modules) {
        if (!mod) continue
        const hotModule = mod as { __hmrId?: string; default?: string }
        const path = hotModule.__hmrId ?? ''
        const lng = path.split('/')[2]
        if (!lng) continue
        const raw = hotModule.default
        if (!raw) continue
        i18n.addResourceBundle(lng, 'translation', parseTranslation(path, raw), true, true)
      }
    }
  )
}

export default i18n
