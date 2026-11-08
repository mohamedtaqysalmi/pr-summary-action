import { SchemaError } from "../errors.js";
import { isRecord } from "../text.js";
import type { Mode, ModelArea, ModelCommitReview, ModelSummary } from "../types.js";
import { modeIncludesReview, modeIncludesSummary } from "../types.js";

const SUMMARY_MAX = 4000;
const ITEM_MAX = 1000;
const LIST_MAX = 20;

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

function asBoundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.slice(0, max);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const entry of value) {
    const text = asBoundedString(entry, ITEM_MAX);
    if (text) {
      items.push(text);
    }
    if (items.length >= LIST_MAX) {
      break;
    }
  }
  return items;
}

function asAreas(value: unknown): ModelArea[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const areas: ModelArea[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const area = asBoundedString(entry.area, 200);
    const changes = asBoundedString(entry.changes, ITEM_MAX);
    if (area && changes) {
      areas.push({ area, changes });
    }
    if (areas.length >= LIST_MAX) {
      break;
    }
  }
  return areas;
}

function asReviews(value: unknown): ModelCommitReview[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const reviews: ModelCommitReview[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const sha = asBoundedString(entry.sha, 80);
    const suggestion = asBoundedString(entry.suggestion, ITEM_MAX);
    if (sha && suggestion) {
      reviews.push({ sha, suggestion });
    }
    if (reviews.length >= LIST_MAX) {
      break;
    }
  }
  return reviews;
}

export function parseModelSummary(raw: string, mode: Mode): ModelSummary {
  let payload: unknown;
  try {
    payload = JSON.parse(stripFences(raw)) as unknown;
  } catch {
    throw new SchemaError("Model did not return valid JSON.");
  }
  if (!isRecord(payload)) {
    throw new SchemaError("Model JSON was not an object.");
  }
  const summary = asBoundedString(payload.summary, SUMMARY_MAX);
  if (modeIncludesSummary(mode) && !summary) {
    throw new SchemaError("Model JSON is missing summary.");
  }
  let conventionalTitle: string | null = null;
  if (modeIncludesReview(mode)) {
    if (payload.conventionalTitle === null) {
      conventionalTitle = null;
    } else {
      conventionalTitle = asBoundedString(payload.conventionalTitle, 200);
    }
  }
  return {
    summary,
    areas: asAreas(payload.areas),
    risks: asStringList(payload.risks),
    testPlan: asStringList(payload.testPlan),
    conventionalTitle,
    commitReviews: modeIncludesReview(mode) ? asReviews(payload.commitReviews) : [],
  };
}

export interface PartialNote {
  notes: string;
  areas: ModelArea[];
  risks: string[];
  testPlan: string[];
}

export function parsePartialNote(raw: string): PartialNote {
  let payload: unknown;
  try {
    payload = JSON.parse(stripFences(raw)) as unknown;
  } catch {
    throw new SchemaError("Model did not return valid JSON.");
  }
  if (!isRecord(payload)) {
    throw new SchemaError("Model JSON was not an object.");
  }
  const notes = asBoundedString(payload.notes, SUMMARY_MAX);
  if (!notes) {
    throw new SchemaError("Model JSON is missing notes.");
  }
  return {
    notes,
    areas: asAreas(payload.areas),
    risks: asStringList(payload.risks),
    testPlan: asStringList(payload.testPlan),
  };
}
