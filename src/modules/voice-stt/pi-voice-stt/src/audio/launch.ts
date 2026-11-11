// omp-lite patch, not upstream. On the Windows VDI a bundled program starts the way OMP itself does:
// PowerShell runs a login Git Bash, Git Bash runs the program. The ompcli extension sets OMPCLI_GIT_BASH;
// without it, and off Windows, nothing changes.
import { spawnSync, type ChildProcess } from "node:child_process";

const bashQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const chained = (env: NodeJS.ProcessEnv, platform: string): string => (platform === "win32" ? env.OMPCLI_GIT_BASH ?? "" : "");

export const launch = (file: string, args: string[], env = process.env, platform: string = process.platform): [string, string[]] => {
  const bash = chained(env, platform);
  if (!bash) return [file, args];
  // Forward slashes and no double quotes: Git Bash and PowerShell pass them through unchanged.
  const inner = "exec " + [file, ...args].map((value) => bashQuote(value.replace(/\\/g, "/"))).join(" ");
  return ["powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `& ${psQuote(bash)} --login -i -c ${psQuote(inner)}`]];
};

// Killing PowerShell alone would leave ffmpeg holding the microphone: the whole tree goes.
export const killTree = (child: ChildProcess, env = process.env, platform: string = process.platform): boolean => {
  if (!chained(env, platform) || !child.pid) return false;
  spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  return true;
};
