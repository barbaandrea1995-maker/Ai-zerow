"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, KeyRound, LogOut, Settings, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const authClient = createAuthClient();

export type AccountActor = {
  email: string;
  name: string;
};

function getInitials(actor: AccountActor) {
  const source = actor.name?.trim() || actor.email;
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`
    : source.slice(0, 2);

  return initials.toUpperCase() || "AC";
}

export function AccountMenu({ actor }: { actor: AccountActor }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);

    try {
      await authClient.signOut();
      router.replace("/login");
    } catch {
      setBusy(false);
      setError("Uscita non disponibile. Riprova.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Apri menu account di ${actor.name || actor.email}`}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1.5 pr-2 text-left transition hover:border-lime-300/35 hover:bg-lime-300/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/60"
          type="button"
        >
          <span className="grid size-8 place-items-center rounded-lg border border-lime-300/25 bg-gradient-to-br from-slate-200 to-slate-500 text-xs font-bold text-[#080a0b]">
            {getInitials(actor)}
          </span>
          <span className="hidden max-w-[150px] lg:block">
            <span className="block truncate text-xs font-medium text-slate-200">
              {actor.name || "Account"}
            </span>
            <span className="block truncate text-[10px] text-slate-600">
              {actor.email}
            </span>
          </span>
          <ChevronDown className="size-3.5 text-slate-500 transition group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 border-lime-300/20 bg-[#0b1008] p-2 text-slate-100 shadow-[0_0_32px_rgba(0,0,0,0.45)]"
        sideOffset={8}
      >
        <DropdownMenuLabel className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-300/70">
            Account attivo
          </span>
          <span className="mt-1 block truncate text-xs font-medium text-slate-100">
            {actor.name || "Account Neon"}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-500">
            {actor.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          asChild
          className="text-xs text-slate-300 focus:bg-lime-300/10 focus:text-lime-100"
        >
          <Link href="/settings">
            <Settings className="size-3.5 text-lime-200" />
            Impostazioni account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="text-xs text-slate-300 focus:bg-lime-300/10 focus:text-lime-100"
        >
          <Link href="/tenants">
            <ShieldCheck className="size-3.5 text-cyan-200" />
            Tenant e accessi
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="text-xs text-slate-300 focus:bg-lime-300/10 focus:text-lime-100"
        >
          <Link href="/login?mode=forgotPassword">
            <KeyRound className="size-3.5 text-amber-200" />
            Reimposta password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          className="text-xs text-rose-200 focus:bg-rose-300/10 focus:text-rose-100"
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          <LogOut className="size-3.5" />
          {busy ? "Uscita…" : "Esci"}
        </DropdownMenuItem>
        {error ? (
          <p
            className="mt-1 rounded-md border border-rose-300/20 bg-rose-300/5 px-2 py-1.5 text-[10px] text-rose-100"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
