/**
 * Release identity shared by the presentation API and the PWA diagnostics.
 * The service worker mirrors this literal in public/sw.js because it is a
 * browser asset and cannot import the server module.
 */
export const RELEASE_BUILD_ID = "ai-zerow-commercial-v1-rc2-9-local-r2026-10-02";
export const RELEASE_BUILD_LABEL = "COMMERCIAL-V1-RC2.9-LOCAL-R2026.10.02";
export const PREVIOUS_PUBLISHED_SITES_VERSION = 84;
export const RELEASE_PUBLICATION_STATUS = "PUBLISHED_TECHNICAL_CANDIDATE" as const;
