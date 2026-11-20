/**
 * Pins today's access rules exactly as they are, so the multi-tenant work cannot change them
 * by accident. A tenant with every module entitled must behave like this, unchanged.
 */
import { describe, expect, it } from "vitest";
import { APPROVAL_KINDS, canAccess, canApprove, MODULES, modulesForRole, ROLES, type ModuleKey } from "./index";

/** role -> the modules it may open, as of the single-tenant application. */
const MATRIX: Record<string, ModuleKey[]> = {
  admin: [
    "today", "strategy", "calendar", "creative", "approvals", "publishing", "ads", "seo",
    "community", "leads", "analytics", "tracking", "chat", "runs", "connections", "admin",
  ],
  ads_manager: ["today", "strategy", "approvals", "ads", "leads", "analytics", "tracking", "chat", "runs"],
  seo_manager: ["today", "strategy", "calendar", "approvals", "seo", "leads", "analytics", "chat", "runs"],
  social_manager: ["today", "strategy", "calendar", "creative", "approvals", "publishing", "community", "leads", "analytics", "chat", "runs"],
  sales: ["leads"],
};

/** approval kind -> the roles that may decide it. */
const APPROVERS: Record<string, string[]> = {
  post: ["admin", "social_manager"],
  reply: ["admin", "social_manager"],
  ad_change: ["admin", "ads_manager"],
  listing: ["admin", "seo_manager"],
  blog: ["admin", "seo_manager"],
  page: ["admin", "seo_manager"],
};

describe("module access, pinned", () => {
  it("has exactly the five roles and sixteen modules", () => {
    expect([...ROLES].sort()).toEqual(["admin", "ads_manager", "sales", "seo_manager", "social_manager"]);
    expect(MODULES).toHaveLength(16);
  });

  for (const role of ROLES) {
    it(`${role} opens exactly its modules, and no others`, () => {
      const allowed = MODULES.filter((m) => canAccess(role, m.key)).map((m) => m.key).sort();
      expect(allowed).toEqual([...MATRIX[role]!].sort());
    });

    it(`${role}'s sidebar matches its access`, () => {
      expect(modulesForRole(role).map((m) => m.key).sort()).toEqual([...MATRIX[role]!].sort());
    });
  }

  it("refuses every role x module pair outside the matrix", () => {
    const refused: string[] = [];
    for (const role of ROLES) {
      for (const m of MODULES) {
        const expected = MATRIX[role]!.includes(m.key);
        if (canAccess(role, m.key) !== expected) refused.push(`${role}/${m.key}`);
      }
    }
    expect(refused).toEqual([]);
  });
});

describe("approval authority, pinned", () => {
  it("has exactly the six kinds", () => {
    expect([...APPROVAL_KINDS].sort()).toEqual(["ad_change", "blog", "listing", "page", "post", "reply"]);
  });

  it("lets exactly the right roles decide each kind", () => {
    const wrong: string[] = [];
    for (const kind of APPROVAL_KINDS) {
      for (const role of ROLES) {
        const expected = APPROVERS[kind]!.includes(role);
        if (canApprove(role, kind) !== expected) wrong.push(`${role}/${kind}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never lets sales decide anything", () => {
    for (const kind of APPROVAL_KINDS) expect(canApprove("sales", kind)).toBe(false);
  });
});
