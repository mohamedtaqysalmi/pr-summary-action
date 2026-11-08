import { parseArgs, helpText } from "./args.js";
import { inferFailOnError, loadConfig } from "./config.js";
import { safeErrorMessage } from "./errors.js";
import { runPipeline, type PipelineResult } from "./pipeline.js";
import { formatHuman, formatLog, toJsonReport } from "./report.js";
import type { Runtime } from "./runtime.js";
import { workflowCommand } from "./text.js";

export interface Execution {
  exitCode: number;
  result: PipelineResult | null;
  error: string | null;
}

function writeOutputs(runtime: Runtime, result: PipelineResult | null, error: string | null): void {
  runtime.writeOutput("summary", result?.summary ?? "");
  runtime.writeOutput(
    "comment-id",
    result?.commentId === null || result === null ? "" : String(result.commentId),
  );
  runtime.writeOutput("conventional-title", result?.conventionalTitle ?? "");
  runtime.writeOutput("dry-run", String(result?.dryRun ?? true));
  runtime.writeOutput("llm-called", String(result?.llmCalled ?? false));
  runtime.writeOutput("error", error ?? "");
  runtime.writeOutput("skipped", error ? "true" : "false");
}

export async function execute(runtime: Runtime): Promise<Execution> {
  if (runtime.kind === "cli") {
    try {
      const args = parseArgs(runtime.argv);
      if (args.help) {
        runtime.stdout(`${helpText()}\n`);
        return { exitCode: 0, result: null, error: null };
      }
      if (args.apiKeyOnArgv) {
        runtime.stderr(
          "warning: --api-key is visible in the process list. Prefer PR_SUMMARY_API_KEY.\n",
        );
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      runtime.stderr(`error: ${message}\n`);
      return { exitCode: 1, result: null, error: message };
    }
  }

  let configLoaded = false;
  let failOnError = false;
  try {
    const config = loadConfig(runtime);
    configLoaded = true;
    failOnError = config.failOnError;
    const result = await runPipeline(config, runtime);
    if (runtime.kind === "action") {
      writeOutputs(runtime, result, null);
    }
    if (runtime.kind === "cli") {
      runtime.stdout(
        config.jsonOutput
          ? `${JSON.stringify(toJsonReport(result), null, 2)}\n`
          : formatHuman(result),
      );
      if (config.showRedactedDiff) {
        runtime.stderr(`--- redacted diff ---\n${result.redactedDiff}`);
      }
    }
    runtime.stderr(`${formatLog(result)}\n`);
    return { exitCode: 0, result, error: null };
  } catch (error) {
    const message = safeErrorMessage(error);
    const fail = configLoaded ? failOnError : inferFailOnError(runtime);
    if (runtime.kind === "action") {
      writeOutputs(runtime, null, message);
      runtime.stderr(`${workflowCommand(fail ? "error" : "warning", message)}\n`);
    } else {
      runtime.stderr(`${fail ? "error" : "warning"}: ${message}\n`);
    }
    return { exitCode: fail ? 1 : 0, result: null, error: message };
  }
}
