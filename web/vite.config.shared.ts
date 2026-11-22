import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import type { UserConfig } from 'vite'

interface BuildTarget {
  outDir: string
  entry: string
  name: string
  define: Record<string, string>
  /** The app's page loads ES modules, so the lazy views and their libraries become chunks next to index.js. The VS Code webview stays one script. */
  chunked?: boolean
}

export function createBuildConfig(target: BuildTarget): UserConfig {
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname),
        'three/webgpu': resolve(__dirname, 'lib/no-webgpu.ts'),
      },
    },
    publicDir: false,
    build: {
      outDir: resolve(__dirname, target.outDir),
      emptyOutDir: true,
      lib: {
        entry: resolve(__dirname, target.entry),
        formats: [target.chunked ? 'es' : 'iife'],
        name: target.name,
        fileName: () => 'index',
      },
      // @ts-expect-error: cssFileName is valid in Vite 8 but not yet in @types
      cssFileName: 'index',
      sourcemap: false,
      minify: true,
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
          ...(target.chunked ? { chunkFileNames: '[name]-[hash].js' } : {}),
          assetFileNames: (info: { names?: string[] }) => {
            if (info.names?.[0]?.endsWith('.css')) return 'index.css'
            return '[name].[ext]'
          },
        },
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      ...target.define,
    },
  }
}
