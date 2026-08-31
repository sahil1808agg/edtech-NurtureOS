/**
 * Kills every running pipeline worker.
 *
 *   node scripts/stop-workers.mjs
 *
 * `npm run worker` spawns npm -> tsx -> node, so killing the npm parent leaves
 * the actual worker alive. Orphans are not harmless: each one keeps polling the
 * queue with whatever code it was started with, so a stale process can pick up
 * a job and silently run an old version of a handler.
 */
import { execFileSync } from "node:child_process";

const isWindows = process.platform === "win32";

if (isWindows) {
  const ps = [
    "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -like '*queue/worker*' -or $_.CommandLine -like '*run worker*' };",
    "Write-Output $p.Count;",
    "$p | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }",
  ].join(" ");
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  console.log(`Stopped ${out.trim().split(/\r?\n/)[0] || 0} worker process(es).`);
} else {
  try {
    execFileSync("pkill", ["-f", "queue/worker"], { encoding: "utf8" });
    console.log("Stopped worker process(es).");
  } catch {
    console.log("No worker processes found.");
  }
}
