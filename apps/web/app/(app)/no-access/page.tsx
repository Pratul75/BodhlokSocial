import { enterTenantScope, getCurrentUser } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Nothing switched on" };

/**
 * Where someone lands when their role and their workspace's plan leave them nothing to open.
 * It exists so that refusing a page is never a redirect loop.
 */
export default async function NoAccessPage() {
  const user = enterTenantScope(await getCurrentUser());
  return (
    <>
      <PageHeader title="Nothing switched on yet" description={`${user.tenant.name} has no sections available to you.`} />
      <EmptyState title="Nothing here for you to open">
        Either this workspace&rsquo;s plan has these sections switched off, or your role doesn&rsquo;t include them. Ask
        whoever set up the workspace to switch a section on.
      </EmptyState>
    </>
  );
}
