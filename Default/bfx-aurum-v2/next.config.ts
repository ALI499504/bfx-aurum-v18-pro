import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* فحص TypeScript في البناء مفعل — كود معطوب لا يدعم أنواعه لا يدخل الإنتاج بصمت */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
