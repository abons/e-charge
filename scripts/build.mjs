import { build, context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

/** Bundle + static copy into build/ — the directory that gets published. Same shape as the sisters. */
const serve = process.argv.includes("--serve");

mkdirSync("build", { recursive: true });
cpSync("web", "build", { recursive: true });

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
  console.log(`serving http://${host}:${served.port}/`);
} else {
  await build(options);
  console.log("build/ is ready");
}
