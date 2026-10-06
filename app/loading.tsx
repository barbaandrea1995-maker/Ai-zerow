export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100">
      <section className="carbon-card carbon-card-neon w-full max-w-sm rounded-3xl p-7 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-lime-300/30 bg-lime-300/10 text-lime-200">
          <span className="size-3 animate-pulse rounded-full bg-lime-300 shadow-[0_0_18px_rgba(200,255,34,.9)]" />
        </span>
        <p className="mt-5 text-sm font-semibold text-slate-100">Apertura della centrale</p>
        <p className="mt-2 text-xs leading-5 text-slate-400">Sto preparando i dati dell’azienda e le superfici disponibili.</p>
      </section>
    </main>
  );
}
