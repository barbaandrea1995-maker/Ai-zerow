"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ArrowLeft, LoaderCircle, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { CommandMobileNav } from "@/components/command-mobile-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CommandSurfaceAccess } from "@/lib/command-dashboard";
import { authorityRoleLabel } from "@/lib/authority-catalog";
import { idempotentJsonMutation } from "@/lib/client-request-idempotency";

type ApiResponse = {
  result?: { message?: string; aiRuntime?: { status?: string }; limitations?: string[] };
  error?: string;
};

const QUICK_PROMPTS = [
  "Quali attività mi sono state assegnate oggi?",
  "Qual è lo stato delle missioni autorizzate?",
  "Ci sono anomalie nel mio servizio?",
];

function fallbackPath(allowedNavigation: CommandSurfaceAccess["allowedNavigation"]) {
  if (allowedNavigation.includes("operations")) return "/operations";
  if (allowedNavigation.includes("mission")) return "/mission";
  if (allowedNavigation.includes("warehouse")) return "/warehouse";
  return "/presenze";
}

export default function OperationalAiControl({
  access,
  actor,
  role,
}: {
  access: Pick<CommandSurfaceAccess, "allowedNavigation" | "roles">;
  actor: { email: string; name: string };
  role: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("Company AI legge soltanto il perimetro operativo autorizzato. Nessuna risposta modifica commesse, missioni o magazzini.");
  const [runtime, setRuntime] = useState("GOVERNED READ");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const backPath = useMemo(() => fallbackPath(access.allowedNavigation), [access.allowedNavigation]);

  async function ask(value = prompt) {
    const nextPrompt = value.trim();
    if (nextPrompt.length < 2 || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await idempotentJsonMutation({
        url: "/api/command/ask",
        namespace: "operational-ai",
        operation: "query",
        payload: { prompt: nextPrompt, actionType: "query" },
      });
      const payload = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(payload.error ?? "operational_ai_unavailable");
      setAnswer(payload.result?.message ?? "Nessun risultato verificabile nel perimetro autorizzato.");
      setRuntime(payload.result?.aiRuntime?.status === "READY" ? "OPENAI LIVE" : "GOVERNED READBACK");
      setPrompt("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Company AI non disponibile");
    } finally {
      setBusy(false);
    }
  }

  return <main className="zw-app-shell zw-command-ultra min-h-screen overflow-x-hidden text-slate-100 selection:bg-lime-300 selection:text-[#060806]"><div className="zw-command-ambient" aria-hidden="true" /><section className="relative min-h-screen"><header className="zw-command-topbar sticky top-0 z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-5 sm:px-7"><a aria-label="Torna al modulo operativo" className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/25 text-slate-400 transition hover:border-lime-300/30 hover:text-lime-100" href={backPath}><ArrowLeft className="size-4" /></a><div className="flex min-w-0 items-center gap-2"><span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-lime-300/45 bg-black shadow-[0_0_18px_rgba(200,255,34,.12)]"><Image src="/ai-zerow-icon.jpeg" alt="ZEROW" width={36} height={36} className="size-full object-cover" /></span><span className="hidden sm:block"><span className="block text-[11px] font-bold tracking-[.18em] text-slate-50">ZEROW</span><span className="block text-[9px] uppercase tracking-[.2em] text-lime-300/75">AI centrale</span></span></div><div className="ml-auto flex items-center gap-2"><span className="hidden rounded-full border border-lime-300/20 bg-lime-300/[.05] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-lime-200 sm:inline-flex">{runtime}</span><AccountMenu actor={actor} /></div></header>
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-7 sm:px-7 sm:pb-10 sm:pt-10"><div className="zw-module-heading max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.22em] text-lime-300/75"><Sparkles className="size-3.5" />AI CENTRALE / SERVIZIO AUTORIZZATO</p><h1 className="mt-3 text-3xl font-semibold tracking-[-.06em] text-slate-50 sm:text-[48px]">Chiedi a <span className="text-lime-300">Company AI.</span></h1><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">Una sezione operativa semplice per leggere solo attività, missioni, presenze e luoghi consentiti al tuo profilo. Il server applica tenant, ruolo e assegnazioni prima di preparare la risposta.</p></div>
      <section className="carbon-card carbon-card-neon mt-7 max-w-4xl rounded-[26px] p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="neon-pulse grid size-11 place-items-center rounded-2xl bg-lime-300 text-[#060806]"><Sparkles className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-lime-300/70">PERIMETRO {authorityRoleLabel(role).toUpperCase()}</p><h2 className="mt-1 text-lg font-semibold text-slate-50">Assistente operativo</h2></div></div><span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.1em] text-cyan-100"><ShieldCheck className="size-3.5" />NO DIRECT WRITE</span></div><div className="carbon-inset mt-6 min-h-36 rounded-2xl p-4"><div className="flex items-center gap-2 text-[10px] text-lime-200"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(200,255,34,.9)]" />READBACK SERVER-SIDE<span className="ml-auto font-mono text-[9px] text-slate-600">S07</span></div><p className="mt-4 text-sm leading-7 text-slate-300" aria-live="polite">{answer}</p></div><form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void ask(); }}><div className="relative min-w-0 flex-1"><MessageSquareText className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" /><Input aria-label="Chiedi a Company AI" className="h-12 border-lime-300/15 bg-black/35 pl-10 text-sm text-slate-100 placeholder:text-slate-600" onChange={(event) => setPrompt(event.target.value)} placeholder="Chiedi qualcosa sul tuo servizio…" value={prompt} /></div><Button aria-label="Invia a Company AI" className="h-12 w-12 shrink-0 bg-lime-300 p-0 text-[#050705] hover:bg-lime-200" disabled={busy || prompt.trim().length < 2} size="icon" type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}</Button></form><div className="mt-4 grid gap-2 sm:grid-cols-3">{QUICK_PROMPTS.map((item) => <button className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left text-[10px] text-slate-400 transition hover:border-lime-300/30 hover:bg-lime-300/[.05] hover:text-lime-100" key={item} onClick={() => { setPrompt(item); void ask(item); }} type="button">{item}</button>)}</div>{notice && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.04] px-3 py-2 text-[10px] text-amber-100">{notice}</p>}</section>
      <div className="mt-5 grid max-w-4xl gap-3 sm:grid-cols-3"><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">VISIBILITÀ</p><p className="mt-2 text-sm font-semibold text-slate-200">Solo assegnato</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Nessun record di altri profili o tenant.</p></article><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">EVIDENZA</p><p className="mt-2 text-sm font-semibold text-slate-200">Fonte riletta</p><p className="mt-1 text-[10px] leading-5 text-slate-600">La risposta distingue dati osservati e non verificati.</p></article><article className="carbon-inset rounded-2xl p-4"><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">AZIONI</p><p className="mt-2 text-sm font-semibold text-slate-200">Nessuna scrittura</p><p className="mt-1 text-[10px] leading-5 text-slate-600">Le modifiche restano nei moduli autorizzati.</p></article></div>
    </div>
  </section><CommandMobileNav active="ai" allowedNavigation={access.allowedNavigation} role={role} roles={access.roles} /></main>;
}
