import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(currentDirectory, "../.."),
  async rewrites() {
    const apiBaseUrl =
      process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

    return [
      {
        source: "/v1/:path*",
        destination: `${apiBaseUrl}/v1/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },
};

export default nextConfig;
