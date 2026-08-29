/** Loads .env.local into process.env for integration tests. */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}
