export class ActionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InputError extends ActionError {}

export class DiffError extends ActionError {}

export class LlmError extends ActionError {}

export class SchemaError extends LlmError {}

export class CommentError extends ActionError {}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return "Unknown error";
}
