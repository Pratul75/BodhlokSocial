"use client";

export function RoleSelect({
  action,
  value,
  options,
}: {
  action: (formData: FormData) => Promise<void>;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <form action={action} className="flex items-center gap-2 text-xs text-muted">
      <label htmlFor="dev-role">Preview as</label>
      <select
        id="dev-role"
        name="role"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-rule bg-card px-2 py-1 text-xs text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
