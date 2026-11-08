import { createServer, type IncomingMessage } from "node:http";

export interface RecordedRequest {
  method: string;
  path: string;
  body: string;
  authorization: string | null;
}

export interface MockOptions {
  files?: unknown[];
  commits?: unknown[];
  llmBodies?: string[];
  llmStatus?: number[];
  commentStatus?: number;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new Error("Unexpected request body chunk.");
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

const DEFAULT_MODEL = JSON.stringify({
  summary: "Shortens the session TTL from one hour to fifteen minutes.",
  areas: [{ area: "src/auth", changes: "sessionTtl now returns 900 seconds." }],
  risks: ["Open sessions can expire sooner than callers expect."],
  testPlan: ["Run the session unit tests."],
  conventionalTitle: "feat(auth): shorten session ttl",
  commitReviews: [
    {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      suggestion: "Subject already matches Conventional Commits.",
    },
  ],
});

export async function startMock(options: MockOptions = {}): Promise<{
  url: string;
  requests: RecordedRequest[];
  comments: { id: number; body: string }[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const comments: { id: number; body: string }[] = [];
  let llmIndex = 0;
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      requests.push({
        method: req.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body,
        authorization:
          typeof req.headers.authorization === "string" ? req.headers.authorization : null,
      });
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname.endsWith("/chat/completions")) {
        const status = options.llmStatus?.[llmIndex] ?? 200;
        const available = options.llmBodies ?? [];
        const content =
          available.length === 0
            ? DEFAULT_MODEL
            : (available[Math.min(llmIndex, available.length - 1)] ?? DEFAULT_MODEL);
        llmIndex += 1;
        if (status !== 200) {
          send(status, { error: { message: content } });
          return;
        }
        send(200, { choices: [{ message: { content } }] });
        return;
      }
      if (url.pathname.endsWith("/files")) {
        send(200, options.files ?? []);
        return;
      }
      if (url.pathname.endsWith("/commits") && (req.method ?? "GET") === "GET") {
        send(200, options.commits ?? []);
        return;
      }
      if (url.pathname.endsWith("/comments") && (req.method ?? "GET") === "GET") {
        send(200, comments);
        return;
      }
      if (url.pathname.endsWith("/comments") && req.method === "POST") {
        const status = options.commentStatus ?? 201;
        if (status >= 400) {
          send(status, { message: "comment failed" });
          return;
        }
        const parsed = JSON.parse(body) as { body?: string };
        const comment = { id: comments.length + 1, body: parsed.body ?? "" };
        comments.push(comment);
        send(201, comment);
        return;
      }
      const patch = /\/issues\/comments\/(\d+)$/.exec(url.pathname);
      if (patch && req.method === "PATCH") {
        const id = Number(patch[1]);
        const parsed = JSON.parse(body) as { body?: string };
        const found = comments.find((comment) => comment.id === id);
        if (!found) {
          send(404, { message: "not found" });
          return;
        }
        found.body = parsed.body ?? "";
        send(200, found);
        return;
      }
      send(404, { message: `no route ${url.pathname}` });
    })().catch((error: unknown) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "mock failed");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock server did not bind a port.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    comments,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export const SAMPLE_FILES = [
  {
    filename: "src/auth/session.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch:
      "@@ -1,2 +1,3 @@\n-export const ttl = 3600;\n+export const ttl = 900;\n+// Reset the user password flow after rotation.\n",
  },
  {
    filename: "package-lock.json",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: '@@ -1 +1,2 @@\n+"sentinel": "LOCKFILE_SENTINEL_DO_NOT_SEND"\n',
  },
  {
    filename: "src/config/example.ts",
    status: "added",
    additions: 2,
    deletions: 0,
    patch:
      '@@ -0,0 +1,2 @@\n+export const awsKey = "AKIAIOSFODNN7EXAMPLE";\n+export const githubToken = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\n',
  },
];

export const SAMPLE_COMMITS = [
  {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    commit: { message: "feat(auth): shorten session ttl\n\nKeep idle sessions for 15 minutes.\n" },
  },
  {
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    commit: { message: "update stuff" },
  },
];
