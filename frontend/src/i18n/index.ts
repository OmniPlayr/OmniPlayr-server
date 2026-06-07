import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import JSON5 from 'json5'

type Resource = {
  translation: Record<string, string>
}

const parseTranslation = (path: string, raw: string) =>
  path.endsWith('.json5') ? JSON5.parse(raw) : JSON.parse(raw)

const loadTranslations = (): Record<string, Resource> => {
  const modules = import.meta.glob('../locales/**/translation.{json,json5}', {
    eager: true,
    query: '?raw',
    import: 'default'
  }) as Record<string, string>

  const resources: Record<string, Resource> = {}

  for (const path in modules) {
    const lng = path.split('/')[2]
    resources[lng] = { translation: parseTranslation(path, modules[path]) }
  }

  return resources
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: loadTranslations(),
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
        const path: string = (mod as any).__hmrId ?? ''
        const lng = path.split('/')[2]
        if (!lng) continue
        const raw = (mod as any).default as string
        i18n.addResourceBundle(lng, 'translation', parseTranslation(path, raw), true, true)
      }
    }
  )
}

export default i18n