import { execFile } from "node:child_process";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";

import { realpath, stat } from "node:fs/promises";

import type { SessionAllowances } from "./sandbox-runtime.ts";

const exec = promisify(execFile);
const contains = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

export async function detectAndAllowGitMetadata(cwd: string, allowances: SessionAllowances) {
  // Ignore inherited Git overrides: discover the repository belonging to cwd.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const revParse = async (...args: string[]) =>
    (await exec("git", ["rev-parse", ...args], { cwd, env, timeout: 5000 })).stdout.replace(
      /\n$/,
      "",
    );
  try {
    if ((await revParse("--is-inside-work-tree")) !== "true") return;
    const paths = await Promise.all([
      revParse("--absolute-git-dir"),
      revParse("--path-format=absolute", "--git-common-dir"),
    ]);
    if (!paths.every(isAbsolute)) return;
    const metadata = [...new Set(await Promise.all(paths.map((path) => realpath(path))))];
    if (
      !(await Promise.all(metadata.map((path) => stat(path)))).every((info) => info.isDirectory())
    )
      return;
    // Existing permission rules interpret '*' as a glob; never broaden a literal Git path.
    if (metadata.some((path) => path.includes("*"))) return;
    const workspace = await realpath(cwd);
    for (const path of metadata) {
      if (
        contains(workspace, path) ||
        metadata.some((other) => other !== path && contains(other, path))
      )
        continue;
      if (!allowances.writePaths.includes(path)) allowances.writePaths.push(path);
    }
  } catch {
    // Not a repository, unavailable Git, or invalid metadata: grant nothing.
  }
}
