import Link from "@/components/app-link";
import { ArrowLeft, LockKeyhole, ShieldAlert } from "lucide-react";
import { getAuthorityContext } from "@/lib/authority-context";
import { firstAuthorizedPath } from "@/lib/command-dashboard";

export const dynamic = "force-dynamic";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const params = await searchParams;
  const context = await getAuthorityContext();
  const destination = context ? firstAuthorizedPath(context.capabilities) : "/login";

  return (
    <main className="grid min-h-screen place-items-center bg-[#020403] px-5 text-slate-100">
      <section className="carbon-card carbon-card-neon w-full max-w-xl rounded-[26px] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <span className="grid size-12 place-items-center rounded-2xl border border-amber-300/25 bg-amber-300/10 text-amber-200"><ShieldAlert className="size-5" /></span>
          <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">deny by default</span>
        </div>
        <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">AI-ZEROW / AUTHORITY</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-slate-50">Accesso non autorizzato</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">Il tuo ruolo non include questa superficie. Il contenuto non e stato caricato e nessun dato riservato e stato inviato al browser.</p>
        <div className="carbon-inset mt-6 flex items-center gap-3 rounded-xl p-3">
          <LockKeyhole className="size-4 text-lime-300" />
          <div><p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">Capability richiesta</p><p className="mt-1 font-mono text-xs text-lime-100">{params.required || "module.access"}</p></div>
        </div>
        <Link className="zw-button-primary mt-6" href={destination}><ArrowLeft className="size-4" />Torna alla tua area</Link>
      </section>
    </main>
  );
}
