import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle at .next/standalone, which is what
  // the Dockerfile's runtime stage copies. ~10x smaller than shipping node_modules.
  output: "standalone",
};

export default nextConfig;
