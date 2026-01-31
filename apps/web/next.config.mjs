/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@nexusai/shared"],
  experimental: {
    typedRoutes: false,
  },
  async rewrites() {
    const orchestrator = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";
    return [
      { source: "/api/orch/:path*", destination: `${orchestrator}/:path*` },
    ];
  },
};

export default nextConfig;
