import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Bundel + statische bestanden naar build/ — de map die op GitHub Pages terechtkomt. */
const serve = process.argv.includes("--serve");

mkdirSync("build", { recursive: true });
cpSync("web", "build", { recursive: true });

/**
 * De service worker krijgt hier zijn cache-key, want in `web/sw.js` staat de letterlijke `v1`.
 * Zonder deze stempel verandert de key nooit, en dan blijft een tab die de app ooit opende zijn
 * eerste `app.js` serveren — ook na een deploy. Bij de zusters heeft precies dat uren gekost.
 */
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const sw = readFileSync("build/sw.js", "utf8");
writeFileSync("build/sw.js", sw.replace('const VERSION = "v1"', `const VERSION = "v${stamp}"`));

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: !serve,
  format: "iife",
  target: "es2020",
  outfile: "build/app.js",
};

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  const served = await ctx.serve({ servedir: "build", host: "127.0.0.1" });
  const host = served.host ?? served.hosts?.[0] ?? "127.0.0.1";
  console.log(`serving http://${host}:${served.port}/ (sw v${stamp})`);
} else {
  await build(options);
  console.log(`build/ is ready (sw v${stamp})`);
}
