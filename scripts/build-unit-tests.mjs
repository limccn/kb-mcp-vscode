import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = "src/test/unit";
const entryPoints = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `${dir}/${f}`);

if (entryPoints.length === 0) {
  console.error("no unit tests found");
  process.exit(1);
}

await esbuild.build({
  entryPoints,
  outdir: "out/unit",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  plugins: [
    {
      name: "vscode-stub",
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: resolve("src/test/vscode-stub.ts") }));
      },
    },
  ],
});