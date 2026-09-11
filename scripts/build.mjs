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
// In CI de commit (één deploy = één versie, een re-run van dezelfde code hoeft niets te busten),
// lokaal de klok tot op de milliseconde: minuut-nauwkeurig was te grof, want twee builds binnen
// dezelfde minuut gaven een byte-identieke sw.js en dan ziet de browser geen update.
const stamp = process.env.GITHUB_SHA?.slice(0, 12) || new Date().toISOString().replace(/\D/g, "");
const NEEDLE = 'const VERSION = "v1"';
const sw = readFileSync("build/sw.js", "utf8");
// Zonder deze controle is een herformattering van web/sw.js (andere quotes, `let`, een spatie erbij)
// een stille no-op: de build logt een versie, CI wordt groen, en elke deploy blijft `v1` — dan
// zien geïnstalleerde telefoons nooit een nieuwe app.js.
if (!sw.includes(NEEDLE)) throw new Error(`sw.js: regel \`${NEEDLE}\` niet gevonden, stempel mislukt`);
writeFileSync("build/sw.js", sw.replace(NEEDLE, `const VERSION = "v${stamp}"`));

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
