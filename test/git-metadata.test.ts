import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import assert from "node:assert/strict";

import { currentBase, nextTag, selectTarget } from "../scripts/upstream.ts";
import { detectAndAllowGitMetadata } from "../src/git-metadata.ts";
import { buildRuntimeConfig, type SessionAllowances } from "../src/sandbox-runtime.ts";

test("Git metadata is session-only, canonical, minimal and rebuilt on reload", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "git-metadata-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(main, "init");
  git(
    main,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  git(main, "worktree", "add", "-b", "task", worktree);
  const empty = (): SessionAllowances => ({ domains: [], readPaths: [], writePaths: [] });
  for (const cwd of [root, main]) {
    const allowances = empty();
    await detectAndAllowGitMetadata(cwd, allowances);
    assert.deepEqual(allowances, empty());
  }
  for (let reload = 0; reload < 3; reload++) {
    const allowances = empty();
    await detectAndAllowGitMetadata(worktree, allowances);
    await detectAndAllowGitMetadata(worktree, allowances);
    assert.deepEqual(allowances.writePaths, [join(main, ".git")]);
    const config = { filesystem: { allowWrite: [worktree], denyRead: [], denyWrite: [] } };
    const before = JSON.stringify(config);
    const runtime = buildRuntimeConfig(config, allowances);
    assert.ok(runtime.filesystem.allowRead?.includes(join(main, ".git")));
    assert.ok(runtime.filesystem.allowWrite.includes(join(main, ".git")));
    assert.equal(JSON.stringify(config), before);
  }
  writeFileSync(join(worktree, "file"), "test");
  git(worktree, "status");
  git(worktree, "add", "file");
  git(
    worktree,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "test",
  );
  git(worktree, "fetch", main);
});

test("release selection ignores old and prerelease tags and increments fork revisions", () => {
  const tags = ["v1.5.0-patch.2", "v1.4.0-patch.9"];
  assert.equal(currentBase(tags), "v1.5.0");
  assert.equal(currentBase([]), "v0.6.8");
  assert.equal(selectTarget(["v0.6.7", "v0.6.8", "v0.7.0-rc.1"]), "v0.6.8");
  assert.equal(selectTarget(["v1.9.0", "v1.10.0", "v2.0.0-beta.1"]), "v1.10.0");
  assert.equal(selectTarget([]), undefined);
  assert.equal(
    selectTarget(["v1.4.0", "v1.5.0", "v1.9.0", "v1.10.0", "v2.0.0-rc.1"], currentBase(tags)),
    "v1.10.0",
  );
  assert.equal(selectTarget(["v1.4.0", "v1.5.0", "v1.6.0-beta.1"], currentBase(tags)), undefined);
  assert.equal(nextTag(tags, "v1.5.0"), "v1.5.0-patch.3");
  assert.equal(nextTag(tags, "v1.10.0"), "v1.10.0-patch.1");
  assert.throws(() => nextTag(tags, "bad"));
});
