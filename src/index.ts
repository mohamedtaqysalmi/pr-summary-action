import { execute } from "./execute.js";
import { createRuntime } from "./runtime.js";
import { safeErrorMessage } from "./errors.js";

void execute(createRuntime("action"))
  .then((outcome) => {
    process.exitCode = outcome.exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
