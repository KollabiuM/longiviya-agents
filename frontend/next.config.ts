import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable static export for production builds
  output: "export",
  // Disable image optimization (not supported in static export)
  images: {
    unoptimized: true,
  },
  // ARC-026: reactStrictMode is disabled globally. StrictMode's dev-only
  // double-mount races with @pixi/react v8's <Application> WebGL context
  // creation: the second mount tries to acquire a context while the first is
  // still initializing, hanging the tab on floor view entry. The project's
  // manual singleton cleanup (hmrCleanup.ts) cannot defeat the mount ->
  // unmount -> mount sequence StrictMode emits.
  //
  // Tested 2026-07-07 with @pixi/react 8.0.5, pixi.js 8.19.0, next 16.2.9,
  // react 19.2.7: still reproduces (tab hangs on hard-reload of floor view).
  //
  // Revisit: bump @pixi/react to a v8.x release that publishes a double-mount
  // fix, then re-run the floor-view hard-reload repro before flipping to true.
  // Original disable: commit f4fc22b.
  reactStrictMode: false,
};

export default nextConfig;
