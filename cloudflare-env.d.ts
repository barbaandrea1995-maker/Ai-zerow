declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Site-managed secrets are optional in local preview and never persisted in source. */
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MALWARE_SCAN_WEBHOOK_TOKEN?: string;
  }
}
