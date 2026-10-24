/** The few GitHub REST calls the site publisher needs: branches, file contents, pull requests. */
export interface GitHubCredentials {
  token: string;
  repo: string; // owner/name
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface RepoFile {
  content: string;
  sha: string;
}

export interface PullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged: boolean;
  merged_at: string | null;
  mergeable: boolean | null;
}

export class GitHub {
  constructor(private readonly creds: GitHubCredentials) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(creds.repo)) throw new GitHubError("Repository must be owner/name.", 400);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com/repos/${this.creds.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok) throw new GitHubError(`GitHub ${res.status}${json?.message ? `: ${json.message}` : ""}`, res.status);
    return json as T;
  }

  async branchSha(branch: string): Promise<string> {
    const r = await this.call<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
    return r.object.sha;
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.call("POST", "/git/refs", { ref: `refs/heads/${name}`, sha: fromSha });
  }

  async getFile(path: string, ref: string): Promise<RepoFile> {
    const r = await this.call<{ content: string; sha: string; encoding: string }>("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
    return { content: Buffer.from(r.content, "base64").toString("utf8"), sha: r.sha };
  }

  async putFile(path: string, branch: string, content: string, message: string, sha?: string): Promise<void> {
    await this.call("PUT", `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async deleteFile(path: string, branch: string, sha: string, message: string): Promise<void> {
    await this.call("DELETE", `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { message, sha, branch });
  }

  async createPull(head: string, base: string, title: string, body: string): Promise<PullRequest> {
    return this.call<PullRequest>("POST", "/pulls", { head, base, title, body });
  }

  async getPull(number: number): Promise<PullRequest> {
    return this.call<PullRequest>("GET", `/pulls/${number}`);
  }

  async mergePull(number: number, title: string): Promise<boolean> {
    const r = await this.call<{ merged: boolean }>("PUT", `/pulls/${number}/merge`, { merge_method: "squash", commit_title: title });
    return r.merged;
  }

  /** Who the token acts as; a cheap way to check it works. */
  async whoAmI(): Promise<string> {
    const res = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${this.creds.token}`, Accept: "application/vnd.github+json" } });
    const json = (await res.json().catch(() => null)) as { login?: string; message?: string } | null;
    if (!res.ok) throw new GitHubError(`GitHub ${res.status}${json?.message ? `: ${json.message}` : ""}`, res.status);
    return json?.login ?? "unknown";
  }
}
