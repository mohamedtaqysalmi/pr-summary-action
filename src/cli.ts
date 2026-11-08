import { execute } from "./execute.js";
import { safeErrorMessage } from "./errors.js";
import { createRuntime } from "./runtime.js";

void execute(createRuntime("cli"))
  .then((outcome) => {
    process.exitCode = outcome.exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
