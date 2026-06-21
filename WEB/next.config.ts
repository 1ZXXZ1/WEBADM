// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",                    // ← ИЗМЕНИТЬ: было "standalone"
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // SPA: при static export реврайты не нужны — Go-сервер делает fallback
  images: {
    unoptimized: true,                 // ← ДОБАВИТЬ: обязательно для export
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
