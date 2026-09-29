import {
  getS07Context,
  getS07Ledger,
  s07AccessDenied,
  s07Envelope,
  s07Error,
} from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "read");
  if (denied) return denied;
  try {
    const rows = await getS07Ledger(context!.tenantId);
    return Response.json(s07Envelope(context!, rows), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: s07Error(error) }, { status: 503 });
  }
}
