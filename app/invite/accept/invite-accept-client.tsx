"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserCheck } from "lucide-react";
import Link from "@/components/app-link";
import { Button } from "@/components/ui/button";

type AcceptResult = {
  error?: string;
  idempotent?: boolean;
  invitation?: { email: string; roleLabel: string; status: string };
  membership?: { displayName: string; actorEmail: string; roleLabel: string; status: string };
};

function messageForError(error: string | undefined) {
  if (error === "neon_identity_required") return "Accedi con l’email invitata, poi torna su questo link.";
  if (error === "invitation_email_mismatch") return "La sessione corrente usa un’email diversa da quella invitata.";
  if (error === "invitation_expired") return "Questo invito è scaduto. Chiedi all’amministratore di generarne uno nuovo.";
  if (error === "invitation_revoked") return "Questo invito è stato revocato.";
  if (error === "invitation_already_used") return "Questo invito è già stato utilizzato da un’altra identità.";
  if (error === "invalid_invitation_token" || error === "invitation_not_found") return "Il link di invito non è valido.";
  return "Non è stato possibile completare l’attivazione. Riprova o contatta l’amministratore.";
}

export default function InviteAcceptClient({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [status, setStatus] = useState<"ready" | "success" | "error" | "login">(token ? "ready" : "error");

  const returnPath = `/invite/accept?token=${encodeURIComponent(token)}`;
  const loginPath = `/login?return_to=${encodeURIComponent(returnPath)}`;

  async function acceptInvitation() {
    if (!token) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/authority/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json() as AcceptResult;
      setResult(payload);
      if (response.ok && payload.membership) setStatus("success");
      else if (response.status === 401 && payload.error === "neon_identity_required") setStatus("login");
      else setStatus("error");
    } catch {
      setResult({ error: "network_unavailable" });
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-surface min-h-screen px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="carbon-card relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-lime-300/20 p-6 shadow-[0_0_70px_rgba(190,255,60,0.08)] sm:p-9" aria-labelledby="invite-title">
          <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-lime-300/[0.08] blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span className="neon-pulse grid size-14 place-items-center overflow-hidden rounded-2xl border border-lime-300/45 bg-black"><Image src="/ai-zerow-icon.jpeg" alt="AI-ZEROW" width={56} height={56} className="size-full object-cover" /></span>
            <div><p className="text-sm font-bold tracking-[0.2em] text-slate-50">AI-ZEROW</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/70">secure tenant invitation</p></div>
          </div>

          <div className="relative mt-9 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
            <span className={`grid size-14 place-items-center rounded-2xl border ${status === "success" ? "border-lime-300/35 bg-lime-300/12 text-lime-200" : status === "error" ? "border-rose-300/30 bg-rose-300/10 text-rose-200" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"}`}>
              {status === "success" ? <UserCheck className="size-6" /> : status === "error" ? <LockKeyhole className="size-6" /> : <KeyRound className="size-6" />}
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-300/70">ONBOARDING / IDENTITY GATE</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-50" id="invite-title">{status === "success" ? "Accesso attivato" : "Entra nel tenant operativo"}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">Il link è monouso. Il server verifica token, scadenza, email della sessione Neon, tenant e ruolo prima di creare la membership D1.</p>
            </div>
          </div>

          {status === "success" && result?.membership ? (
            <div className="relative mt-7 rounded-2xl border border-lime-300/20 bg-lime-300/[0.055] p-5" role="status">
              <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-lime-300" /><div><p className="font-semibold text-lime-100">{result.membership.displayName}</p><p className="mt-1 text-sm text-slate-400">{result.membership.actorEmail}</p><p className="mt-3 inline-flex rounded-full border border-lime-300/25 bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-lime-200">{result.membership.roleLabel} · {result.membership.status}</p></div></div>
              <Link className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-lime-300 px-5 text-sm font-semibold text-[#060806] transition hover:bg-lime-200" href="/">Apri la tua area<ArrowRight className="size-4" /></Link>
            </div>
          ) : (
            <div className="relative mt-7 space-y-4">
              {status === "error" && <p className="rounded-xl border border-rose-300/20 bg-rose-300/[0.055] px-4 py-3 text-sm leading-6 text-rose-100" role="alert">{token ? messageForError(result?.error) : "Il link di invito non contiene un token valido."}</p>}
              {status === "login" && <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] px-4 py-4 text-sm leading-6 text-cyan-100"><p>{messageForError(result?.error)}</p><a className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-200 px-4 text-xs font-semibold text-[#061014] hover:bg-cyan-100" href={loginPath}>Accedi o crea account<ArrowRight className="size-4" /></a></div>}
              {status !== "login" && token && <Button className="h-11 bg-lime-300 px-5 font-semibold text-[#060806] hover:bg-lime-200" disabled={busy} onClick={() => void acceptInvitation()} type="button">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{busy ? "Verifica in corso…" : status === "error" ? "Riprova attivazione" : "Verifica e accetta invito"}</Button>}
            </div>
          )}

          <div className="relative mt-8 grid gap-2 border-t border-white/[0.08] pt-5 text-[11px] text-slate-500 sm:grid-cols-3">
            <span>Token SHA-256</span><span>Email vincolata</span><span>Membership versionata</span>
          </div>
        </section>
      </div>
    </main>
  );
}
