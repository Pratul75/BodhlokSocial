import type { Role } from "./roles";

export type ModuleKey =
  | "today"
  | "strategy"
  | "calendar"
  | "creative"
  | "approvals"
  | "publishing"
  | "ads"
  | "seo"
  | "community"
  | "leads"
  | "analytics"
  | "tracking"
  | "chat"
  | "connections"
  | "admin";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  href: string;
  group: "Overview" | "Plan" | "Review" | "Grow" | "Measure" | "Settings";
  roles: readonly Role[];
}

const ALL: readonly Role[] = ["admin", "ads_manager", "seo_manager", "social_manager", "sales"];
const MARKETING: readonly Role[] = ["admin", "ads_manager", "seo_manager", "social_manager"];

/** Role access follows the Roles table in PLAN.md. */
export const MODULES: readonly ModuleDef[] = [
  { key: "today", label: "Today", href: "/", group: "Overview", roles: MARKETING },
  { key: "strategy", label: "Strategy", href: "/strategy", group: "Plan", roles: MARKETING },
  { key: "calendar", label: "Content calendar", href: "/calendar", group: "Plan", roles: ["admin", "social_manager", "seo_manager"] },
  { key: "creative", label: "Creative studio", href: "/creative", group: "Plan", roles: ["admin", "social_manager"] },
  { key: "approvals", label: "Approvals", href: "/approvals", group: "Review", roles: MARKETING },
  { key: "publishing", label: "Publishing", href: "/publishing", group: "Grow", roles: ["admin", "social_manager"] },
  { key: "ads", label: "Ads manager", href: "/ads", group: "Grow", roles: ["admin", "ads_manager"] },
  { key: "seo", label: "SEO & GEO", href: "/seo", group: "Grow", roles: ["admin", "seo_manager"] },
  { key: "community", label: "Community", href: "/community", group: "Grow", roles: ["admin", "social_manager"] },
  { key: "leads", label: "Leads", href: "/leads", group: "Grow", roles: ALL },
  { key: "analytics", label: "Analytics", href: "/analytics", group: "Measure", roles: MARKETING },
  { key: "tracking", label: "Tracking", href: "/tracking", group: "Measure", roles: ["admin", "ads_manager"] },
  { key: "chat", label: "Ask the agents", href: "/chat", group: "Measure", roles: MARKETING },
  { key: "connections", label: "Connections", href: "/connections", group: "Settings", roles: ["admin"] },
  { key: "admin", label: "Admin", href: "/admin", group: "Settings", roles: ["admin"] },
];

export function modulesForRole(role: Role): ModuleDef[] {
  return MODULES.filter((m) => m.roles.includes(role));
}

export function canAccess(role: Role, key: ModuleKey): boolean {
  return MODULES.some((m) => m.key === key && m.roles.includes(role));
}

/** Which approval kinds each role may decide on. */
export const APPROVAL_KINDS = ["post", "ad_change", "reply", "listing", "blog", "page"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVERS: Record<ApprovalKind, readonly Role[]> = {
  post: ["admin", "social_manager"],
  reply: ["admin", "social_manager"],
  ad_change: ["admin", "ads_manager"],
  listing: ["admin", "seo_manager"],
  blog: ["admin", "seo_manager"],
  page: ["admin", "seo_manager"],
};

export function canApprove(role: Role, kind: ApprovalKind): boolean {
  return APPROVERS[kind].includes(role);
}
