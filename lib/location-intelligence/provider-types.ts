export type GeocodeCandidate = {
  provider: "GEOAPIFY" | "MANUAL";
  providerPlaceId: string;
  formattedAddress: string;
  street: string;
  streetNumber: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  confidence: number;
};
