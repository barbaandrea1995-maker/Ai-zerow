import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const RUN_ID = randomUUID().slice(0, 8).toLowerCase();
const ADDRESS = "Via Catullo 93, 00071 Pomezia RM, Italia";
const profiles = ["OPERATIONS", "WAREHOUSE", "TRANSPORT", "WAREHOUSE_TRANSPORT", "FULL_OPERATIONS"];

function actorFor(profile) {
  return `e2e-profile-${profile.toLowerCase().replaceAll("_", "-")}-${RUN_ID}`;
}

function headers(actorId) {
  return {
    "content-type": "application/json",
    "oai-authenticated-user-id": actorId,
    "oai-authenticated-user-email": `${actorId}@example.invalid`,
    "oai-authenticated-user-name": `Verifica ${actorId}`,
  };
}

async function requestJson(actorId, path, { method = "GET", body, expected = [200] } = {}) {
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: headers(actorId),
      body: requestBody,
    });
    const raw = await response.text();
    if (response.status === 503 && /worker restarted mid-request/i.test(raw) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      continue;
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${raw.slice(0, 300)}`);
    }
    assert(
      expected.includes(response.status),
      `${method} ${path}: expected ${expected.join("/")}, received ${response.status} (${JSON.stringify(payload).slice(0, 900)})`,
    );
    return { status: response.status, payload };
  }
  throw new Error(`${method} ${path} exhausted transient worker-restart retries`);
}

function companyProfile(profile) {
  const suffix = profiles.indexOf(profile) + 1;
  return {
    legalForm: "SRL",
    vatNumber: `1234567890${suffix}`,
    taxCode: `1234567890${suffix}`,
    registeredAddress: ADDRESS,
    registeredPostalCode: "00071",
    registeredCity: "Pomezia",
    registeredProvince: "RM",
    registeredCountry: "IT",
    businessEmail: `${profile.toLowerCase()}-${RUN_ID}@example.invalid`,
    businessPhone: "+390691234567",
  };
}

async function geocode(actorId, address = ADDRESS) {
  const response = await requestJson(actorId, "/api/location/geocode", {
    method: "POST",
    body: { address },
  });
  const candidate = response.payload.candidates?.[0];
  assert(candidate?.providerPlaceId, `${actorId}: Geoapify must return a canonical place`);
  assert(Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude), `${actorId}: geocoder coordinates missing`);
  return candidate;
}

async function createWarehouse(actorId, label) {
  const candidate = await geocode(actorId);
  const response = await requestJson(actorId, "/api/authority/warehouses", {
    method: "POST",
    body: {
      name: `Deposito ${label}`,
      locationQuery: ADDRESS,
      locationProvider: "GEOAPIFY",
      providerPlaceId: candidate.providerPlaceId,
      geofenceRadiusMeters: 100,
    },
    expected: [201],
  });
  const warehouse = response.payload.created;
  assert(warehouse?.id, `${label}: warehouse creation must return the canonical record`);
  assert.equal(warehouse.locationSource, "GEOAPIFY");
  return { warehouse, candidate };
}

async function setOwnRoles(actorId, roles) {
  const directory = await requestJson(actorId, "/api/authority/memberships");
  const membership = directory.payload.memberships?.find((entry) => entry.actorId === actorId);
  assert(membership?.id && membership.version, `${actorId}: owner membership readback missing`);
  if (roles.length === membership.roles?.length && roles.every((role, index) => role === membership.roles[index])) {
    return membership;
  }
  const updated = await requestJson(actorId, "/api/authority/memberships", {
    method: "PATCH",
    body: {
      targetId: membership.id,
      action: "set_roles",
      roles,
      expectedVersion: membership.version,
      idempotencyKey: `profile-roles-${RUN_ID}-${roles.join("-")}`.slice(0, 160),
    },
  });
  const result = updated.payload.memberships?.find((entry) => entry.actorId === actorId);
  assert(result?.roles?.includes("owner"), `${actorId}: operational roles must preserve owner authority`);
  return result;
}

async function provisionProfile(profile) {
  const actorId = actorFor(profile);
  const created = await requestJson(actorId, "/api/tenants", {
    method: "POST",
    body: {
      name: `E2E ${profile} ${RUN_ID}`,
      slug: `e2e-${profile.toLowerCase().replaceAll("_", "-")}-${RUN_ID}`,
      operatingProfile: profile,
      companyProfile: companyProfile(profile),
    },
    expected: [201],
  });
  assert.equal(created.payload.context?.operatingProfile, profile);
  const roles = profile === "OPERATIONS"
    ? ["owner", "field_supervisor", "worker"]
    : profile === "WAREHOUSE"
      ? ["owner", "warehouse_manager", "warehouse_operator"]
      : profile === "TRANSPORT"
        ? ["owner", "delivery_driver", "worker"]
        : profile === "WAREHOUSE_TRANSPORT"
          ? ["owner", "warehouse_manager", "warehouse_operator", "delivery_driver"]
          : ["owner", "field_supervisor", "worker", "warehouse_manager", "warehouse_operator", "delivery_driver"];
  const membership = await setOwnRoles(actorId, roles);
  let warehouse = null;
  let warehouseCandidate = null;
  if (profile.includes("WAREHOUSE") || profile === "FULL_OPERATIONS") {
    const createdWarehouse = await createWarehouse(actorId, profile);
    warehouse = createdWarehouse.warehouse;
    warehouseCandidate = createdWarehouse.candidate;
  }
  const completed = await requestJson(actorId, "/api/tenants/complete", { method: "POST" });
  assert.equal(completed.payload.complete, true, `${profile}: onboarding must complete`);
  return { actorId, profile, membership, warehouse, warehouseCandidate };
}

async function assertDomainBoundaries(state) {
  const { actorId, profile } = state;
  const hasOperations = profile === "OPERATIONS" || profile === "FULL_OPERATIONS";
  const hasWarehouse = profile === "WAREHOUSE" || profile === "WAREHOUSE_TRANSPORT" || profile === "FULL_OPERATIONS";
  const hasTransport = profile === "TRANSPORT" || profile === "WAREHOUSE_TRANSPORT" || profile === "FULL_OPERATIONS";

  if (!hasOperations) {
    const denied = await requestJson(actorId, "/api/operations", { method: "POST", body: {}, expected: [403] });
    assert.equal(denied.payload.capability, "operations.write");
  }
  if (!hasWarehouse) {
    const denied = await requestJson(actorId, "/api/authority/warehouses", { method: "POST", body: {}, expected: [403] });
    assert.match(String(denied.payload.capability || ""), /^warehouse\./);
  }
  if (!hasTransport) {
    const deniedAsset = await requestJson(actorId, "/api/assets", { method: "POST", body: {}, expected: [403] });
    assert.equal(deniedAsset.payload.error, "forbidden");
    const deniedMission = await requestJson(actorId, "/api/mission/control", { method: "POST", body: {}, expected: [403] });
    assert.equal(deniedMission.payload.error, "forbidden");
  }
}

function futureWindow(dayOffset, hours = 2) {
  const startsAt = new Date(Date.UTC(2038, 0, 1 + dayOffset, 7, 0, 0)).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + hours * 60 * 60 * 1_000).toISOString();
  return { startsAt, endsAt };
}

async function registerInventory(state, openingQuantity = 20) {
  assert(state.warehouse?.id, `${state.profile}: warehouse required for inventory flow`);
  const response = await requestJson(state.actorId, "/api/warehouse/inventory", {
    method: "POST",
    body: {
      action: "register_item",
      warehouseId: state.warehouse.id,
      name: `Prolunga CLS 40x40 ${RUN_ID}`,
      unit: "PZ",
      openingQuantity,
      minStock: 2,
      note: "Saldo iniziale collaudo E2E",
      idempotencyKey: `profile-inventory-register-${state.profile}-${RUN_ID}`,
    },
    expected: [201],
  });
  const item = response.payload.items?.[0];
  assert(item?.id && item.version === 1, `${state.profile}: inventory item readback missing`);
  assert.equal(item.onHand, openingQuantity);

  const received = await requestJson(state.actorId, "/api/warehouse/inventory", {
    method: "POST",
    body: {
      action: "receive",
      warehouseId: state.warehouse.id,
      itemId: item.id,
      expectedVersion: item.version,
      quantity: 5,
      note: "Ricezione fisica verificata E2E",
      idempotencyKey: `profile-inventory-receive-${state.profile}-${RUN_ID}`,
    },
  });
  const updated = received.payload.items?.[0];
  assert.equal(updated?.onHand, openingQuantity + 5, `${state.profile}: receipt must update the server ledger`);
  assert.equal(received.payload.movement?.movementType, "RECEIVE");
  state.inventoryItem = updated;
  return updated;
}

async function createJob(state) {
  const candidate = await geocode(state.actorId, "Viale Filippo Tommaso Marinetti, 00143 Roma RM, Italia");
  const created = await requestJson(state.actorId, "/api/operations", {
    method: "POST",
    body: {
      title: `Riqualificazione Marinetti ${RUN_ID}`,
      description: "Allargamento marciapiedi e rialzo chiusini con installazione bocche di lupo.",
      client: "Cliente E2E SRL",
      worksite: candidate.formattedAddress,
      worksiteLocation: {
        provider: candidate.provider,
        providerPlaceId: candidate.providerPlaceId,
        coordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
      },
      statusCode: "ACTIVE",
      openingType: "NUOVA_COMMESSA",
      scope: {
        sectionId: "B",
        groupId: "B-SUPERFICI",
        subgroupId: "B-SUPERFICI-MARCIAPIEDI",
      },
      dueDate: "2038-12-31",
      priority: "STANDARD",
      workItems: [{ id: "work-1", label: "Posa e ripristino", detail: "Posa manufatti e ripristino finale", quantity: "1", unit: "corpo" }],
      idempotencyKey: `profile-job-create-${state.profile}-${RUN_ID}`,
    },
    expected: [200, 201],
  });
  const job = created.payload.created;
  assert(job?.id, `${state.profile}: commessa creation readback missing`);
  assert.equal(job.payload?.worksiteLocation?.status, "SERVER_VERIFIED");
  state.job = job;
  state.jobCandidate = candidate;
  state.jobVersion = job.payload.version;
  return job;
}

async function mutateJob(state, action, body, expected = [200]) {
  const response = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}`, {
    method: "PATCH",
    body: {
      action,
      expectedVersion: state.jobVersion,
      idempotencyKey: `profile-job-${action}-${state.profile}-${RUN_ID}-${state.jobVersion}`,
      ...body,
    },
    expected,
  });
  if (expected.includes(response.status) && response.status < 300 && response.payload.mutation?.version) {
    state.jobVersion = response.payload.mutation.version;
    state.job = response.payload.job;
  }
  return response;
}

async function planJob(state, dayOffset) {
  const window = futureWindow(dayOffset);
  const options = await requestJson(
    state.actorId,
    `/api/operations/jobs/${encodeURIComponent(state.job.id)}/planning/resource-options?activityType=WORK&startsAt=${encodeURIComponent(window.startsAt)}&endsAt=${encodeURIComponent(window.endsAt)}`,
  );
  const person = options.payload.options?.workforce?.find((entry) => entry.actorId === state.actorId)
    || options.payload.options?.workforce?.[0];
  assert(person?.id, `${state.profile}: workforce planning catalog must expose an eligible person`);
  const draft = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/planning`, {
    method: "POST",
    body: {
      action: "draft",
      title: `Piano lavoro ${RUN_ID}`,
      activityType: "WORK",
      priority: "STANDARD",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      requiredQualifications: [],
      notes: "Piano verificato end-to-end",
      resourceIds: [person.id],
      idempotencyKey: `profile-plan-draft-${state.profile}-${RUN_ID}`,
    },
    expected: [201],
  });
  assert.equal(draft.payload.evaluation?.feasible, true);
  const published = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/planning`, {
    method: "POST",
    body: {
      action: "publish",
      recordId: draft.payload.plan.id,
      expectedVersion: draft.payload.plan.version,
      idempotencyKey: `profile-plan-publish-${state.profile}-${RUN_ID}`,
    },
  });
  assert.equal(published.payload.plan?.status, "PUBLISHED");
  state.plan = published.payload.plan;
  return published.payload.plan;
}

async function completeOperationsFlow(state, { closeJob = true, planningDay = 1, beforeFinalization } = {}) {
  await createJob(state);
  const workspace = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}`);
  const responsible = workspace.payload.workspace?.options?.assignment?.people?.find((entry) => entry.actorId === state.actorId);
  assert(responsible?.eligibleRoleCodes?.includes("RESPONSABILE_OPERATIVO"), `${state.profile}: responsible registry mismatch`);

  await mutateJob(state, "assign", {
    responsibleMembershipId: responsible.id,
    role: "RESPONSABILE_OPERATIVO",
  });
  const activityResponse = await mutateJob(state, "add_activity", {
    title: "Attività della giornata",
    detail: "Esecuzione delle lavorazioni pianificate e verifica finale.",
    ownerMembershipId: responsible.id,
    dueDate: "2038-12-30",
  });
  const activity = activityResponse.payload.job?.payload?.activities?.at(-1);
  assert(activity?.id, `${state.profile}: activity readback missing`);
  state.activityId = activity.id;
  await planJob(state, planningDay);

  const blockedReport = await mutateJob(state, "submit_rapportino", {
    answers: [
      "Abbiamo eseguito le lavorazioni previste con controllo conclusivo positivo.",
      "Nessuna criticità o condizione di rischio rilevata durante il turno.",
      "Resta soltanto il controllo documentale finale da parte dell'ufficio.",
    ],
  }, [422]);
  assert(blockedReport.payload.completeness?.missing?.some((item) => String(item).startsWith("attendance")), `${state.profile}: report must stay blocked before attendance closes`);

  const fieldOpen = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: {
      action: "field_open",
      title: "Turno operativo E2E",
      notes: "Apertura server-side del turno",
      idempotencyKey: `profile-field-open-${state.profile}-${RUN_ID}`,
    },
    expected: [201],
  });
  const field = fieldOpen.payload.mutation?.record;
  assert(field?.id, `${state.profile}: field session missing`);

  const coordinate = { lat: state.jobCandidate.latitude, lon: state.jobCandidate.longitude, accuracyM: 5 };
  const checkIn = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/attendance`, {
    method: "POST",
    body: {
      action: "check_in",
      location: coordinate,
      clientObservedAt: new Date().toISOString(),
      idempotencyKey: `profile-field-checkin-${state.profile}-${RUN_ID}`,
    },
    expected: [201],
  });
  assert.equal(checkIn.payload.attendance?.status, "CHECKED_IN");
  const checkOut = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/attendance`, {
    method: "POST",
    body: {
      action: "check_out",
      expectedVersion: checkIn.payload.attendance.version,
      location: coordinate,
      clientObservedAt: new Date().toISOString(),
      idempotencyKey: `profile-field-checkout-${state.profile}-${RUN_ID}`,
    },
  });
  assert.equal(checkOut.payload.attendance?.status, "CHECKED_OUT");

  const fieldClosed = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: {
      action: "field_close",
      recordId: field.id,
      expectedVersion: field.version,
      summary: "Turno completato, area verificata e consegnata senza anomalie.",
      idempotencyKey: `profile-field-close-${state.profile}-${RUN_ID}`,
    },
  });
  assert.equal(fieldClosed.payload.mutation?.record?.status, "CLOSED");

  if (beforeFinalization) await beforeFinalization(state);

  await mutateJob(state, "complete_activity", { activityId: state.activityId });
  await mutateJob(state, "add_evidence", {
    kind: "note",
    title: "Controllo conclusivo",
    detail: "Lavorazione verificata sul posto dal responsabile operativo.",
  });
  await mutateJob(state, "set_progress", { progress: 100 });
  const submitted = await mutateJob(state, "submit_rapportino", {
    answers: [
      "Sono state completate posa, ripristino e verifica conclusiva con esito positivo.",
      "Nessuna criticità, incidente, ritardo o carenza di materiali durante il turno.",
      "L'ufficio deve archiviare il rapportino; non restano lavorazioni operative aperte.",
    ],
  });
  assert.equal(submitted.payload.workspace?.rapportino?.status, "SUBMITTED");

  if (closeJob) {
    await mutateJob(state, "set_status", { statusCode: "COMPLETED" });
    const closed = await mutateJob(state, "set_status", { statusCode: "CLOSED" });
    assert.equal(closed.payload.job?.payload?.statusCode, "CLOSED");
  }
  return state.job;
}

async function warehouseOnlyFlow(state) {
  const item = await registerInventory(state);
  const readback = await requestJson(state.actorId, `/api/warehouse/inventory?warehouseId=${encodeURIComponent(state.warehouse.id)}`);
  const stored = readback.payload.items?.find((entry) => entry.id === item.id);
  assert.equal(stored?.onHand, 25);
  assert(readback.payload.movements?.some((entry) => entry.movementType === "REGISTER"));
  assert(readback.payload.movements?.some((entry) => entry.movementType === "RECEIVE"));
  const requests = await requestJson(state.actorId, "/api/warehouse/requests");
  assert.equal(requests.payload.readback?.status, "verified");
}

async function createTransportResources(state, { withCargo, dayOffset }) {
  const warehouseId = state.warehouse?.id;
  const vehicleBody = {
    title: `Iveco Daily trasporto ${state.profile} ${RUN_ID}`,
    detail: `Iveco Daily trasporto ${state.profile} ${RUN_ID}`,
    meta: "Mezzo di trasporto verificato E2E",
    status: "AVAILABLE",
    recordType: "asset-register",
    entityType: "vehicle",
    usageMode: "TRANSPORT",
    operationalProfile: "TRANSPORT",
    transportCapabilities: ["MATERIALS", "ASSETS"],
    brand: "Iveco",
    model: "Daily 35C",
    registration: `E2E-${state.profile.slice(0, 3)}-${RUN_ID}`.toUpperCase(),
    ...(warehouseId ? { warehouseId } : {}),
    capacity: 1,
    maxPayloadKg: 3500,
    transportable: false,
    lifecycleStatus: "AVAILABLE",
    availabilityGuard: "ASSIGNABLE",
    idempotencyKey: `profile-vehicle-create-${state.profile}-${RUN_ID}`,
  };
  const vehicleResponse = await requestJson(state.actorId, "/api/assets", {
    method: "POST",
    body: vehicleBody,
    expected: [201],
  });
  const vehicle = vehicleResponse.payload.created;
  assert.match(vehicle?.canonicalCode || "", /^MEZZI-/i);
  assert.equal(vehicle?.payload?.transportable, false);

  let cargo = null;
  if (withCargo) {
    const cargoResponse = await requestJson(state.actorId, "/api/assets", {
      method: "POST",
      body: {
        title: `Miniescavatore operativo ${state.profile} ${RUN_ID}`,
        detail: `Miniescavatore operativo ${state.profile} ${RUN_ID}`,
        meta: "Attrezzatura trasportabile verificata E2E",
        status: "AVAILABLE",
        recordType: "asset-register",
        entityType: "equipment",
        usageMode: "OPERATIONAL",
        operationalProfile: "OPERATIONAL",
        transportCapabilities: [],
        brand: "Wacker Neuson",
        model: "E17",
        serialNumber: `E17-${state.profile}-${RUN_ID}`.toUpperCase(),
        ...(warehouseId ? { warehouseId } : {}),
        capacity: 1,
        weightKg: 1800,
        transportable: true,
        lifecycleStatus: "AVAILABLE",
        availabilityGuard: "ASSIGNABLE",
        idempotencyKey: `profile-cargo-create-${state.profile}-${RUN_ID}`,
      },
      expected: [201],
    });
    cargo = cargoResponse.payload.created;
    assert.match(cargo?.canonicalCode || "", /^(ATT|ASSET|ATTREZZATURE)-/i);
    assert.equal(cargo?.payload?.transportable, true);
  }

  const assignmentBody = {
    assetIds: [vehicle.id, ...(cargo ? [cargo.id] : [])],
    assigneeMembershipId: state.membership.id,
    assignmentKind: "LONG_TERM",
    startsAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    endsAt: null,
    purpose: "Affidamento operativo e trasporto E2E",
    notes: "Il mezzo resta vettore; l'attrezzatura conserva l'utilizzatore operativo.",
    idempotencyKey: `profile-asset-assignment-${state.profile}-${RUN_ID}`,
  };
  const assignment = await requestJson(state.actorId, "/api/assets/assignments", {
    method: "POST",
    body: assignmentBody,
    expected: [201],
  });
  assert.equal(assignment.payload.assetCount, cargo ? 2 : 1);
  assert(assignment.payload.assignments?.every((entry) => entry.status === "ACTIVE"));
  const replay = await requestJson(state.actorId, "/api/assets/assignments", {
    method: "POST",
    body: assignmentBody,
  });
  assert.equal(replay.payload.idempotent, true);
  const conflict = await requestJson(state.actorId, "/api/assets/assignments", {
    method: "POST",
    body: { ...assignmentBody, idempotencyKey: `profile-asset-conflict-${state.profile}-${RUN_ID}` },
    expected: [409],
  });
  assert.equal(conflict.payload.error, "asset_assignment_conflict");

  const window = futureWindow(dayOffset);
  const mode = withCargo ? "ASSET_TRANSFER" : state.profile === "FULL_OPERATIONS" ? "WAREHOUSE_TO_JOB" : "WAREHOUSE_TO_RECIPIENT";
  const resources = await requestJson(
    state.actorId,
    `/api/mission/resources?plannedAt=${encodeURIComponent(window.startsAt)}&plannedEndAt=${encodeURIComponent(window.endsAt)}&transportMode=${encodeURIComponent(mode)}`,
  );
  const driver = resources.payload.catalog?.drivers?.find((entry) => entry.actorId === state.actorId);
  const catalogVehicle = resources.payload.catalog?.vehicles?.find((entry) => entry.id === vehicle.id);
  const catalogCargo = cargo ? resources.payload.catalog?.cargoAssets?.find((entry) => entry.id === cargo.id) : null;
  assert(driver?.id, `${state.profile}: Authority driver resource missing`);
  assert(catalogVehicle, `${state.profile}: assigned vehicle missing from mission catalog`);
  assert(!resources.payload.catalog?.cargoAssets?.some((entry) => entry.id === vehicle.id), `${state.profile}: vehicle leaked into cargo catalog`);
  if (cargo) {
    assert(catalogCargo, `${state.profile}: operational cargo missing from mission catalog`);
    assert(!resources.payload.catalog?.vehicles?.some((entry) => entry.id === cargo.id), `${state.profile}: equipment leaked into vehicle catalog`);
  }
  state.vehicle = vehicle;
  state.cargo = cargo;
  state.driver = driver;
  state.missionWindow = window;
  return { vehicle, cargo, driver, window };
}

async function createCanonicalPlace(state, { entityType, entityId, name, address }) {
  const candidate = await geocode(state.actorId, address);
  const response = await requestJson(state.actorId, "/api/location/locations", {
    method: "POST",
    body: {
      entityType,
      entityId,
      provider: "GEOAPIFY",
      providerPlaceId: candidate.providerPlaceId,
      formattedAddress: candidate.formattedAddress,
      coordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
      address: {
        street: candidate.street,
        streetNumber: candidate.streetNumber,
        city: candidate.city,
        province: candidate.province,
        postalCode: candidate.postalCode,
        country: candidate.country,
      },
      confidence: candidate.confidence,
      verifiedByUser: true,
      radiusMeters: 100,
      name,
      idempotencyKey: `profile-location-${state.profile}-${entityId}-${RUN_ID}`.slice(0, 160),
    },
    expected: [201],
  });
  assert.equal(response.payload.location?.status, "ACTIVE");
  assert.equal(response.payload.geofence?.status, "ACTIVE");
  return { location: response.payload.location, geofence: response.payload.geofence, candidate };
}

async function configureTracker(state) {
  const providerResponse = await requestJson(state.actorId, "/api/location/devices", {
    method: "POST",
    body: { action: "provider", providerType: "NATIVE_DEVICE", label: `PWA nativa ${RUN_ID}` },
    expected: [201],
  });
  const provider = providerResponse.payload.provider;
  const deviceResponse = await requestJson(state.actorId, "/api/location/devices", {
    method: "POST",
    body: {
      action: "device",
      providerId: provider.id,
      externalDeviceId: `DEVICE-${state.profile}-${RUN_ID}`,
      label: `Telefono autista ${state.profile}`,
      deviceType: "MOBILE_GPS",
    },
    expected: [201],
  });
  const device = deviceResponse.payload.device;
  const bindingResponse = await requestJson(state.actorId, "/api/location/devices", {
    method: "POST",
    body: { action: "bind", vehicleId: state.vehicle.id, deviceId: device.id },
    expected: [201],
  });
  assert.equal(bindingResponse.payload.binding?.vehicleId, state.vehicle.id);
  state.trackingDevice = device;
  return device;
}

async function missionMutation(state, action, body = {}) {
  const response = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.missionJobId)}/journey`, {
    method: "POST",
    body: {
      action,
      recordId: state.mission.id,
      expectedVersion: state.mission.version,
      idempotencyKey: `profile-mission-${action}-${state.profile}-${RUN_ID}-${state.mission.version}`,
      ...body,
    },
  });
  state.mission = response.payload.mutation?.record;
  assert(state.mission?.id, `${state.profile}: ${action} readback missing`);
  return response;
}

async function ingestSample(state, coordinate, recordedAt, sequence) {
  return requestJson(state.actorId, "/api/location/samples", {
    method: "POST",
    body: {
      trackingSessionId: state.trackingSessionId,
      provider: "NATIVE_MOBILE_APP",
      recordedAt,
      coordinates: { latitude: coordinate.latitude, longitude: coordinate.longitude },
      accuracyM: 5,
      providerEventId: `${state.profile}-${RUN_ID}-sample-${sequence}`,
    },
    expected: [201],
  });
}

async function executeMission(state, { origin, destination }) {
  const attendancePath = `/api/operations/jobs/${encodeURIComponent(state.missionJobId)}/attendance`;
  const checkIn = await requestJson(state.actorId, attendancePath, {
    method: "POST",
    body: {
      action: "check_in",
      location: { lat: origin.latitude, lon: origin.longitude, accuracyM: 5 },
      clientObservedAt: new Date().toISOString(),
      idempotencyKey: `profile-driver-checkin-${state.profile}-${RUN_ID}`,
    },
    expected: [200, 201],
  });
  assert.equal(checkIn.payload.attendance?.payload?.operationalContext?.mode, "DRIVER");
  state.driverAttendance = checkIn.payload.attendance;
  state.trackingSessionId = checkIn.payload.attendance?.payload?.tracking?.sessionId;
  assert(state.trackingSessionId, `${state.profile}: driver check-in must open tracking`);

  await missionMutation(state, "mission_dispatch");
  const stops = state.mission.payload?.route?.stops || [];
  const pickupStop = stops.find((stop) => stop.kind === "PICKUP");
  const deliveryStop = stops.find((stop) => stop.kind === "DELIVERY");
  assert(pickupStop?.id && deliveryStop?.id, `${state.profile}: canonical route stops missing`);
  const missionCargoIds = Array.isArray(state.mission.payload?.cargoAssetIds) ? state.mission.payload.cargoAssetIds : [];

  const t0 = Date.now() - 15 * 60 * 1_000;
  await ingestSample(state, origin, new Date(t0).toISOString(), 1);
  const originConfirmed = await ingestSample(state, origin, new Date(t0 + 100_000).toISOString(), 2);
  assert(originConfirmed.payload.derivedEvents?.some((event) => event.eventType === "STOP_STARTED"), `${state.profile}: origin geofence did not attach the stop`);
  await missionMutation(state, "mission_load", {
    stopId: pickupStop.id,
    ...(missionCargoIds.length ? { assetIds: missionCargoIds } : {}),
    note: "Carico effettuato e verificato",
  });

  const outside = { latitude: origin.latitude + 0.01, longitude: origin.longitude + 0.01 };
  await ingestSample(state, outside, new Date(t0 + 110_000).toISOString(), 3);
  const originExit = await ingestSample(state, outside, new Date(t0 + 120_000).toISOString(), 4);
  assert(originExit.payload.derivedEvents?.some((event) => event.eventType === "STOP_ENDED"), `${state.profile}: origin departure was not confirmed`);
  await ingestSample(state, destination, new Date(t0 + 130_000).toISOString(), 5);
  const destinationConfirmed = await ingestSample(state, destination, new Date(t0 + 230_000).toISOString(), 6);
  assert(destinationConfirmed.payload.derivedEvents?.some((event) => event.eventType === "STOP_STARTED"), `${state.profile}: destination geofence did not attach the stop`);

  await missionMutation(state, "mission_unload", {
    stopId: deliveryStop.id,
    ...(missionCargoIds.length ? { assetIds: missionCargoIds } : {}),
    note: "Scarico effettuato e verificato",
  });
  await missionMutation(state, "mission_deliver", {
    stopId: deliveryStop.id,
    recipient: "Responsabile destinatario E2E",
    evidenceType: "AUTHORIZED_DRIVER_CONFIRMATION",
    evidenceReference: `POD-${state.profile}-${RUN_ID}`,
    ...(missionCargoIds.length ? { assetIds: missionCargoIds } : {}),
    note: "Consegna accettata senza riserve",
  });
  assert.equal(state.mission.status, "DELIVERED");
  await missionMutation(state, "mission_verify_pod");
  await missionMutation(state, "mission_reconcile", { note: "Quantità, custodia e prova di consegna riconciliate." });

  const checkOut = await requestJson(state.actorId, attendancePath, {
    method: "POST",
    body: {
      action: "check_out",
      expectedVersion: state.driverAttendance.version,
      location: { lat: destination.latitude, lon: destination.longitude, accuracyM: 5 },
      clientObservedAt: new Date().toISOString(),
      idempotencyKey: `profile-driver-checkout-${state.profile}-${RUN_ID}`,
    },
  });
  assert.equal(checkOut.payload.attendance?.status, "CHECKED_OUT");
  assert.equal(checkOut.payload.attendance?.payload?.tracking?.status, "CLOSED");

  await missionMutation(state, "mission_report_submit", {
    text: "Missione completata: carico, viaggio, scarico e consegna verificati. Nessuna anomalia; prova di consegna acquisita e registri riconciliati.",
  });
  assert.equal(state.mission.payload?.missionReport?.status, "SUBMITTED");
  await missionMutation(state, "mission_close");
  assert.equal(state.mission.status, "CLOSED");

  const register = await requestJson(state.actorId, "/api/mission/control");
  const stored = register.payload.missions?.find((entry) => entry.id === state.mission.id);
  assert.equal(stored?.status, "CLOSED");
  assert.equal(stored?.payload?.routeReadback?.status, "COMPLETED");
  const map = await requestJson(state.actorId, "/api/command/map");
  assert(!map.payload.activeSessions?.some((entry) => entry.missionId === state.mission.id), `${state.profile}: closed tracking leaked into Control live map`);
  return stored;
}

async function standaloneTransportFlow(state, { dayOffset, warehouseOrigin = false }) {
  await createTransportResources(state, { withCargo: !warehouseOrigin, dayOffset });
  await configureTracker(state);
  let originPlace;
  if (warehouseOrigin) {
    const locations = await requestJson(state.actorId, "/api/location/locations");
    const location = locations.payload.locations?.find((entry) => entry.entityType === "MAGAZZINO" && entry.entityId === state.warehouse.id);
    assert(location?.id, `${state.profile}: warehouse canonical location missing`);
    originPlace = {
      location,
      candidate: {
        formattedAddress: location.formattedAddress,
        latitude: location.coordinates.latitude,
        longitude: location.coordinates.longitude,
      },
    };
  } else {
    originPlace = await createCanonicalPlace(state, {
      entityType: "PUNTO_DI_CARICO",
      entityId: `ORIGIN-${state.profile}-${RUN_ID}`,
      name: "Punto di carico E2E",
      address: ADDRESS,
    });
  }
  const destinationPlace = await createCanonicalPlace(state, {
    entityType: "DESTINATARIO",
    entityId: `DEST-${state.profile}-${RUN_ID}`,
    name: "Destinatario E2E",
    address: "Viale Filippo Tommaso Marinetti, 00143 Roma RM, Italia",
  });
  const transportMode = warehouseOrigin ? "WAREHOUSE_TO_RECIPIENT" : "ASSET_TRANSFER";
  const missionBody = {
    action: "mission_create",
    title: `Missione ${transportMode} ${RUN_ID}`,
    pickup: originPlace.candidate.formattedAddress,
    dropoff: destinationPlace.candidate.formattedAddress,
    plannedAt: state.missionWindow.startsAt,
    plannedEndAt: state.missionWindow.endsAt,
    driverId: state.driver.id,
    vehicleId: state.vehicle.id,
    ...(state.cargo ? { cargoAssetIds: [state.cargo.id] } : {}),
    transportMode,
    originEntityId: warehouseOrigin ? state.warehouse.id : `ORIGIN-${state.profile}-${RUN_ID}`,
    originEntityType: warehouseOrigin ? "MAGAZZINO" : "PUNTO_DI_CARICO",
    destinationEntityId: `DEST-${state.profile}-${RUN_ID}`,
    destinationEntityType: "DESTINATARIO",
    routeStops: [
      {
        kind: "PICKUP",
        locationId: originPlace.location.id,
        label: originPlace.candidate.formattedAddress,
        cargoActions: state.cargo ? [{ action: "LOAD", assetId: state.cargo.id }] : [{ action: "LOAD", assetId: null }],
      },
      {
        kind: "DELIVERY",
        locationId: destinationPlace.location.id,
        label: destinationPlace.candidate.formattedAddress,
        cargoActions: state.cargo ? [{ action: "UNLOAD", assetId: state.cargo.id }] : [{ action: "UNLOAD", assetId: null }],
      },
    ],
    notes: "Missione autonoma verificata E2E",
    idempotencyKey: `profile-mission-create-${state.profile}-${RUN_ID}`,
  };
  const created = await requestJson(state.actorId, "/api/mission/control", {
    method: "POST",
    body: missionBody,
    expected: [201],
  });
  state.mission = created.payload.record;
  state.missionJobId = created.payload.jobId;
  assert.equal(state.mission.payload?.resourceSnapshot?.vehicle?.entityType, "VEHICLE");
  if (state.cargo) assert.equal(state.mission.payload?.resourceSnapshot?.cargoAsset?.id, state.cargo.id);
  const replay = await requestJson(state.actorId, "/api/mission/control", { method: "POST", body: missionBody });
  assert.equal(replay.payload.idempotent, true);

  return executeMission(state, {
    origin: { latitude: originPlace.candidate.latitude, longitude: originPlace.candidate.longitude },
    destination: { latitude: destinationPlace.candidate.latitude, longitude: destinationPlace.candidate.longitude },
  });
}

async function fullMaterialMissionFlow(state) {
  const materialRequest = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: {
      action: "material_request",
      title: "Richiesta materiali E2E",
      neededAt: state.missionWindow.startsAt,
      deliveryInstructions: "Consegnare nel cantiere ufficiale della commessa.",
      notes: "Richiesta generata dal flusso integrato",
      lines: [{ itemId: state.inventoryItem.id, quantity: 1 }],
      idempotencyKey: `profile-material-request-${state.profile}-${RUN_ID}`,
    },
    expected: [201],
  });
  let requestRecord = materialRequest.payload.mutation?.record;
  assert.equal(requestRecord?.status, "REQUESTED");
  assert.equal(requestRecord?.payload?.deliveryPointSource, "JOB_CANONICAL_LOCATION");

  const approved = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: {
      action: "material_review",
      recordId: requestRecord.id,
      expectedVersion: requestRecord.version,
      decision: "APPROVED",
      warehouseId: state.warehouse.id,
      lines: requestRecord.payload.lines,
      note: "Articolo, quantità e deposito verificati",
      idempotencyKey: `profile-material-review-${state.profile}-${RUN_ID}`,
    },
  });
  requestRecord = approved.payload.mutation?.record;
  assert.equal(requestRecord?.status, "APPROVED");
  assert.equal(requestRecord?.payload?.stockReservation?.status, "RESERVED");

  const missionBody = {
    action: "mission_create",
    title: `Consegna materiali commessa ${RUN_ID}`,
    pickup: state.warehouse.locationLabel,
    dropoff: state.jobCandidate.formattedAddress,
    plannedAt: state.missionWindow.startsAt,
    plannedEndAt: state.missionWindow.endsAt,
    driverId: state.driver.id,
    vehicleId: state.vehicle.id,
    cargoAssetIds: [],
    transportMode: "WAREHOUSE_TO_JOB",
    materialRequestId: requestRecord.id,
    notes: "Missione generata dalla richiesta approvata",
    idempotencyKey: `profile-material-mission-${state.profile}-${RUN_ID}`,
  };
  const missionCreated = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: missionBody,
    expected: [201],
  });
  state.mission = missionCreated.payload.mutation?.record;
  state.missionJobId = state.job.id;
  assert.equal(state.mission?.payload?.materialRequestId, requestRecord.id);
  assert.equal(state.mission?.payload?.resourceSnapshot?.vehicle?.id, state.vehicle.id);
  assert.equal(state.mission?.payload?.transportMode, "WAREHOUSE_TO_JOB");
  const missionReplay = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}/journey`, {
    method: "POST",
    body: missionBody,
  });
  assert.equal(missionReplay.payload.mutation?.idempotent, true);

  const inventoryBeforePick = await requestJson(state.actorId, `/api/warehouse/inventory?warehouseId=${encodeURIComponent(state.warehouse.id)}&itemId=${encodeURIComponent(state.inventoryItem.id)}`);
  const reservedItem = inventoryBeforePick.payload.items?.find((entry) => entry.id === state.inventoryItem.id);
  assert.equal(reservedItem?.reserved, 1);
  const pick = await requestJson(state.actorId, "/api/warehouse/inventory", {
    method: "POST",
    body: {
      action: "pick",
      warehouseId: state.warehouse.id,
      itemId: state.inventoryItem.id,
      expectedVersion: reservedItem.version,
      quantity: 1,
      jobId: state.job.id,
      missionId: state.mission.id,
      note: "Prelievo fisico per carico missione E2E",
      idempotencyKey: `profile-material-pick-${state.profile}-${RUN_ID}`,
    },
  });
  assert.equal(pick.payload.movement?.movementType, "PICK");
  assert.equal(pick.payload.items?.[0]?.onHand, 24);
  assert.equal(pick.payload.items?.[0]?.reserved, 0);

  await executeMission(state, {
    origin: {
      latitude: state.warehouse.coordinates.latitude,
      longitude: state.warehouse.coordinates.longitude,
    },
    destination: {
      latitude: state.jobCandidate.latitude,
      longitude: state.jobCandidate.longitude,
    },
  });

  const inventory = await requestJson(state.actorId, `/api/warehouse/inventory?warehouseId=${encodeURIComponent(state.warehouse.id)}&itemId=${encodeURIComponent(state.inventoryItem.id)}`);
  const item = inventory.payload.items?.find((entry) => entry.id === state.inventoryItem.id);
  assert.equal(item?.onHand, 24, "FULL_OPERATIONS: loading must pick one physical unit from stock");
  assert.equal(item?.reserved, 0, "FULL_OPERATIONS: delivered reservation must be reconciled");
  assert(inventory.payload.movements?.some((entry) => entry.movementType === "PICK" && entry.missionId === state.mission.id));

  const requests = await requestJson(state.actorId, "/api/warehouse/requests");
  const storedRequest = requests.payload.requests?.find((entry) => entry.id === requestRecord.id);
  assert.equal(storedRequest?.payload?.missionId, state.mission.id);
  assert.equal(storedRequest?.mission?.id, state.mission.id);
  assert.equal(storedRequest?.payload?.stockReservation?.status, "RESERVED");
}

async function fullOperationsFlow(state) {
  await registerInventory(state);
  await createTransportResources(state, { withCargo: true, dayOffset: 30 });
  await configureTracker(state);
  await completeOperationsFlow(state, {
    planningDay: 29,
    beforeFinalization: fullMaterialMissionFlow,
  });

  const jobReadback = await requestJson(state.actorId, `/api/operations/jobs/${encodeURIComponent(state.job.id)}`);
  assert.equal(jobReadback.payload.job?.payload?.statusCode, "CLOSED");
  assert.equal(jobReadback.payload.workspace?.rapportino?.status, "SUBMITTED");
  assert(jobReadback.payload.workspace?.sections?.materials?.records?.length > 0, "FULL_OPERATIONS: commessa dossier must read material records server-side");
  assert(jobReadback.payload.workspace?.sections?.planning?.records?.length > 0, "FULL_OPERATIONS: commessa dossier must read planning records server-side");
}

const states = [];
for (const profile of profiles) {
  process.stdout.write(`SETUP ${profile} ... `);
  const state = await provisionProfile(profile);
  await assertDomainBoundaries(state);
  if (profile === "OPERATIONS") await completeOperationsFlow(state, { planningDay: 1 });
  if (profile === "WAREHOUSE") await warehouseOnlyFlow(state);
  if (profile === "TRANSPORT") await standaloneTransportFlow(state, { dayOffset: 10 });
  if (profile === "WAREHOUSE_TRANSPORT") {
    await registerInventory(state);
    await standaloneTransportFlow(state, { dayOffset: 20, warehouseOrigin: true });
  }
  if (profile === "FULL_OPERATIONS") await fullOperationsFlow(state);
  states.push(state);
  console.log("PASS");
}

console.log(`PASS operating-profile boundary matrix ${RUN_ID}`);
for (const state of states) {
  console.log(`${state.profile}: tenant=${state.actorId}${state.warehouse ? ` warehouse=${state.warehouse.code}` : ""}`);
}
