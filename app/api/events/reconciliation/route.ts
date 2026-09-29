import {
  getS06Context,
  getS06Snapshot,
  s06AccessDenied,
  s06Envelope,
  s06Error,
} from "@/lib/s06-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getS06Context();
  const denied = s06AccessDenied(context, "read");
  if (denied) return denied;
  try {
    const snapshot = await getS06Snapshot(context!.tenantId);
    return Response.json({ ...s06Envelope(context!, snapshot), surface: "reconciliation" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: s06Error(error) }, { status: 503 });
  }
}
