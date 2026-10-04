export const COMPANY_LEGAL_FORMS = [
  { id: "SRL", label: "Società a responsabilità limitata (S.r.l.)" },
  { id: "SRLS", label: "Società a responsabilità limitata semplificata (S.r.l.s.)" },
  { id: "SPA", label: "Società per azioni (S.p.A.)" },
  { id: "SAS", label: "Società in accomandita semplice (S.a.s.)" },
  { id: "SNC", label: "Società in nome collettivo (S.n.c.)" },
  { id: "INDIVIDUAL", label: "Ditta individuale" },
  { id: "PROFESSIONAL", label: "Professionista / studio" },
  { id: "COOPERATIVE", label: "Cooperativa" },
  { id: "OTHER", label: "Altra forma giuridica" },
] as const;

export type CompanyLegalForm = (typeof COMPANY_LEGAL_FORMS)[number]["id"];

export type CompanyProfile = {
  legalForm: CompanyLegalForm;
  vatNumber: string;
  taxCode: string;
  reaNumber: string;
  registeredAddress: string;
  registeredPostalCode: string;
  registeredCity: string;
  registeredProvince: string;
  registeredCountry: string;
  businessEmail: string;
  businessPhone: string;
  pecEmail: string;
  sdiCode: string;
  website: string;
};

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  legalForm: "SRL",
  vatNumber: "",
  taxCode: "",
  reaNumber: "",
  registeredAddress: "",
  registeredPostalCode: "",
  registeredCity: "",
  registeredProvince: "",
  registeredCountry: "IT",
  businessEmail: "",
  businessPhone: "",
  pecEmail: "",
  sdiCode: "",
  website: "",
};

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function isCompanyLegalForm(value: unknown): value is CompanyLegalForm {
  return typeof value === "string" && COMPANY_LEGAL_FORMS.some((item) => item.id === value);
}

export function normalizeCompanyProfile(value: unknown): CompanyProfile {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    legalForm: isCompanyLegalForm(input.legalForm) ? input.legalForm : EMPTY_COMPANY_PROFILE.legalForm,
    vatNumber: clean(input.vatNumber, 32).replace(/\s+/g, "").toUpperCase(),
    taxCode: clean(input.taxCode, 32).replace(/\s+/g, "").toUpperCase(),
    reaNumber: clean(input.reaNumber, 32).toUpperCase(),
    registeredAddress: clean(input.registeredAddress),
    registeredPostalCode: clean(input.registeredPostalCode, 16).toUpperCase(),
    registeredCity: clean(input.registeredCity, 100),
    registeredProvince: clean(input.registeredProvince, 32).toUpperCase(),
    registeredCountry: clean(input.registeredCountry, 2).toUpperCase() || "IT",
    businessEmail: clean(input.businessEmail, 160).toLowerCase(),
    businessPhone: clean(input.businessPhone, 40),
    pecEmail: clean(input.pecEmail, 160).toLowerCase(),
    sdiCode: clean(input.sdiCode, 16).toUpperCase(),
    website: clean(input.website, 200),
  };
}

export function isItalianVatNumber(value: string) {
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = Number(value[index]);
    if (index % 2 === 0) sum += digit;
    else sum += digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
  }
  return sum % 10 === Number(value[10]);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateCompanyProfile(profile: CompanyProfile) {
  const country = profile.registeredCountry || "IT";
  if (!isCompanyLegalForm(profile.legalForm)) return { field: "legalForm", detail: "Seleziona la forma giuridica." };
  if (country === "IT" && !isItalianVatNumber(profile.vatNumber)) return { field: "vatNumber", detail: "Inserisci una partita IVA italiana valida di 11 cifre." };
  if (country !== "IT" && !/^[A-Z0-9][A-Z0-9 .-]{1,30}$/.test(profile.vatNumber)) return { field: "vatNumber", detail: "Inserisci un VAT ID valido." };
  if (country === "IT" && !/^[A-Z0-9]{11,16}$/.test(profile.taxCode)) return { field: "taxCode", detail: "Inserisci un codice fiscale valido." };
  if (profile.registeredAddress.length < 5) return { field: "registeredAddress", detail: "Inserisci la sede legale completa di numero civico." };
  if (profile.registeredCity.length < 2) return { field: "registeredCity", detail: "Inserisci il comune della sede legale." };
  if (country === "IT" && !/^\d{5}$/.test(profile.registeredPostalCode)) return { field: "registeredPostalCode", detail: "Inserisci un CAP italiano di 5 cifre." };
  if (country === "IT" && !/^[A-Z]{2}$/.test(profile.registeredProvince)) return { field: "registeredProvince", detail: "Inserisci la provincia con due lettere." };
  if (!isEmail(profile.businessEmail)) return { field: "businessEmail", detail: "Inserisci un’e-mail aziendale valida." };
  if (profile.businessPhone.replace(/\D/g, "").length < 6) return { field: "businessPhone", detail: "Inserisci un numero di telefono aziendale valido." };
  if (profile.pecEmail && !isEmail(profile.pecEmail)) return { field: "pecEmail", detail: "La PEC inserita non è valida." };
  if (profile.sdiCode && !/^[A-Z0-9]{7}$/.test(profile.sdiCode)) return { field: "sdiCode", detail: "Il codice SDI deve contenere 7 caratteri." };
  if (profile.website && !/^https?:\/\//i.test(profile.website)) return { field: "website", detail: "Il sito web deve iniziare con https://." };
  return null;
}

export function companyProfileFromTenant(row: Record<string, unknown>): CompanyProfile {
  return normalizeCompanyProfile({
    legalForm: row.legalForm,
    vatNumber: row.vatNumber,
    taxCode: row.taxCode,
    reaNumber: row.reaNumber,
    registeredAddress: row.registeredAddress,
    registeredPostalCode: row.registeredPostalCode,
    registeredCity: row.registeredCity,
    registeredProvince: row.registeredProvince,
    registeredCountry: row.registeredCountry,
    businessEmail: row.businessEmail,
    businessPhone: row.businessPhone,
    pecEmail: row.pecEmail,
    sdiCode: row.sdiCode,
    website: row.website,
  });
}
