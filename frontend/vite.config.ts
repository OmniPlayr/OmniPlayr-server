import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ensure-plugins-dir',
      buildStart() {
        const dirNames = process.env.NODE_ENV === 'production'
          ? ['plugins']
          : ['plugins', 'local-plugins']
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
