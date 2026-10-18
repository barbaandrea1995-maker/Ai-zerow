"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the production screen useful without exposing server internals.
    console.error("ZEROW surface error", { digest: "runtime-boundary" });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#030504] px-5 text-slate-100">
      <section className="carbon-card carbon-card-neon w-full max-w-lg rounded-3xl p-7 text-center">
        <TriangleAlert className="mx-auto size-8 text-amber-200" />
        <h1 className="mt-5 text-xl font-semibold">Questa sezione non è disponibile</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Il collegamento si è interrotto. Puoi riprovare senza perdere il contesto dell’azienda.</p>
        <Button className="mt-6 bg-lime-300 text-[#050705] hover:bg-lime-200" onClick={() => reset()}>
          <RefreshCw className="size-4" />
          Riprova
        </Button>
      </section>
    </main>
  );
}
