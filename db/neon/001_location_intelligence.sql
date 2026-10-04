-- ZEROW Location Intelligence / PostgreSQL + PostGIS contract
--
-- This migration is intentionally kept outside the D1/Drizzle journal. The
-- current Sites control plane remains D1; applying this file requires the
-- authorized Neon migration lane, a tenant-session setter and a cutover
-- readback. It must never be applied by a request handler.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS zerow;

CREATE TABLE IF NOT EXISTS zerow.geo_locations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  formatted_address text NOT NULL DEFAULT '',
  street text NOT NULL DEFAULT '',
  street_number text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  province text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'IT',
  position geography(Point, 4326) NOT NULL,
  provider text NOT NULL DEFAULT 'MANUAL',
  provider_place_id text,
  geocode_confidence numeric(5,4) NOT NULL DEFAULT 0,
  verified_by_user boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS zerow.geofences (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL REFERENCES zerow.geo_locations(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  name text NOT NULL,
  shape_type text NOT NULL CHECK (shape_type IN ('CIRCLE', 'POLYGON')),
  center geography(Point, 4326),
  radius_meters integer,
  area geography(Geometry, 4326),
  status text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id),
  CHECK ((shape_type = 'CIRCLE' AND center IS NOT NULL AND radius_meters BETWEEN 20 AND 5000)
      OR (shape_type = 'POLYGON' AND area IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS zerow.tracking_providers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider_type text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  endpoint_url text NOT NULL DEFAULT '',
  token_reference text NOT NULL DEFAULT '',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_type)
);

CREATE TABLE IF NOT EXISTS zerow.tracking_devices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider_id text NOT NULL REFERENCES zerow.tracking_providers(id),
  external_device_id text NOT NULL,
  label text NOT NULL,
  device_type text NOT NULL DEFAULT 'VEHICLE_GPS',
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_id, external_device_id)
);

CREATE TABLE IF NOT EXISTS zerow.vehicle_device_bindings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  vehicle_id text NOT NULL,
  device_id text NOT NULL REFERENCES zerow.tracking_devices(id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zerow.tracking_sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  employee_id text NOT NULL,
  vehicle_id text NOT NULL,
  tracking_device_id text NOT NULL REFERENCES zerow.tracking_devices(id),
  shift_id text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  tracking_source text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  created_by text NOT NULL,
  policy_snapshot_id text NOT NULL,
  engine_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zerow.location_samples (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  tracking_session_id text NOT NULL REFERENCES zerow.tracking_sessions(id),
  tracking_device_id text NOT NULL REFERENCES zerow.tracking_devices(id),
  vehicle_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  position geography(Point, 4326) NOT NULL,
  accuracy_m integer,
  speed_kmh integer,
  heading integer,
  altitude integer,
  provider text NOT NULL,
  provider_event_id text,
  dedupe_key text NOT NULL,
  raw_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS zerow.location_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  tracking_session_id text NOT NULL REFERENCES zerow.tracking_sessions(id),
  employee_id text NOT NULL,
  vehicle_id text NOT NULL,
  location_id text REFERENCES zerow.geo_locations(id),
  geofence_id text REFERENCES zerow.geofences(id),
  source text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS zerow.route_plans (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  mission_id text,
  job_id text,
  driver_id text NOT NULL,
  vehicle_id text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  planned_start_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zerow.route_stops (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  route_plan_id text NOT NULL REFERENCES zerow.route_plans(id),
  sequence integer NOT NULL,
  location_id text NOT NULL REFERENCES zerow.geo_locations(id),
  expected_arrival_at timestamptz,
  expected_departure_at timestamptz,
  status text NOT NULL DEFAULT 'PLANNED',
  delivery_status text NOT NULL DEFAULT 'PLANNED',
  arrived_at timestamptz,
  departed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_plan_id, sequence)
);

CREATE TABLE IF NOT EXISTS zerow.delivery_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  route_stop_id text NOT NULL REFERENCES zerow.route_stops(id),
  mission_id text,
  job_id text,
  event_type text NOT NULL,
  evidence_type text NOT NULL,
  evidence_reference text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  confirmed_by text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS zerow.location_access_audit (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  capability text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL DEFAULT '',
  purpose text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_locations_position_gist ON zerow.geo_locations USING gist(position);
CREATE INDEX IF NOT EXISTS geofences_center_gist ON zerow.geofences USING gist(center);
CREATE INDEX IF NOT EXISTS geofences_area_gist ON zerow.geofences USING gist(area);
CREATE INDEX IF NOT EXISTS location_samples_position_gist ON zerow.location_samples USING gist(position);
CREATE INDEX IF NOT EXISTS location_events_tenant_occurred_idx ON zerow.location_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS location_events_vehicle_occurred_idx ON zerow.location_events (tenant_id, vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS location_events_employee_occurred_idx ON zerow.location_events (tenant_id, employee_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS location_access_audit_tenant_created_idx ON zerow.location_access_audit (tenant_id, created_at DESC);

-- Tenant isolation is activated by the application transaction setting:
-- SELECT set_config('zerow.tenant_id', :tenant_id, true);
-- Explicit statements keep this migration compatible with managed migration runners.
ALTER TABLE zerow.geo_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY geo_locations_tenant_isolation ON zerow.geo_locations USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY geofences_tenant_isolation ON zerow.geofences USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.tracking_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracking_providers_tenant_isolation ON zerow.tracking_providers USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.tracking_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracking_devices_tenant_isolation ON zerow.tracking_devices USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.vehicle_device_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_device_bindings_tenant_isolation ON zerow.vehicle_device_bindings USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.tracking_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tracking_sessions_tenant_isolation ON zerow.tracking_sessions USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.location_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_samples_tenant_isolation ON zerow.location_samples USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.location_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_events_tenant_isolation ON zerow.location_events USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.route_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_plans_tenant_isolation ON zerow.route_plans USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.route_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_stops_tenant_isolation ON zerow.route_stops USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.delivery_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_events_tenant_isolation ON zerow.delivery_events USING (tenant_id = current_setting('zerow.tenant_id', true));
ALTER TABLE zerow.location_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_access_audit_tenant_isolation ON zerow.location_access_audit USING (tenant_id = current_setting('zerow.tenant_id', true));

REVOKE UPDATE, DELETE ON zerow.location_samples, zerow.location_events, zerow.delivery_events, zerow.location_access_audit FROM PUBLIC;
