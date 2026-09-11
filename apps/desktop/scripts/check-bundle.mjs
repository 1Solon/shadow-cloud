import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.(?:js|html|map)$/.test(entry.name)) {
      const text = await readFile(path, "utf8");
      if (
        /COMPANION_DEVELOPMENT_FIXTURE|Black Glass|Long Meridian|PrototypeSwitcher|createDevelopmentCompanion/.test(
          text,
        )
      ) {
        throw new Error(
          `Development data leaked into the production bundle: ${path}`,
        );
      }
    }
  }
}
await check(fileURLToPath(new URL("../dist", import.meta.url)));
console.log(
  "Production bundle contains no prototype or development scenarios.",
);
