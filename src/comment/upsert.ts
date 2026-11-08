import { CommentError } from "../errors.js";
import {
  createIssueComment,
  listIssueComments,
  updateIssueComment,
  type GitHubClientOptions,
} from "../github/api.js";
import { MARKER_PREFIX } from "../version.js";

export interface UpsertResult {
  id: number;
  created: boolean;
  ids: number[];
}

function markerComments(comments: { id: number; body: string }[]): { id: number; body: string }[] {
  return comments.filter((comment) => comment.body.includes(MARKER_PREFIX));
}

export async function upsertMarkerComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
  options: GitHubClientOptions,
): Promise<UpsertResult> {
  const listed = await listIssueComments(owner, repo, number, { ...options, cap: 300 });
  const existing = markerComments(listed);
  if (existing.length > 0) {
    const ids: number[] = [];
    for (const comment of existing) {
      ids.push(await updateIssueComment(owner, repo, comment.id, body, options));
    }
    const id = ids[0];
    if (id === undefined) {
      throw new CommentError("Marker comment update did not return an id.");
    }
    return { id, created: false, ids };
  }

  try {
    const id = await createIssueComment(owner, repo, number, body, options);
    return { id, created: true, ids: [id] };
  } catch (error) {
    const again = markerComments(
      await listIssueComments(owner, repo, number, { ...options, cap: 300 }),
    );
    if (again.length === 0) {
      throw error;
    }
    const ids: number[] = [];
    for (const comment of again) {
      ids.push(await updateIssueComment(owner, repo, comment.id, body, options));
    }
    const id = ids[0];
    if (id === undefined) {
      throw new CommentError("Marker comment update did not return an id.");
    }
    return { id, created: false, ids };
  }
}
