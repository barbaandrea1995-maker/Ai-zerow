import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { commandDashboardPreferences } from "@/db/schema";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";
import {
  COMMAND_WIDGET_SCHEMA_VERSION,
  defaultCommandWidgetLayout,
  getAllowedCommandNavigation,
  publicCommandWidgetCatalog,
  sanitizeCommandWidgetLayout,
} from "@/lib/command-dashboard";

export const dynamic = "force-dynamic";

function preferenceError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("no such table") || message.includes("command_dashboard_preferences")) {
    return "command_preferences_store_unavailable";
  }
  return "command_preferences_readback_failed";
}

function parseLayout(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function envelope(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  layout: ReturnType<typeof defaultCommandWidgetLayout>,
  savedAt: string | null,
) {
  return {
    schemaVersion: COMMAND_WIDGET_SCHEMA_VERSION,
    role: context.role,
    canCustomize: hasCapability(context, "command.customize"),
    allowedNavigation: getAllowedCommandNavigation(context.capabilities).map((item) => item.id),
    catalog: publicCommandWidgetCatalog(context.capabilities),
    layout,
    savedAt,
  };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(commandDashboardPreferences)
      .where(and(
        eq(commandDashboardPreferences.tenantId, context.tenantId),
        eq(commandDashboardPreferences.actorId, context.actorId),
      ))
      .limit(1);

    const row = rows[0];
    const layout = row
      ? sanitizeCommandWidgetLayout(parseLayout(row.layoutJson), context.capabilities)
      : defaultCommandWidgetLayout(context.capabilities);

    return Response.json(envelope(context, layout, row?.updatedAt ?? null), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: preferenceError(error) }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "command.read") || !hasCapability(context, "command.customize")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: { layout?: unknown };
  try {
    payload = await request.json() as { layout?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(payload.layout)) {
    return Response.json({ error: "layout_must_be_an_array" }, { status: 400 });
  }

  const layout = sanitizeCommandWidgetLayout(payload.layout, context.capabilities);
  const now = new Date().toISOString();

  try {
    await getDb()
      .insert(commandDashboardPreferences)
      .values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        actorId: context.actorId,
        schemaVersion: COMMAND_WIDGET_SCHEMA_VERSION,
        layoutJson: JSON.stringify(layout),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [commandDashboardPreferences.tenantId, commandDashboardPreferences.actorId],
        set: {
          schemaVersion: COMMAND_WIDGET_SCHEMA_VERSION,
          layoutJson: JSON.stringify(layout),
          updatedAt: now,
        },
      });

    return Response.json(envelope(context, layout, now), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: preferenceError(error) }, { status: 503 });
  }
}
