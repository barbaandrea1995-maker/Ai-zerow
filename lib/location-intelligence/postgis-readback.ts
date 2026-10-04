import { neon } from "@neondatabase/serverless";
import { env } from "cloudflare:workers";

type RuntimeEnv = {
  LOCATION_DATABASE_URL?: string;
};

type Row = Record<string, unknown>;

export class LocationPostgisReadbackError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function runtimeDatabaseUrl() {
  const bound = (env as unknown as RuntimeEnv).LOCATION_DATABASE_URL;
  if (typeof bound === "string" && bound.trim()) return bound.trim();
  const local = process.env.LOCATION_DATABASE_URL;
  return typeof local === "string" ? local.trim() : "";
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
}

function first(value: unknown): Row {
  return rows(value)[0] ?? {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function classifyError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return `location_postgis_sql_${candidate.code.toLowerCase()}`;
    }
    if (candidate.name === "NeonDbError") return "location_postgis_sql_error";
    if (typeof candidate.message === "string" && /fetch|connect/i.test(candidate.message)) {
      return "location_postgis_transport_error";
    }
  }
  return "location_postgis_readback_failed";
}

/**
 * Read-only proof that the Location Intelligence runtime can reach PostGIS.
 * The tenant setting and all counts execute inside one transaction. No raw
 * coordinates or provider payloads are returned to the caller.
 */
export async function getLocationPostgisReadback(tenantId: string) {
  const connectionString = runtimeDatabaseUrl();
  if (!connectionString) {
    return {
      status: "NOT_CONFIGURED" as const,
      checkedAt: new Date().toISOString(),
      tenantScoped: false,
      error: "location_postgis_runtime_binding_missing",
    };
  }

  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) {
    throw new LocationPostgisReadbackError("location_postgis_tenant_missing");
  }

  try {
    const sql = neon(connectionString, { readOnly: true });
    const [runtimeRows, extensionRows, tenantRows, countRows, permissionRows, spatialRows] = await sql.transaction(
      (transaction) => [
        transaction.query(
          "SELECT current_database() AS database_name, current_user AS current_role, current_setting('server_version') AS postgres_version",
        ),
        transaction.query(
          "SELECT extversion FROM pg_extension WHERE extname = 'postgis' LIMIT 1",
        ),
        transaction.query(
          "SELECT set_config('zerow.tenant_id', $1, true) AS applied_tenant, current_setting('zerow.tenant_id', true) AS active_tenant",
          [scopedTenantId],
        ),
        transaction.query(
          "SELECT (SELECT count(*)::int FROM zerow.geo_locations) AS geo_locations, (SELECT count(*)::int FROM zerow.geofences) AS geofences, (SELECT count(*)::int FROM zerow.tracking_providers) AS tracking_providers, (SELECT count(*)::int FROM zerow.tracking_devices) AS tracking_devices, (SELECT count(*)::int FROM zerow.vehicle_device_bindings) AS vehicle_device_bindings, (SELECT count(*)::int FROM zerow.tracking_sessions) AS tracking_sessions, (SELECT count(*)::int FROM zerow.location_samples) AS location_samples, (SELECT count(*)::int FROM zerow.location_events) AS location_events, (SELECT count(*)::int FROM zerow.route_plans) AS route_plans, (SELECT count(*)::int FROM zerow.route_stops) AS route_stops, (SELECT count(*)::int FROM zerow.delivery_events) AS delivery_events, (SELECT count(*)::int FROM zerow.location_access_audit) AS location_access_audit",
        ),
        transaction.query(
          "SELECT current_user AS runtime_role, has_schema_privilege(current_user, 'zerow', 'USAGE') AS schema_usage, has_table_privilege(current_user, 'zerow.geo_locations', 'SELECT') AS location_select, has_table_privilege(current_user, 'zerow.geo_locations', 'INSERT') AS location_insert, has_table_privilege(current_user, 'zerow.location_samples', 'UPDATE') AS samples_update, has_table_privilege(current_user, 'zerow.location_events', 'DELETE') AS events_delete, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) AS bypasses_rls",
        ),
        transaction.query(
          "SELECT ST_DWithin(ST_SetSRID(ST_MakePoint(12.4964, 41.9028), 4326)::geography, ST_SetSRID(ST_MakePoint(12.4964, 41.9028), 4326)::geography, 1) AS spatial_query_ok",
        ),
      ],
      { readOnly: true },
    );

    const runtime = first(runtimeRows);
    const extension = first(extensionRows);
    const tenant = first(tenantRows);
    const counts = first(countRows);
    const permissions = first(permissionRows);
    const spatial = first(spatialRows);
    const tenantApplied = stringValue(tenant.applied_tenant) === scopedTenantId
      && stringValue(tenant.active_tenant) === scopedTenantId;
    const postgisVersion = stringValue(extension.extversion);
    const spatialQueryOk = booleanValue(spatial.spatial_query_ok);
    const leastPrivilege = booleanValue(permissions.schema_usage)
      && booleanValue(permissions.location_select)
      && !booleanValue(permissions.location_insert)
      && !booleanValue(permissions.samples_update)
      && !booleanValue(permissions.events_delete)
      && !booleanValue(permissions.bypasses_rls);

    return {
      status: postgisVersion && tenantApplied && spatialQueryOk && leastPrivilege
        ? "CONNECTED_READBACK_VERIFIED" as const
        : "DEGRADED" as const,
      checkedAt: new Date().toISOString(),
      tenantScoped: tenantApplied,
      runtime: {
        databaseName: stringValue(runtime.database_name),
        runtimeRole: stringValue(runtime.current_role),
        postgresVersion: stringValue(runtime.postgres_version),
        postgisVersion,
      },
      spatialQueryOk,
      leastPrivilege: {
        schemaUsage: booleanValue(permissions.schema_usage),
        locationSelect: booleanValue(permissions.location_select),
        locationInsert: booleanValue(permissions.location_insert),
        samplesUpdate: booleanValue(permissions.samples_update),
        eventsDelete: booleanValue(permissions.events_delete),
        bypassesRls: booleanValue(permissions.bypasses_rls),
      },
      visibleRows: {
        geoLocations: numberValue(counts.geo_locations),
        geofences: numberValue(counts.geofences),
        trackingProviders: numberValue(counts.tracking_providers),
        trackingDevices: numberValue(counts.tracking_devices),
        vehicleDeviceBindings: numberValue(counts.vehicle_device_bindings),
        trackingSessions: numberValue(counts.tracking_sessions),
        locationSamples: numberValue(counts.location_samples),
        locationEvents: numberValue(counts.location_events),
        routePlans: numberValue(counts.route_plans),
        routeStops: numberValue(counts.route_stops),
        deliveryEvents: numberValue(counts.delivery_events),
        locationAccessAudit: numberValue(counts.location_access_audit),
      },
    };
  } catch (error) {
    const code = classifyError(error);
    console.error("location_postgis_readback_failed", code);
    throw new LocationPostgisReadbackError(code);
  }
}
