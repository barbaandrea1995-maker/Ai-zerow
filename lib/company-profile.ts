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

export const ITALIAN_PROVINCES = [
  ["AG", "Agrigento"], ["AL", "Alessandria"], ["AN", "Ancona"], ["AO", "Aosta"], ["AP", "Ascoli Piceno"], ["AQ", "L'Aquila"], ["AR", "Arezzo"], ["AT", "Asti"], ["AV", "Avellino"],
  ["BA", "Bari"], ["BG", "Bergamo"], ["BI", "Biella"], ["BL", "Belluno"], ["BN", "Benevento"], ["BO", "Bologna"], ["BR", "Brindisi"], ["BS", "Brescia"], ["BT", "Barletta-Andria-Trani"], ["BZ", "Bolzano"],
  ["CA", "Cagliari"], ["CB", "Campobasso"], ["CE", "Caserta"], ["CH", "Chieti"], ["CL", "Caltanissetta"], ["CN", "Cuneo"], ["CO", "Como"], ["CR", "Cremona"], ["CS", "Cosenza"], ["CT", "Catania"], ["CZ", "Catanzaro"],
  ["EN", "Enna"], ["FC", "Forlì-Cesena"], ["FE", "Ferrara"], ["FG", "Foggia"], ["FI", "Firenze"], ["FM", "Fermo"], ["FR", "Frosinone"],
  ["GE", "Genova"], ["GO", "Gorizia"], ["GR", "Grosseto"],
  ["IM", "Imperia"], ["IS", "Isernia"],
  ["KR", "Crotone"],
  ["LC", "Lecco"], ["LE", "Lecce"], ["LI", "Livorno"], ["LO", "Lodi"], ["LT", "Latina"], ["LU", "Lucca"],
  ["MB", "Monza e Brianza"], ["MC", "Macerata"], ["ME", "Messina"], ["MI", "Milano"], ["MN", "Mantova"], ["MO", "Modena"], ["MS", "Massa-Carrara"], ["MT", "Matera"],
  ["NA", "Napoli"], ["NU", "Nuoro"],
  ["OR", "Oristano"],
  ["PA", "Palermo"], ["PC", "Piacenza"], ["PD", "Padova"], ["PE", "Pescara"], ["PG", "Perugia"], ["PI", "Pisa"], ["PN", "Pordenone"], ["PO", "Prato"], ["PR", "Parma"], ["PT", "Pistoia"], ["PU", "Pesaro e Urbino"], ["PV", "Pavia"], ["PZ", "Potenza"],
  ["RA", "Ravenna"], ["RC", "Reggio Calabria"], ["RE", "Reggio Emilia"], ["RG", "Ragusa"], ["RI", "Rieti"], ["RM", "Roma"], ["RN", "Rimini"], ["RO", "Rovigo"],
  ["SA", "Salerno"], ["SI", "Siena"], ["SO", "Sondrio"], ["SP", "La Spezia"], ["SR", "Siracusa"], ["SS", "Sassari"], ["SU", "Sud Sardegna"], ["SV", "Savona"],
  ["TA", "Taranto"], ["TE", "Teramo"], ["TN", "Trento"], ["TO", "Torino"], ["TP", "Trapani"], ["TR", "Terni"], ["TS", "Trieste"], ["TV", "Treviso"],
  ["UD", "Udine"],
  ["VA", "Varese"], ["VB", "Verbano-Cusio-Ossola"], ["VC", "Vercelli"], ["VE", "Venezia"], ["VI", "Vicenza"], ["VR", "Verona"], ["VS", "Medio Campidano"], ["VT", "Viterbo"],
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
  const normalized = normalizeCompanyProfile(profile);
  const country = normalized.registeredCountry || "IT";
  if (!isCompanyLegalForm(normalized.legalForm)) return { field: "legalForm", detail: "Seleziona la forma giuridica." };
  // During company registration we validate the legal identifier format. The
  // checksum is kept available for a later registry/provider verification, but
  // it must not block onboarding when the tenant is entering an existing VAT
  // identifier that is still awaiting official verification.
  if (country === "IT" && !/^\d{11}$/.test(normalized.vatNumber)) return { field: "vatNumber", detail: "Inserisci una partita IVA italiana di 11 cifre." };
  if (country !== "IT" && !/^[A-Z0-9][A-Z0-9 .-]{1,30}$/.test(normalized.vatNumber)) return { field: "vatNumber", detail: "Inserisci un VAT ID valido." };
  if (country === "IT" && !/^[A-Z0-9]{11,16}$/.test(normalized.taxCode)) return { field: "taxCode", detail: "Inserisci un codice fiscale valido." };
  if (normalized.registeredAddress.length < 5) return { field: "registeredAddress", detail: "Inserisci la sede legale completa di numero civico." };
  if (normalized.registeredCity.length < 2) return { field: "registeredCity", detail: "Inserisci il comune della sede legale." };
  if (country === "IT" && !/^\d{5}$/.test(normalized.registeredPostalCode)) return { field: "registeredPostalCode", detail: "Inserisci un CAP italiano di 5 cifre." };
  if (country === "IT" && !/^[A-Z]{2}$/.test(normalized.registeredProvince)) return { field: "registeredProvince", detail: "Seleziona la provincia della sede legale." };
  if (!isEmail(normalized.businessEmail)) return { field: "businessEmail", detail: "Inserisci un’e-mail aziendale valida." };
  if (normalized.businessPhone.replace(/\D/g, "").length < 6) return { field: "businessPhone", detail: "Inserisci un numero di telefono aziendale valido." };
  if (normalized.pecEmail && !isEmail(normalized.pecEmail)) return { field: "pecEmail", detail: "La PEC inserita non è valida." };
  if (normalized.sdiCode && !/^[A-Z0-9]{7}$/.test(normalized.sdiCode)) return { field: "sdiCode", detail: "Il codice SDI deve contenere 7 caratteri." };
  if (normalized.website && !/^https?:\/\//i.test(normalized.website)) return { field: "website", detail: "Il sito web deve iniziare con https://." };
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
