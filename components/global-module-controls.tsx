"use client";

import { ArrowLeft, LayoutDashboard, RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const HIDDEN_PATHS = ["/login", "/auth-ab", "/access-denied", "/invite"];

function isHiddenPath(pathname: string) {
  return HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function GlobalModuleControls() {
  const pathname = usePathname();
  const router = useRouter();

  if (isHiddenPath(pathname)) return null;

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/command");
  };

  return (
    <div className="zw-module-action-rail" aria-label="Azioni modulo">
      <button
        aria-label="Torna indietro"
        className="zw-module-action-rail__button"
        onClick={goBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        <span>Indietro</span>
      </button>
      <button
        aria-label="Aggiorna modulo"
        className="zw-module-action-rail__button"
        onClick={() => window.location.reload()}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        <span>Aggiorna</span>
      </button>
      <button
        aria-label="Apri Command"
        className="zw-module-action-rail__button zw-module-action-rail__button--workspace"
        onClick={() => router.push("/command")}
        type="button"
      >
        <LayoutDashboard aria-hidden="true" className="size-4" />
        <span>Command</span>
      </button>
    </div>
  );
}
