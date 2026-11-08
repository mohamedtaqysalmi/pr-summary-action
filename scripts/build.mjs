import { chmodSync } from "node:fs";
import * as esbuild from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});

await esbuild.build({
  ...common,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

chmodSync("dist/cli.js", 0o755);
