import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { getAuthenticatedIdentity } from "@/lib/authority-context";
import TenantsClient from "./tenants-client";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const identity = await getAuthenticatedIdentity();

  if (!identity) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-center text-slate-100">
        <section className="max-w-md rounded-2xl border border-lime-300/20 bg-black/30 p-8">
          <p className="text-[10px] uppercase tracking-[0.22em] text-lime-300/70">AI-ZEROW / TENANTS</p>
          <h1 className="mt-3 text-xl font-semibold">Accesso richiesto</h1>
          <p className="mt-2 text-sm leading-5 text-slate-500">Il tenant directory richiede un’identità autenticata. Membership, ruolo e capability vengono poi verificati in D1.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a className="inline-flex rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-[#060806]" href="/login">Accedi con Neon</a>
            <a className="inline-flex rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300" href={chatGPTSignInPath("/tenants")} target="_top">
              Accedi con ChatGPT
            </a>
          </div>
        </section>
      </main>
    );
  }

  return <TenantsClient actor={{ displayName: identity.actorName, email: identity.actorEmail }} />;
}
