CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`route_stop_id` text NOT NULL,
	`mission_id` text,
	`job_id` text,
	`event_type` text NOT NULL,
	`evidence_type` text NOT NULL,
	`evidence_reference` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`confirmed_by` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_events_tenant_idempotency_uq` ON `delivery_events` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `delivery_events_tenant_stop_occurred_idx` ON `delivery_events` (`tenant_id`,`route_stop_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `geo_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`formatted_address` text DEFAULT '' NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`street_number` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`country` text DEFAULT 'IT' NOT NULL,
	`latitude_e6` integer NOT NULL,
	`longitude_e6` integer NOT NULL,
	`provider` text DEFAULT 'MANUAL' NOT NULL,
	`provider_place_id` text,
	`geocode_confidence_milli` integer DEFAULT 0 NOT NULL,
	`verified_by_user` integer DEFAULT 0 NOT NULL,
	`verified_at` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geo_locations_tenant_entity_uq` ON `geo_locations` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `geo_locations_tenant_status_idx` ON `geo_locations` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `geo_locations_tenant_idempotency_uq` ON `geo_locations` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `geofences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`shape_type` text NOT NULL,
	`center_latitude_e6` integer,
	`center_longitude_e6` integer,
	`radius_meters` integer,
	`polygon_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geofences_tenant_location_uq` ON `geofences` (`tenant_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `geofences_tenant_entity_idx` ON `geofences` (`tenant_id`,`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `location_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`capability` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text DEFAULT '' NOT NULL,
	`purpose` text NOT NULL,
	`outcome` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `location_access_audit_tenant_created_idx` ON `location_access_audit` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `location_access_audit_tenant_actor_created_idx` ON `location_access_audit` (`tenant_id`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `location_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`tracking_session_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`location_id` text,
	`geofence_id` text,
	`source` text NOT NULL,
	`confidence_milli` integer DEFAULT 0 NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`correlation_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_events_tenant_dedupe_uq` ON `location_events` (`tenant_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `location_events_tenant_occurred_idx` ON `location_events` (`tenant_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `location_events_tenant_vehicle_occurred_idx` ON `location_events` (`tenant_id`,`vehicle_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `location_events_tenant_employee_occurred_idx` ON `location_events` (`tenant_id`,`employee_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `location_events_tenant_type_occurred_idx` ON `location_events` (`tenant_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `location_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tracking_session_id` text NOT NULL,
	`tracking_device_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`received_at` text NOT NULL,
	`latitude_e6` integer NOT NULL,
	`longitude_e6` integer NOT NULL,
	`accuracy_m` integer,
	`speed_kmh` integer,
	`heading` integer,
	`altitude` integer,
	`provider` text NOT NULL,
	`provider_event_id` text,
	`dedupe_key` text NOT NULL,
	`raw_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_samples_tenant_dedupe_uq` ON `location_samples` (`tenant_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `location_samples_tenant_session_recorded_idx` ON `location_samples` (`tenant_id`,`tracking_session_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `location_samples_tenant_vehicle_recorded_idx` ON `location_samples` (`tenant_id`,`vehicle_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `route_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`mission_id` text,
	`job_id` text,
	`driver_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`planned_start_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `route_plans_tenant_status_start_idx` ON `route_plans` (`tenant_id`,`status`,`planned_start_at`);--> statement-breakpoint
CREATE INDEX `route_plans_tenant_driver_start_idx` ON `route_plans` (`tenant_id`,`driver_id`,`planned_start_at`);--> statement-breakpoint
CREATE INDEX `route_plans_tenant_vehicle_start_idx` ON `route_plans` (`tenant_id`,`vehicle_id`,`planned_start_at`);--> statement-breakpoint
CREATE TABLE `route_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`route_plan_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`location_id` text NOT NULL,
	`expected_arrival_at` text,
	`expected_departure_at` text,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`delivery_status` text DEFAULT 'PLANNED' NOT NULL,
	`arrived_at` text,
	`departed_at` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_stops_tenant_route_sequence_uq` ON `route_stops` (`tenant_id`,`route_plan_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `route_stops_tenant_route_status_idx` ON `route_stops` (`tenant_id`,`route_plan_id`,`status`,`sequence`);--> statement-breakpoint
CREATE INDEX `route_stops_tenant_location_idx` ON `route_stops` (`tenant_id`,`location_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `tracking_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`external_device_id` text NOT NULL,
	`label` text NOT NULL,
	`device_type` text DEFAULT 'VEHICLE_GPS' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_devices_tenant_provider_external_uq` ON `tracking_devices` (`tenant_id`,`provider_id`,`external_device_id`);--> statement-breakpoint
CREATE INDEX `tracking_devices_tenant_status_idx` ON `tracking_devices` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tracking_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'NOT_CONFIGURED' NOT NULL,
	`endpoint_url` text DEFAULT '' NOT NULL,
	`token_reference` text DEFAULT '' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_providers_tenant_type_uq` ON `tracking_providers` (`tenant_id`,`provider_type`);--> statement-breakpoint
CREATE INDEX `tracking_providers_tenant_status_idx` ON `tracking_providers` (`tenant_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tracking_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`tracking_device_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`tracking_source` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_by` text NOT NULL,
	`policy_snapshot_id` text NOT NULL,
	`engine_state_json` text DEFAULT '{}' NOT NULL,
	`failure_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tracking_sessions_tenant_employee_status_idx` ON `tracking_sessions` (`tenant_id`,`employee_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `tracking_sessions_tenant_vehicle_status_idx` ON `tracking_sessions` (`tenant_id`,`vehicle_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `tracking_sessions_tenant_shift_idx` ON `tracking_sessions` (`tenant_id`,`shift_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `vehicle_device_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`device_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vehicle_device_bindings_tenant_vehicle_status_idx` ON `vehicle_device_bindings` (`tenant_id`,`vehicle_id`,`status`,`effective_from`);--> statement-breakpoint
CREATE INDEX `vehicle_device_bindings_tenant_device_status_idx` ON `vehicle_device_bindings` (`tenant_id`,`device_id`,`status`,`effective_from`);