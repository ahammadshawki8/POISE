import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is a camera/mic app; React's dev double-mount would double-initialize
  // getUserMedia and the recognizer. Disable it for predictable auto-start.
  reactStrictMode: false,
  // sharp is a native module used server-side for spatial mask analysis.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
