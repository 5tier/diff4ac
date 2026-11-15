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
