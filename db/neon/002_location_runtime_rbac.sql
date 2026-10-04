-- ZEROW Location Intelligence / least-privilege runtime role
--
-- The application readback uses zerow_runtime. It is deliberately read-only:
-- D1 remains the control plane until an explicit, tested cutover is approved.

GRANT USAGE ON SCHEMA zerow TO zerow_runtime;

GRANT SELECT ON TABLE
  zerow.geo_locations,
  zerow.geofences,
  zerow.tracking_providers,
  zerow.tracking_devices,
  zerow.vehicle_device_bindings,
  zerow.tracking_sessions,
  zerow.location_samples,
  zerow.location_events,
  zerow.route_plans,
  zerow.route_stops,
  zerow.delivery_events,
  zerow.location_access_audit
TO zerow_runtime;

ALTER ROLE zerow_runtime NOINHERIT;
