import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import TenantsClient from "./tenants-client";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#050607] px-5 text-center text-slate-100">
        <section className="max-w-md rounded-2xl border border-lime-300/20 bg-black/30 p-8">
          <p className="text-[10px] uppercase tracking-[0.22em] text-lime-300/70">AI-ZEROW / TENANTS</p>
          <h1 className="mt-3 text-xl font-semibold">Accesso richiesto</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">Il tenant directory è disponibile solo nel perimetro owner-private del Site.</p>
          <a className="mt-5 inline-flex rounded-lg bg-lime-300 px-4 py-2 text-xs font-semibold text-[#060806]" href={chatGPTSignInPath("/tenants")} target="_top">
            Accedi con ChatGPT
          </a>
        </section>
      </main>
    );
  }

  return <TenantsClient actor={{ displayName: user.displayName, email: user.email }} />;
}
