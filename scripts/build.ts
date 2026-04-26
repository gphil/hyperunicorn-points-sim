import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import "./copy-duckdb-assets";

const root = process.cwd();
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");

await rm(distDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(root, "src", "main.tsx")],
  outdir: assetsDir,
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  }
});

if (!result.success) {
  console.error(result.logs.join("\n"));
  process.exit(1);
}

await cp(path.join(root, "public"), distDir, { recursive: true });
await cp(path.join(root, "src", "styles.css"), path.join(assetsDir, "styles.css"));

const jsOutput = result.outputs.find((output) => output.path.endsWith(".js"));
const jsPath = jsOutput ? `/${path.relative(distDir, jsOutput.path)}` : "/assets/main.js";

const html = (await readFile(path.join(root, "index.html"), "utf8"))
  .replace("/src/styles.css", "/assets/styles.css")
  .replace("/bundle.js", jsPath);

await writeFile(path.join(distDir, "index.html"), html);

console.info(`[build] wrote ${path.relative(root, distDir)}`);
