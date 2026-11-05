import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-xl font-semibold">That page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
      <Link href="/" className="mt-5 rounded-lg bg-night px-3 py-1.5 text-sm font-medium text-white hover:bg-night-2">
        Go to Today
      </Link>
    </main>
  );
}
