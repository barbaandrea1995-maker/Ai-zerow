import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accessProfiles } from "@/db/schema";
import {
  assertTenantScope,
  getAuthorityContext,
  hasCapability,
  profileForResponse,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";
import {
  isAuthorityRole,
  ROLE_CAPABILITIES,
} from "@/lib/authority-catalog";

export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("access_profiles")) {
    return "authority_store_unavailable";
  }
  return "authority_readback_failed";
}

function requireAuthorityOwner(
  context: AuthorityContext | null,
): Response | null {
  if (!context) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!hasCapability(context, "tenant.manage")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const context = await getAuthorityContext();
  const denied = requireAuthorityOwner(context);
  if (denied) return denied;

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(accessProfiles)
      .where(eq(accessProfiles.tenantId, context!.tenantId))
      .orderBy(desc(accessProfiles.createdAt));

    return Response.json({
      context: publicAuthorityContext(context!),
      profiles: rows.map(profileForResponse),
    });
  } catch (error) {
    return Response.json({ error: jsonError(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  const denied = requireAuthorityOwner(context);
  if (denied) return denied;

  let payload: { label?: unknown; role?: unknown };
  try {
    payload = (await request.json()) as { label?: unknown; role?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  if (label.length < 2 || label.length > 80) {
    return Response.json({ error: "label_must_be_2_to_80_characters" }, { status: 400 });
  }
  if (!isAuthorityRole(role)) {
    return Response.json({ error: "invalid_base_role" }, { status: 400 });
  }

  try {
    const id = crypto.randomUUID();
    const capabilities = [...ROLE_CAPABILITIES[role]];
    assertTenantScope(context!, context!.tenantId);
    const db = getDb();
    const [row] = await db
      .insert(accessProfiles)
      .values({
        id,
        tenantId: context!.tenantId,
        label,
        baseRole: role,
        capabilitiesJson: JSON.stringify(capabilities),
        createdBy: context!.actorId,
      })
      .returning();

    return Response.json(
      { context: publicAuthorityContext(context!), profile: profileForResponse(row) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: jsonError(error) }, { status: 503 });
  }
}
