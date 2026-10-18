"use client";

import { useEffect, useState } from "react";
import { Building2, LoaderCircle } from "lucide-react";
import { authorityRoleLabel } from "@/lib/authority-catalog";

type TenantOption = { id: string; name: string; slug: string; role: string; operatingProfile?: string };

export function TenantSwitcher() {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/tenant", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { selectedTenantId?: string; tenants?: TenantOption[] };
          if (!response.ok || !Array.isArray(payload.tenants)) return;
          setTenants(payload.tenants);
          setSelected(payload.selectedTenantId ?? payload.tenants[0]?.id ?? "");
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!tenants.length) return null;
  return <label className="hidden min-w-0 items-center gap-2 rounded-xl border border-white/[.08] bg-black/25 px-2.5 py-1.5 text-[9px] text-slate-500 lg:flex" title="Contesto tenant corrente"><Building2 className="size-3.5 shrink-0 text-lime-200" /><span className="sr-only">Seleziona tenant</span><select aria-label="Seleziona tenant" className="max-w-[190px] truncate bg-transparent font-semibold text-slate-200 outline-none" disabled={busy} onChange={(event) => { const tenantId = event.target.value; setSelected(tenantId); setBusy(true); void fetch("/api/auth/tenant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) }).then(() => window.location.reload()).catch(() => setBusy(false)); }} value={selected}>{tenants.map((tenant) => <option className="bg-[#080c09]" key={tenant.id} value={tenant.id}>{tenant.name} · {authorityRoleLabel(tenant.role)}</option>)}</select>{busy && <LoaderCircle className="size-3 animate-spin text-lime-200" />}</label>;
}
