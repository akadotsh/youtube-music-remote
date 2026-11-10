const { spawnSync } = require("node:child_process");
const windows = process.platform === "win32";
const result = spawnSync(
  windows ? "powershell.exe" : "bash",
  windows
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/bundle-desktop.ps1"]
    : ["scripts/bundle-desktop.sh"],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
