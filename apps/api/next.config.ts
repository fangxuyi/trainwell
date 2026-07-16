import type { NextConfig } from "next";

function exerciseMediaPattern(): URL[] {
  const mediaBaseUrl = process.env.EXERCISE_MEDIA_BASE_URL?.trim();
  if (!mediaBaseUrl) return [];

  try {
    const pattern = new URL(mediaBaseUrl);
    if (pattern.protocol !== "https:") return [];
    pattern.pathname = `${pattern.pathname.replace(/\/*$/, "/")}**`;
    return [pattern];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: exerciseMediaPattern(),
  },
};

export default nextConfig;
