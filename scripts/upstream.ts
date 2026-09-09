import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const INITIAL_BASE = "v0.6.8"; // Fork HEAD: 31fa5060689624467c1aeace2664ce91784522ff
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const patch = /^(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-patch\.([1-9]\d*)$/;
export function compare(a: string, b: string): number {
  const av = a.slice(1).split(".").map(BigInt);
  const bv = b.slice(1).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return 0;
}
export function currentBase(tags: string[]): string {
  return (
    tags
      .flatMap((tag) => tag.match(patch)?.[1] ?? [])
      .sort(compare)
      .at(-1) ?? INITIAL_BASE
  );
}
export function selectTarget(tags: string[], base?: string): string | undefined {
  return tags
    .filter((tag) => stable.test(tag) && (base === undefined || compare(tag, base) > 0))
    .sort(compare)
    .at(-1);
}
export function nextTag(tags: string[], base: string): string {
  if (!stable.test(base)) throw new Error("Invalid upstream tag");
  const revisions = tags.flatMap((tag) => {
    const match = tag.match(patch);
    return match?.[1] === base ? [BigInt(match[2])] : [];
  });
  return `${base}-patch.${revisions.reduce((a, b) => (a > b ? a : b), 0n) + 1n}`;
}
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tags = git("tag", "--merged", "HEAD").split("\n");
  if (process.argv[2] === "plan") {
    const base = currentBase(tags);
    const upstream = git("for-each-ref", "--format=%(refname:strip=3)", "refs/upstream/tags").split(
      "\n",
    );
    const target = selectTarget(upstream, tags.some((tag) => patch.test(tag)) ? base : undefined);
    appendFileSync(process.env.GITHUB_OUTPUT!, `base=${base}\ntarget=${target ?? ""}\n`);
  } else if (process.argv[2] === "tag") {
    const base = process.env.UPSTREAM_TAG || currentBase(tags);
    if (!stable.test(base) || compare(base, currentBase(tags)) < 0)
      throw new Error("Invalid upstream base");
    if (
      git("tag", "--points-at", "HEAD")
        .split("\n")
        .some((tag) => patch.test(tag))
    )
      process.exit(0);
    const tag = nextTag(git("tag").split("\n"), base);
    git("tag", "-a", tag, "-m", `pi-sandbox ${base} with linked worktree support`);
    git("push", "origin", tag);
  } else throw new Error("Expected plan or tag");
}
