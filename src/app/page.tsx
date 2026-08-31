export default function Home() {
  return (
    <main>
      <h1 className="text-2xl font-semibold tracking-tight">NurtureOS</h1>
      <p className="mt-3 text-[var(--muted)]">
        Upload a school report and we will turn it into a small number of grounded findings,
        each traceable to the exact cell it came from — reviewed by a human before you see it.
      </p>

      <section className="mt-8 rounded-lg border border-[var(--border)] p-5">
        <h2 className="text-sm font-medium">Status</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          The pipeline (extract → normalise → analyse → corroborate → gate → plan) runs on a
          queue worker. Sign-in, the upload form and the review console are not built yet;
          the API route at <code className="font-mono text-xs">POST /api/reports</code> is the
          entry point and enforces auth, family ownership and consent before anything is stored.
        </p>
      </section>
    </main>
  );
}
