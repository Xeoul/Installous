// Build the static GitHub Pages demo into ./out.
// Static export can't include API routes, so they're moved aside for the
// build and always restored afterwards.
import { spawnSync } from "child_process";
import { existsSync, renameSync, writeFileSync } from "fs";

const API = "src/app/api";
const STASH = ".demo-build-api";

if (!existsSync("public/demo-data/meta.json")) {
  console.error("No demo data found. Run `npm run demo:data` first.");
  process.exit(1);
}

renameSync(API, STASH);
let status = 1;
try {
  const result = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_DEMO: "1",
      NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH ?? "/Installous",
    },
  });
  status = result.status ?? 1;
} finally {
  renameSync(STASH, API);
}

if (status === 0) {
  // GitHub Pages would otherwise run Jekyll, which drops the _next/ folder.
  writeFileSync("out/.nojekyll", "");
}
process.exit(status);
