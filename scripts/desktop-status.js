const { spawnSync } = require("node:child_process");
const windows = process.platform === "win32";
if (!windows) {
  const prepare = spawnSync("pnpm", ["desktop:prepare-adapter"], { stdio: "inherit" });
  if (prepare.error) throw prepare.error;
  if (prepare.status !== 0) process.exit(prepare.status ?? 1);
}
const status = spawnSync("cargo", ["run", "--bin", "yt-remote-media", "--", "status"], {
  stdio: "inherit",
});
if (status.error) throw status.error;
process.exit(status.status ?? 1);
