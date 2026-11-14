import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist", "web");
const assetsDir = join(outDir, "assets");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "web", "main.tsx")],
  outdir: assetsDir,
  target: "browser",
  splitting: true,
  minify: true,
  sourcemap: "none",
  naming: "[name].[ext]",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

copyFileSync(join(root, "web", "index.html"), join(outDir, "index.html"));
copyFileSync(join(root, "web", "styles.css"), join(assetsDir, "main.css"));

console.log(`Built SPA into ${outDir}`);
