import runTests from "./abstraction"
import {createRequire} from "node:module"
var require = createRequire(import.meta.url);
await runTests(["uWebSockets.js"], [
  {
    normalCJS: require("@ublitzjs/payload"),
    normalESM: await import("@ublitzjs/payload"),
    test: "testHTTP",
    name: "index.js"
  },
])
