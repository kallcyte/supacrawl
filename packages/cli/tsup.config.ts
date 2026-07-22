import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  shims: false,
  external: ["@supacrawl/core", "@supacrawl/server", "nodemailer", "better-auth", "better-sqlite3"]
})
