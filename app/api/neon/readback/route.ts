import { getAuthorityContext } from "@/lib/authority-context";
import { externalAccessDenied } from "@/lib/external-adapter";
import { getNeonReadback, NeonReadbackError } from "@/lib/neon-readback";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthorityContext();
  const denied = externalAccessDenied(context, "read");
  if (denied) return denied;

  try {
    const readback = await getNeonReadback();
    return Response.json({
      context: {
        tenantId: context!.tenantId,
        role: context!.role,
        access: "owner-only",
      },
      ...readback,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof NeonReadbackError
      ? error.code
      : "neon_runtime_readback_failed";
    return Response.json({ error: code }, { status: 503 });
  }
}
