import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import { getNeonReadback, NeonReadbackError } from "@/lib/neon-readback";

export const dynamic = "force-dynamic";

export default async function S10ReadbackPage() {
  const context = await getAuthorityContext();

  if (!context) {
    return <ReadbackState title="S10 Neon readback" message="unauthenticated" />;
  }

  if (!hasCapability(context, "command.read")) {
    return <ReadbackState title="S10 Neon readback" message="forbidden" />;
  }

  let readback: Awaited<ReturnType<typeof getNeonReadback>> | null = null;
  let errorMessage = "neon_runtime_readback_failed";

  try {
    readback = await getNeonReadback();
  } catch (error) {
    errorMessage = error instanceof NeonReadbackError
      ? error.code
      : "neon_runtime_readback_failed";
  }

  if (!readback) {
    return <ReadbackState title="S10 Neon readback" message={errorMessage} />;
  }

  return <NeonReadbackView readback={readback} />;
}

function NeonReadbackView({ readback }: { readback: Awaited<ReturnType<typeof getNeonReadback>> }) {
  return (
    <main className="min-h-screen bg-[#050607] px-5 py-10 font-mono text-slate-200 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-lime-300/70">AI-ZEROW / S10</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50">Neon readback</h1>
            <p className="mt-2 text-xs text-slate-500">Riservato al titolare, sola lettura · nessuna scrittura esterna</p>
          </div>
          <a className="text-xs text-lime-200 underline decoration-lime-300/30 underline-offset-4" href="/externals">Torna agli adapter</a>
        </div>
        <pre className="overflow-x-auto rounded-2xl border border-lime-300/20 bg-black/30 p-5 text-[11px] leading-6 text-lime-100/90 shadow-[0_0_30px_rgba(190,255,60,0.06)]">
          {JSON.stringify({
            ownerOnly: true,
            runtimeBinding: "DATABASE_URL",
            ...readback,
          }, null, 2)}
        </pre>
      </div>
    </main>
  );
}

function ReadbackState({ title, message }: { title: string; message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-center text-slate-100">
      <section className="rounded-2xl border border-amber-300/20 bg-black/30 p-8">
        <p className="text-[10px] uppercase tracking-[0.22em] text-amber-200/80">AI-ZEROW / S10</p>
        <h1 className="mt-3 text-xl font-semibold">{title}</h1>
        <p className="mt-2 font-mono text-xs text-amber-100/80">{message}</p>
      </section>
    </main>
  );
}
