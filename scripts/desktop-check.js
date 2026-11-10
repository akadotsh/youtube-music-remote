const { spawnSync } = require("node:child_process");
const windows = process.platform === "win32";
const commands = windows
  ? [["cargo", ["run", "--bin", "yt-remote-media", "--", "check"]]]
  : [
      ["pnpm", ["desktop:prepare-adapter"]],
      ["cargo", ["run", "--bin", "yt-remote-media", "--", "check"]],
    ];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
