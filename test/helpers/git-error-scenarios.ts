import {
  EmptyGitOutputError,
  GitGateway,
  GitTimeoutError,
} from "../../src/git/gateway";

const root = process.env.FAKE_GIT_ROOT;
const mode = process.env.FAKE_GIT_MODE ?? "sigpipe";

if (!root) {
  throw new Error("FAKE_GIT_ROOT is required");
}

if (mode === "empty") {
  try {
    await GitGateway.open(root);
    throw new Error("expected GitGateway.open to reject");
  } catch (error) {
    if (!(error instanceof EmptyGitOutputError)) {
      throw error;
    }
    console.log("empty-output");
  }
} else if (
  mode === "symbolic-empty-once" ||
  mode === "symbolic-empty-always"
) {
  const gateway = await GitGateway.open(root);
  try {
    const branch = await gateway.currentBranch();
    console.log(`branch ${branch}`);
  } catch (error) {
    if (!(error instanceof EmptyGitOutputError)) {
      throw error;
    }
    console.log("empty-symbolic");
  }
} else if (mode === "status-empty-ok") {
  const gateway = await GitGateway.open(root);
  const output = await gateway.text(["status", "--porcelain"], {
    emptyOk: true,
  });
  if (output !== "") {
    throw new Error(`unexpected stdout: ${output}`);
  }
  console.log("empty-ok");
} else if (mode === "stderr-open") {
  const gateway = await GitGateway.open(root);
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const output = await gateway.text(["status", "--porcelain"]);
    console.log(`stderr-open ${JSON.stringify(output.trim())}`);
    // Let the background child close the stderr pipe and any late reader
    // rejection surface.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  if (unhandled.length > 0) {
    console.log(`unhandled ${unhandled.length}`);
    process.exitCode = 1;
  } else {
    console.log("no-unhandled");
  }
} else if (mode === "lost-twice" || mode === "lost-three") {
  const gateway = await GitGateway.open(root);
  try {
    const output = await gateway.text(["status", "--porcelain"]);
    console.log(`lost-output-ok ${JSON.stringify(output.trim())}`);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    console.log(`lost-output-error ${error.name}`);
  }
} else if (mode === "timeout-pipe") {
  const gateway = await GitGateway.open(root);
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    try {
      await gateway.text(["status", "--porcelain"], { timeoutMs: 100 });
      throw new Error("expected git status to time out");
    } catch (error) {
      if (!(error instanceof GitTimeoutError)) {
        throw error;
      }
      console.log("timeout-pipe");
    }
    // Cover both attempts' grace periods and the delayed exits.
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  if (unhandled.length > 0) {
    console.log(`unhandled ${unhandled.length}`);
    process.exitCode = 1;
  } else {
    console.log("no-unhandled");
  }
} else if (mode === "lost-output") {
  const gateway = await GitGateway.open(root);
  const startedAt = performance.now();
  try {
    await gateway.text(["status", "--porcelain"]);
    throw new Error("expected the lost pipe to fail");
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    console.log(
      `lost ${error.name} ${Math.round(performance.now() - startedAt)}`,
    );
  }
} else if (mode === "timeout") {
  const gateway = await GitGateway.open(root);
  try {
    await gateway.run(["status", "--porcelain"], { timeoutMs: 100 });
    throw new Error("expected git status to time out");
  } catch (error) {
    if (!(error instanceof GitTimeoutError)) {
      throw error;
    }
    console.log("timeout");
  }
} else {
  const gateway = await GitGateway.open(root);
  const result = await gateway.run(["status", "--porcelain"]);
  if (result.stdout.toString("utf8").trim() !== "ok") {
    throw new Error(`unexpected stdout: ${result.stdout.toString("utf8")}`);
  }
  console.log("retried");
}
