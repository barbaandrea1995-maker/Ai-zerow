declare module "@thegrizzlylabs/web-geniusscan-sdk" {
  export type GeniusScanSource = "camera" | "gallery" | "image";
  export type GeniusScanFilter =
    | "automatic"
    | "strong_monochrome"
    | "soft_grayscale"
    | "soft_color"
    | "strong_grayscale"
    | "strong_color"
    | "photo"
    | "dark_background"
    | "none";

  export type GeniusScanConfiguration = {
    source?: GeniusScanSource;
    sourceImage?: Blob;
    multiPage?: boolean;
    multiPageFormat?: "pdf" | "none";
    defaultFilter?: GeniusScanFilter;
    availableFilters?: GeniusScanFilter[];
    jpegQuality?: number;
    postProcessingActions?: Array<"rotate" | "editFilter" | "correctDistortion">;
    outputOriginalImage?: boolean;
    foregroundColor?: string;
    backgroundColor?: string;
    highlightColor?: string;
    language?: "it" | "en";
    pdfTitle?: string;
    pdfPageSize?: "fit" | "a4" | "letter";
  };

  export type GeniusScanResult = {
    scans: Array<{
      enhancedImage: { data: Blob; type: "image/jpeg" };
      originalImage?: { data: Blob; type: "image/jpeg" };
    }>;
    multiPageDocument?: { data: Blob; type: "application/pdf" };
  };

  export function setLicenseKey(licenseKey: string): Promise<void>;
  export function scanWithConfiguration(configuration: GeniusScanConfiguration): Promise<GeniusScanResult>;
  export function generatePDFFromImages(
    jpegs: Blob[],
    pdfPageSize?: "fit" | "a4" | "letter",
    title?: string,
  ): Promise<Blob>;
}
