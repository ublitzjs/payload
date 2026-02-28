import {describe} from "vitest"
import {build, type BuildOptions} from "esbuild"
import {cwd} from "node:process"
import {resolve} from "node:path"
import { createRequire } from "node:module"
import * as tests from "./all"
type Module = {
  name?: string;
  normalESM?: any,
  normalCJS?: any,
  test: keyof typeof import("./all")
}

var require = createRequire(import.meta.url)
var tmpDir = resolve(cwd(), "tmp");

export default async function(externalLibraries: string[], testedModules: Module[]){
  var buildOptions: BuildOptions = {
    platform: "node",
    bundle: true,
    external: externalLibraries,
    target: "node25",
    minify: true,
    alias: {
      stream: "node:stream",
      fs: "node:fs",
      crypto: "node:crypto",
      util: "node:util",
      process: "node:process",
      buffer: "node:buffer",
      events: "tseep",
      "node:events": "tseep",
      timers: "node:timers",
    },
    minifyIdentifiers: false,
    charset: "utf8",
    ignoreAnnotations: false,
    resolveExtensions: [".mts", ".ts", ".js", ".mjs", ".cts", ".cjs"],
  }
  var esmTmp = resolve(tmpDir, "esm")
  var cjsTmp = resolve(tmpDir, "cjs")
  var hasESMNormal = false;
  var hasMini = false;
  var hasCJSNormal = false;
  for (const module of testedModules) {
    if(module.normalESM) hasESMNormal = true;
    if(module.normalCJS) hasCJSNormal = true;
    if(module.name) hasMini = true;
  }
  if (hasCJSNormal || hasMini)
    describe("CJS", {sequential: true}, () => {
      if (hasCJSNormal)
        describe("NORMAL", async () => {
          for (var module of testedModules) {
            if (module.normalCJS) await tests[module.test](module.normalCJS)
          }
        })
      if (hasMini)
        describe("MINIFIED", async () => {
          for (var module of testedModules) {
            if (!module.name) continue;
            const outfile = resolve(cjsTmp, module.name);
            await build({
              ...buildOptions,
              entryPoints: ["dist/cjs/" + module.name],
              format: "cjs", outfile
            })
            await tests[module.test](require(outfile))
            delete require.cache[require.resolve(outfile)]
          }
        })
    })
  if (hasESMNormal || hasMini)
    describe("ESM", {sequential: true}, () => {
      if (hasESMNormal)
        describe("NORMAL", async () => {
          for (var module of testedModules) {
            if (module.normalESM) await tests[module.test](module.normalESM)
          }
        })
      if (hasMini)
        describe("MINIFIED", async () => {
          for (var module of testedModules) {
            if (!module.name) continue;
            const outfile = resolve(esmTmp, module.name);
            await build({
              ...buildOptions,
              entryPoints: ["dist/esm/" + module.name],
              format: "cjs", outfile
            })
            await tests[module.test](await import(outfile))
          }
        })
    })
}

