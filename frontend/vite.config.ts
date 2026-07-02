import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

function isSplitLocalFrontendImporter(importer?: string): boolean {
  if (!importer) return false
  const normalised = importer.replaceAll('\\', '/')
  return /\/src\/local-(?:frontend-)?plugins\/.+\/frontend\//.test(normalised)
}

const coreImportPattern = /^\.\.\/\.\.\/(modules|i18n|assets|styles|config)(\/.*)?$/

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@omniplayr/plugins': path.resolve(__dirname, 'src/modules/pluginSdk.ts'),
    },
  },
  plugins: [
    react(),
    {
      name: 'local-plugin-split-imports',
      async resolveId(source, importer) {
        if (!isSplitLocalFrontendImporter(importer) || !coreImportPattern.test(source)) {
          return null
        }

        const target = path.resolve(__dirname, 'src', source.slice('../../'.length))
        const resolved = await this.resolve(target, importer, { skipSelf: true })
        return resolved?.id ?? target
      },
    },
    {
      name: 'ensure-plugins-dir',
      buildStart() {
        const dirNames = process.env.NODE_ENV === 'production'
          ? ['plugins']
          : ['plugins', 'local-plugins', 'local-frontend-plugins']
        for (const dirName of dirNames) {
          const dir = path.resolve(__dirname, 'src', dirName)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
        }
      },
    },
  ],
  server: {
    allowedHosts: true
  }
})
