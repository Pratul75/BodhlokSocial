export const ROLES = ["admin", "ads_manager", "seo_manager", "social_manager", "sales"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  ads_manager: "Ads manager",
  seo_manager: "SEO manager",
  social_manager: "Social media manager",
  sales: "Sales",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
