import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const targetDir = path.join(root, "public", "vendor", "duckdb");

const assetNames = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js"
];

await mkdir(targetDir, { recursive: true });

await Promise.all(
  assetNames.map(async (assetName) => {
    const sourcePath = path.join(sourceDir, assetName);
    const targetPath = path.join(targetDir, assetName);

    try {
      await copyFile(sourcePath, targetPath);
    } catch {
      console.warn(`[duckdb-assets] skipped ${assetName}; install dependencies first`);
    }
  })
);
