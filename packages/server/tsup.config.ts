import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node22",
  splitting: false,
  shims: false,
  external: ["better-auth", "better-sqlite3", "@supacrawl/core", "hono", "@hono/node-server", "ws"]
})
