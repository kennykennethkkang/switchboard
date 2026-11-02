/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Same stub as vite.config.shared.ts: the Memory view never uses WebGPU.
  turbopack: { resolveAlias: { 'three/webgpu': './lib/no-webgpu.ts' } },
  webpack: config => {
    config.resolve.alias['three/webgpu'] = new URL('./lib/no-webgpu.ts', import.meta.url).pathname
    return config
  },
}

export default nextConfig
