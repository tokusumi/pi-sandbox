import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import assert from "node:assert/strict";

test("sync merge gates the tested revision and only outputs a merged commit", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sync-merge-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Execute the workflow's actual shell step with a local GitHub CLI double.
  const workflow = readFileSync(
    new URL("../.github/workflows/sync-upstream.yml", import.meta.url),
    "utf8",
  );
  const script = workflow
    .split("      - id: merge\n")[1]
    .split("        run: |\n")[1]
    .split("\n\n")[0]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  writeFileSync(
    join(root, "gh"),
    `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  'api repos/owner/repo/git/ref/heads/main --jq .object.sha') echo "$LIVE_BASE" ;;
  'pr merge 2 --squash --match-head-commit tested') exit "$MERGE_EXIT" ;;
  'pr view 2 --json state --jq .state') echo "$PR_STATE" ;;
  'pr view 2 --json mergeCommit --jq .mergeCommit.oid') echo merged ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  );
  const output = join(root, "output");
  const calls = join(root, "calls");
  const run = (overrides: NodeJS.ProcessEnv = {}) => {
    writeFileSync(output, "");
    writeFileSync(calls, "");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GH_REPO: "owner/repo",
        PR: "2",
        SHA: "tested",
        BASE_SHA: "base",
        LIVE_BASE: "base",
        MERGE_EXIT: "0",
        PR_STATE: "MERGED",
        CALLS: calls,
        GITHUB_OUTPUT: output,
        ...overrides,
      },
    });
    return {
      status: result.status,
      output: readFileSync(output, "utf8"),
      calls: readFileSync(calls, "utf8"),
    };
  };
  const success = run();
  assert.equal(success.status, 0);
  assert.equal(success.output, "sha=merged\n");
  const stale = run({ LIVE_BASE: "changed" });
  assert.notEqual(stale.status, 0);
  assert.doesNotMatch(stale.calls, /pr merge/);
  for (const overrides of [{ MERGE_EXIT: "1" }, { PR_STATE: "OPEN" }]) {
    const failed = run(overrides);
    assert.notEqual(failed.status, 0);
    assert.equal(failed.output, "");
  }
  const bootstrap = run({ PR: "" });
  assert.equal(bootstrap.status, 0);
  assert.equal(bootstrap.output, "sha=tested\n");
  assert.doesNotMatch(bootstrap.calls, /pr merge/);
});
