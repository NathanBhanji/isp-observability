import type { NextConfig } from "next";
import { join } from "path";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@isp/shared"],
  serverExternalPackages: [],
  output: "standalone",
  // Required for standalone output in a monorepo — trace from the repo root
  // so workspace packages (like @isp/shared) are included in the output
  outputFileTracingRoot: join(__dirname, "../../"),
};

export default nextConfig;
