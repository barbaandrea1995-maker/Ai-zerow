"use client";

import {
  COMPANY_LEGAL_FORMS,
  ITALIAN_PROVINCES,
  type CompanyProfile,
} from "@/lib/company-profile";

type CompanyProfileFormProps = {
  value: CompanyProfile;
  disabled?: boolean;
  onChange: <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => void;
};

const inputClassName = "h-12 rounded-xl border border-lime-300/15 bg-black/30 px-4 text-base text-slate-100 outline-none focus:border-lime-300/50 focus:ring-2 focus:ring-lime-300/10";

export default function CompanyProfileForm({ value, disabled, onChange }: CompanyProfileFormProps) {
  const field = (key: keyof CompanyProfile, next: string) => onChange(key, next as CompanyProfile[typeof key]);

  return <div className="mt-6 space-y-6">
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Identità fiscale</legend>
      <label className="grid gap-2 text-sm text-slate-300"><span>Forma giuridica <em className="text-lime-300">*</em></span><select className={inputClassName} disabled={disabled} onChange={(event) => field("legalForm", event.target.value)} value={value.legalForm}>{COMPANY_LEGAL_FORMS.map((item) => <option className="bg-[#0b100c]" key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Partita IVA / VAT ID <em className="text-lime-300">*</em></span><input autoComplete="off" className={`${inputClassName} font-mono`} disabled={disabled} inputMode="numeric" onChange={(event) => field("vatNumber", event.target.value)} placeholder="Es. 01234567890" value={value.vatNumber} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Codice fiscale <em className="text-lime-300">*</em></span><input autoComplete="off" className={`${inputClassName} font-mono`} disabled={disabled} onChange={(event) => field("taxCode", event.target.value)} placeholder="Codice fiscale aziendale" value={value.taxCode} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Numero REA <span className="text-slate-600">(opzionale)</span></span><input autoComplete="off" className={`${inputClassName} font-mono`} disabled={disabled} onChange={(event) => field("reaNumber", event.target.value)} placeholder="Es. RM-1234567" value={value.reaNumber} /></label>
    </fieldset>

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Sede legale</legend>
      <label className="grid gap-2 text-sm text-slate-300 sm:col-span-2"><span>Indirizzo e numero civico <em className="text-lime-300">*</em></span><input autoComplete="street-address" className={inputClassName} disabled={disabled} onChange={(event) => field("registeredAddress", event.target.value)} placeholder="Via, piazza o corso e numero" value={value.registeredAddress} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Comune <em className="text-lime-300">*</em></span><input autoComplete="address-level2" className={inputClassName} disabled={disabled} onChange={(event) => field("registeredCity", event.target.value)} placeholder="Es. Pomezia" value={value.registeredCity} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>CAP <em className="text-lime-300">*</em></span><input autoComplete="postal-code" className={inputClassName} disabled={disabled} inputMode="numeric" onChange={(event) => field("registeredPostalCode", event.target.value)} placeholder="00000" value={value.registeredPostalCode} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>{value.registeredCountry.toUpperCase() === "IT" ? "Provincia" : "Provincia / regione"} <em className="text-lime-300">*</em></span>{value.registeredCountry.toUpperCase() === "IT" ? <select autoComplete="address-level1" className={inputClassName} disabled={disabled} onChange={(event) => field("registeredProvince", event.target.value)} value={value.registeredProvince}><option className="bg-[#0b100c]" value="">Seleziona la provincia</option>{ITALIAN_PROVINCES.map(([code, name]) => <option className="bg-[#0b100c]" key={code} value={code}>{name} ({code})</option>)}</select> : <input autoComplete="address-level1" className={`${inputClassName} uppercase`} disabled={disabled} maxLength={32} onChange={(event) => field("registeredProvince", event.target.value.toUpperCase())} placeholder="Regione / provincia" value={value.registeredProvince} />}</label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Paese <em className="text-lime-300">*</em></span><input autoComplete="country" className={`${inputClassName} font-mono uppercase`} disabled={disabled} maxLength={2} onChange={(event) => field("registeredCountry", event.target.value.toUpperCase())} placeholder="IT" value={value.registeredCountry} /></label>
    </fieldset>

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-lime-300/70">Contatti aziendali</legend>
      <label className="grid gap-2 text-sm text-slate-300"><span>E-mail aziendale <em className="text-lime-300">*</em></span><input autoComplete="organization" className={inputClassName} disabled={disabled} onChange={(event) => field("businessEmail", event.target.value)} placeholder="amministrazione@azienda.it" type="email" value={value.businessEmail} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Telefono aziendale <em className="text-lime-300">*</em></span><input autoComplete="tel" className={inputClassName} disabled={disabled} inputMode="tel" onChange={(event) => field("businessPhone", event.target.value)} placeholder="+39 06 0000000" value={value.businessPhone} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>PEC <span className="text-slate-600">(opzionale)</span></span><input autoComplete="email" className={inputClassName} disabled={disabled} onChange={(event) => field("pecEmail", event.target.value)} placeholder="azienda@pec.it" type="email" value={value.pecEmail} /></label>
      <label className="grid gap-2 text-sm text-slate-300"><span>Codice destinatario SDI <span className="text-slate-600">(opzionale)</span></span><input autoComplete="off" className={`${inputClassName} font-mono uppercase`} disabled={disabled} maxLength={7} onChange={(event) => field("sdiCode", event.target.value.toUpperCase())} placeholder="0000000" value={value.sdiCode} /></label>
      <label className="grid gap-2 text-sm text-slate-300 sm:col-span-2"><span>Sito web <span className="text-slate-600">(opzionale)</span></span><input autoComplete="url" className={inputClassName} disabled={disabled} onChange={(event) => field("website", event.target.value)} placeholder="https://www.azienda.it" type="url" value={value.website} /></label>
    </fieldset>
  </div>;
}
