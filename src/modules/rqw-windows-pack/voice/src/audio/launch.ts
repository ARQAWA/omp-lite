// omp-lite patch, not upstream. On the Windows VDI a bundled program starts the way OMP itself does:
// PowerShell runs a login Git Bash, Git Bash runs the program. The VS Code extension sets OMPCLI_GIT_BASH;
// without it, and off Windows, nothing changes.
import { spawnSync, type ChildProcess } from "node:child_process";

const bashQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const chained = (env: NodeJS.ProcessEnv, platform: string): string => (platform === "win32" ? env.OMPCLI_GIT_BASH ?? "" : "");

export const launch = (file: string, args: string[], env = process.env, platform: string = process.platform): [string, string[]] => {
  const bash = chained(env, platform);
  if (!bash) return [file, args];
  // Forward slashes in Windows paths only: a device name keeps its backslash. No double quotes:
  // Git Bash and PowerShell pass single quotes through unchanged.
  const inner = "exec " + [file, ...args].map((value) => bashQuote(/^[A-Za-z]:\\|^\\\\/.test(value) ? value.replace(/\\/g, "/") : value)).join(" ");
  return ["powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `& ${psQuote(bash)} --login -i -c ${psQuote(inner)}`]];
};

// Killing PowerShell alone can leave ffmpeg holding the microphone.
export const killTree = (child: ChildProcess, env = process.env, platform: string = process.platform, run = spawnSync): boolean => {
  if (!chained(env, platform) || !child.pid) return false;
  const result = run("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  return !result.error && result.status === 0;
};
