import { heading, issueText, sentence } from "../i18n.js";
import { sanitizeUntrusted, shortSha } from "../text.js";
import type { Language, Mode, ModelArea, RedactionHit, ReviewedCommit } from "../types.js";
import { modeIncludesReview, modeIncludesSummary } from "../types.js";
import { isConventionalTitle } from "../commits/lint.js";
import { ACTION_VERSION, MARKER } from "../version.js";

export interface RenderInput {
  language: Language;
  mode: Mode;
  dryRun: boolean;
  llmCalled: boolean;
  model: string | null;
  kept: string[];
  ignored: string[];
  redactions: RedactionHit[];
  omittedPaths: string[];
  truncatedPaths: string[];
  boundedChars: number;
  maxDiffChars: number;
  summary: string | null;
  areas: ModelArea[];
  risks: string[];
  testPlan: string[];
  conventionalTitle: string | null;
  commits: ReviewedCommit[];
  maxChars: number;
}

function bullets(items: string[], empty: string): string {
  if (items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${sanitizeUntrusted(item)}`).join("\n");
}

function listPaths(paths: string[]): string {
  if (paths.length === 0) {
    return "-";
  }
  return paths.map((path) => `- ${sanitizeUntrusted(path)}`).join("\n");
}

export function renderComment(input: RenderInput): string {
  const language = input.language;
  const lines: string[] = [];
  const showSummary = modeIncludesSummary(input.mode);
  const showReview = modeIncludesReview(input.mode);

  if (showSummary) {
    lines.push(`## ${heading(language, "summary")}`, "");
    if (input.llmCalled && input.summary) {
      lines.push(sanitizeUntrusted(input.summary), "");
    } else {
      lines.push(sentence(language, "notAReview"), "");
      if (input.boundedChars === 0) {
        lines.push(sentence(language, "noText"), "");
      }
    }
  }

  if (!input.llmCalled || input.kept.length > 0 || input.ignored.length > 0) {
    lines.push(`## ${heading(language, "files")}`, "");
    lines.push(`**${heading(language, "kept")}**`, "", listPaths(input.kept), "");
    lines.push(`**${heading(language, "ignored")}**`, "", listPaths(input.ignored), "");
    const redactionTotal = input.redactions.reduce((sum, hit) => sum + hit.count, 0);
    lines.push(
      `**${heading(language, "redactions")}:** ${redactionTotal}`,
      "",
      input.redactions.length === 0
        ? "-"
        : input.redactions.map((hit) => `- ${hit.kind}: ${hit.count}`).join("\n"),
      "",
    );
    lines.push(`${input.boundedChars} / ${input.maxDiffChars}`, "");
    if (input.omittedPaths.length > 0) {
      lines.push(listPaths(input.omittedPaths), "");
    }
    if (input.truncatedPaths.length > 0) {
      lines.push(listPaths(input.truncatedPaths), "");
    }
  }

  if (showSummary) {
    lines.push(`## ${heading(language, "changes")}`, "");
    if (input.llmCalled && input.areas.length > 0) {
      for (const area of input.areas) {
        lines.push(`### ${sanitizeUntrusted(area.area)}`, "", sanitizeUntrusted(area.changes), "");
      }
    } else if (input.llmCalled) {
      lines.push(sentence(language, "noAreas"), "");
    } else {
      lines.push(sentence(language, "notAReview"), "");
    }

    lines.push(`## ${heading(language, "risks")}`, "");
    lines.push(
      input.llmCalled
        ? bullets(input.risks, sentence(language, "noneProvided"))
        : sentence(language, "risksNotAssessed"),
      "",
    );
    lines.push(`## ${heading(language, "testPlan")}`, "");
    lines.push(
      input.llmCalled
        ? bullets(input.testPlan, sentence(language, "noneProvided"))
        : sentence(language, "testsNotAssessed"),
      "",
    );
  }

  if (showReview) {
    lines.push(`## ${heading(language, "title")}`, "");
    if (!input.llmCalled) {
      lines.push(sentence(language, "titleMissing"), "");
    } else if (!input.conventionalTitle) {
      lines.push(sentence(language, "titleMissing"), "");
    } else {
      lines.push(`\`${sanitizeUntrusted(input.conventionalTitle)}\``, "");
      lines.push(
        isConventionalTitle(input.conventionalTitle)
          ? sentence(language, "titleFormatOk")
          : sentence(language, "titleFormatBad"),
        "",
      );
    }

    lines.push(`## ${heading(language, "commits")}`, "");
    if (input.commits.length === 0) {
      lines.push("-", "");
    }
    for (const commit of input.commits) {
      const issues = commit.lint.issues.map((issue) => issueText(language, issue.code));
      const status =
        commit.lint.ok && issues.length === 0 ? heading(language, "ok") : issues.join("; ");
      const suggestion = commit.suggestion
        ? ` — ${sanitizeUntrusted(commit.suggestion)}`
        : input.llmCalled
          ? ""
          : ` — ${sentence(language, "suggestionMissing")}`;
      lines.push(
        `- \`${shortSha(commit.sha)}\` ${sanitizeUntrusted(commit.subject)} — ${status}${suggestion}`,
      );
    }
    lines.push("");
  }

  lines.push(`${sentence(language, "producedBy")} ${ACTION_VERSION}.`);

  const inner = lines.join("\n").trim();
  const redactionTotal = input.redactions.reduce((sum, hit) => sum + hit.count, 0);
  const meta = `<!-- pr-summary-action meta mode=${input.mode} language=${language} llm=${input.llmCalled} model=${sanitizeUntrusted(input.model ?? "none")} dry-run=${input.dryRun} redactions=${redactionTotal} -->`;
  const open = language === "darija" ? `<div dir="rtl">\n\n` : "";
  const close = language === "darija" ? `\n\n</div>` : "";
  const prefix = `${MARKER}\n${meta}\n${open}`;
  const room = Math.max(0, input.maxChars - prefix.length - close.length - 80);
  const body =
    inner.length > room
      ? `${inner.slice(0, room)}\n\n[pr-summary-action] Comment trimmed to fit the size limit.`
      : inner;
  return `${prefix}${body}${close}\n`;
}
