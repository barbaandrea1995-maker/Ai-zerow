import { env } from "cloudflare:workers";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  return Response.json({
    provider: "openai",
    configured: Boolean(
      (typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim())
      || process.env.OPENAI_API_KEY?.trim(),
    ),
    model: env.OPENAI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    mode: "server_side_governed_preview",
    directWrite: false,
  }, { headers: { "cache-control": "private, no-store" } });
}
