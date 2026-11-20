# 6. Existing integrations analysis

26 integrations in the catalog (`packages/shared/src/integrations.ts:19-...`). Every one is
**installation-wide today**: one credential, one account, one secret name.

## 6.1 The catalog

| Key | Service | Method | Group | Per-tenant after transformation? |
|---|---|---|---|---|
| `anthropic` | Anthropic API | api_key | AI | **Decision needed** — shared platform key or tenant's own |
| `vertex` | Vertex AI (Imagen, Veo, Gemini) | service_account | AI | Shared is reasonable (platform GCP project) |
| `openai` | OpenAI | api_key | AI | Shared or per tenant |
| `perplexity` | Perplexity | api_key | AI | Shared or per tenant |
| `google_ads` | Google Ads API | oauth | Ads | **Per tenant** (each client's ad account) |
| `meta_marketing` | Meta Marketing API | api_key (2 fields) | Ads | **Per tenant** |
| `meta_capi` | Meta Conversions API | api_key (3 fields) | Ads | **Per tenant** |
| `postiz` | Postiz | api_key (2 fields) | Social | **Decision needed** — one server or one per tenant |
| `postiz_app` | Postiz OAuth app | api_key (3 fields) | Social | Shared app, per-tenant grant |
| `meta_pages` | Instagram + Facebook Pages | none | Social | Inside Postiz |
| `youtube` | YouTube comments | oauth | Social | **Per tenant** |
| `linkedin` | LinkedIn | none | Social | Inside Postiz |
| `reddit_app` | Reddit app | api_key (2 fields) | Social | Shared app, per-tenant grant |
| `reddit` | Reddit | oauth | Social | **Per tenant** |
| `quora` | Quora | none | Social | Manual |
| `bodhlok_cms` | bodhlok.com CMS | api_key (2 fields) | Search | **Per tenant** (each client's own site) |
| `crm_billing` | Agentic CRM: billing | api_key (3 fields) | Internal | **Per tenant** |
| `crm_leads` | Agentic CRM: leads | api_key (3 fields) | Internal | **Per tenant** |
| `google_app` | Google app for connections | api_key (2 fields) | Search | **Platform-level** — shared OAuth client |
| `search_console` | Google Search Console | oauth | Search | **Per tenant** |
| `dataforseo` | DataForSEO | api_key (3 fields) | Search | Shared account, per-tenant target |
| `semrush` | Semrush / Ahrefs | api_key | Search | Not built (`planned`) |
| `ga4` | GA4 / Firebase | service_account | Analytics | **Per tenant** |
| `whatsapp` | WhatsApp Business | api_key | Messaging | Not built (`planned`) |
| `email` | Brevo / SendGrid | api_key | Messaging | Not built (`planned`) |
| `bodh` | BODH backend | internal | Internal | **Per tenant** (each client's product backend) |

Three are explicitly `planned` and refuse credentials rather than storing a key nothing reads
(`integrations.ts` `planned` field) — a nice property to keep.

## 6.2 How credentials are held

```
connections row   key, status, secret_ref, account_label, last_sync_at, error
secret store      the value, under the name integration-<key>
```

- The database never holds a secret value — only `secret_ref` (`packages/db/src/schema.ts:37-55`).
- `secretName(key) = "integration-" + key` (`packages/integrations/src/secrets.ts:124`). **This is
  the central single-tenant fact about integrations.**
- `gcp` store: each save adds a Secret Manager version and **destroys the older ones**, so a replaced
  key stops working everywhere at once (`packages/integrations/src/secrets.ts:60-85`). Good hygiene; it also means a
  per-tenant naming change must not orphan existing versions.
- `local` store: one 0600 file per secret under `.secrets/`, refused in production unless
  `ALLOW_LOCAL_SECRETS=true`.

**Per-tenant naming must become `tenant-<id>-integration-<key>`, while the default tenant keeps
reading the existing `integration-<key>` names.** Re-keying live secrets is avoidable and should be
avoided: resolve the name through a function that returns the legacy name for the default tenant.

## 6.3 In-process caches — a real cross-tenant leak risk

Module-scope state. Found by scanning every non-test source file for module-level `let`/`var` and
for `const` bound to a `Map`, `Set`, object or array. That pattern catches the mutable caches, which
is what matters here; a type-annotated or lazily-built cache written differently could still be
missed, so **re-run this scan as part of the work rather than treating the list as final**. Every
other module-level collection found is an immutable lookup table (channel names, paid mediums, GA4
placeholders, personal-field names) and carries no risk.

| File | State | Risk |
|---|---|---|
| `packages/integrations/src/google-oauth.ts:90` | `Map<string, {token, refreshToken, expiresAt}>` **keyed by integration key** | **High.** With two tenants, `cache.get("google_ads")` returns whichever tenant refreshed last. Must be keyed by `(tenant, integration)` |
| `packages/integrations/src/reddit.ts:60` | A single `cached` token | **High.** Same problem, no key at all |
| `packages/integrations/src/secrets.ts:106` | `cached` store instance | Low — the store is platform-level |
| `packages/agents/src/skills.ts:42` | `installedCache` keyed by directory | Low — becomes a risk only if skills go per tenant |
| `packages/db/src/client.ts:10` | The pool on `globalThis` | Low, but it is why there is no per-request database context today |

`apps/web/lib/compose.tsx:11` holds a font cache, which is platform-level and harmless.

The first two are the kind of bug that does not fail a test and does not raise an error: it posts
one client's content to another client's account. They must be fixed in the same change that
introduces per-tenant credentials, not afterwards.

### Values frozen at module load

A related and easily-missed problem. Thirteen exported constants read `process.env` **once**, when
the module is first imported:

| Constant | File | Per-tenant? |
|---|---|---|
| `MONTHLY_BUDGET_USD` | `packages/agents/src/cost.ts:95` | **yes** |
| `RUN_CAP_USD` | `packages/agents/src/run.ts:15` | **yes** |
| `AUDIT_MAX_PAGES` | `packages/integrations/src/seo.ts:138` | **yes** |
| `HOURLY_CREATE_BUDGET` | `packages/integrations/src/publisher.ts:10` | **yes** |
| `SITE` | `packages/integrations/src/site-publisher.ts:20` | **yes** |
| the creative monthly caps | `packages/integrations/src/creative.ts:9-10` | **yes** |
| `PRODUCT_NAME`, `COMPANY_NAME`, `CONTACT_EMAIL` | `apps/web/lib/legal.ts:6-8` | **yes** |
| `MODEL`, `GRAPH_VERSION`, `IMAGE_MODEL`, `VIDEO_MODEL`, `VIDEO_LOCATION`, `ADS_API_VERSION` | various | no — platform-level |

The eight per-tenant ones cannot be made per-tenant by a settings lookup alone: a constant has no
request to read a tenant from. Each must become a function (`monthlyBudgetUsd(tenantId)`) and each
of its readers updated. Small and enumerable, but it is real work and it is the one place where
"no existing code changes" is untrue.

## 6.4 Webhook URLs already registered with third parties

These URLs are configured **inside other people's systems** and cannot be changed unilaterally:

| URL | Registered in | Consequence |
|---|---|---|
| `https://growth.rechargestudio.com/api/events/bodh` | the BODH backend | Must keep resolving to tenant #1, unchanged |
| `https://growth.rechargestudio.com/api/events/crm-billing` | the Agentic CRM (`integrations.ts`) | As above |
| `https://growth.rechargestudio.com/api/events/crm-leads` | the Agentic CRM (`integrations.ts`) | As above |
| `.../api/auth/callback/google`, `.../api/connect/google/callback` | the Google Cloud OAuth client | Google allows **no wildcards**; every tenant host needs explicit registration, or one central callback |
| Postiz and Reddit redirect URLs | those apps' settings | As above |

**The rule this sets:** new tenants get new, tenant-specific webhook paths (e.g.
`/api/events/bodh/<tenant>` or a tenant token in the header), while the three existing paths stay
exactly as they are and resolve to the default tenant. Never migrate the existing ones.

## 6.5 Outbound rate limits and quotas that become shared resources

| Limit | Where | Multi-tenant consequence |
|---|---|---|
| Postiz create-post, 30/hour (`POSTIZ_HOURLY_BUDGET=25`) | `postiz_calls` ledger | If Postiz is shared, one tenant can exhaust every tenant's publishing |
| AI monthly budget and per-run cap | `AI_MONTHLY_BUDGET_USD`, `AI_RUN_CAP_USD`, `packages/agents/src/cost.ts` | Must become per-tenant budgets, or one tenant spends the platform's money |
| Creative monthly images/videos | `CREATIVE_MONTHLY_*` | Must become per-tenant |
| DataForSEO, Google Ads, Meta API quotas | provider-side | Shared accounts mean shared throttling |

These are **capacity entitlements**, and they belong in the per-tenant plan alongside module
switches ([12](12-entitlements.md)).

## 6.6 Credential verification

`verifyConnections` re-checks every stored credential with its provider, run nightly inside
`ops/alerts` before the digest (`apps/worker/src/app.ts:285-304`), so a revoked key surfaces before a
job trips over it. Multi-tenant, this becomes N× the API calls; it should iterate tenants and report
per tenant, and Super Admin should see the roll-up ([10](10-super-admin.md)).
