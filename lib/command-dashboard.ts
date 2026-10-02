export const COMMAND_WIDGET_SCHEMA_VERSION = 1;

export const COMMAND_WIDGET_SIZES = ["compact", "standard", "wide", "full"] as const;

export type CommandWidgetSize = (typeof COMMAND_WIDGET_SIZES)[number];

export const COMMAND_WIDGET_CATALOG = [
  {
    id: "kpi-jobs",
    label: "Lavori attivi",
    description: "Volume e stato delle commesse operative.",
    requiredCapabilities: ["operations.read"],
    allowedSizes: ["compact", "standard"],
    defaultSize: "compact",
  },
  {
    id: "kpi-assets",
    label: "Asset operativi",
    description: "Disponibilita e stato del parco asset.",
    requiredCapabilities: ["asset.read"],
    allowedSizes: ["compact", "standard"],
    defaultSize: "compact",
  },
  {
    id: "kpi-workforce",
    label: "Team e workforce",
    description: "Readback delle risorse autorizzate.",
    requiredCapabilities: ["workforce.read"],
    allowedSizes: ["compact", "standard"],
    defaultSize: "compact",
  },
  {
    id: "kpi-progress",
    label: "Avanzamento medio",
    description: "Progressione aggregata dei lavori visibili.",
    requiredCapabilities: ["operations.read"],
    allowedSizes: ["compact", "standard"],
    defaultSize: "compact",
  },
  {
    id: "operational-map",
    label: "Mappa operativa",
    description: "Vista territoriale di lavori, team e asset autorizzati.",
    requiredCapabilities: ["operations.read"],
    allowedSizes: ["wide", "full"],
    defaultSize: "wide",
  },
  {
    id: "company-ai",
    label: "Company AI",
    description: "Assistente governato e command ledger.",
    requiredCapabilities: ["command.read"],
    allowedSizes: ["standard", "wide", "full"],
    defaultSize: "standard",
  },
  {
    id: "activity-stream",
    label: "Attivita recenti",
    description: "Timeline dei record operativi consentiti.",
    requiredCapabilities: ["command.read"],
    allowedSizes: ["standard", "wide"],
    defaultSize: "standard",
  },
  {
    id: "jobs",
    label: "Lavori",
    description: "Lista sintetica delle commesse accessibili.",
    requiredCapabilities: ["operations.read"],
    allowedSizes: ["standard", "wide", "full"],
    defaultSize: "standard",
  },
  {
    id: "assets",
    label: "Asset",
    description: "Stato operativo e manutentivo degli asset visibili.",
    requiredCapabilities: ["asset.read"],
    allowedSizes: ["standard", "wide", "full"],
    defaultSize: "standard",
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Indicatori e insight derivati dai dati autorizzati.",
    requiredCapabilities: ["analytics.read"],
    allowedSizes: ["standard", "wide", "full"],
    defaultSize: "wide",
  },
  {
    id: "command-readiness",
    label: "Command readiness",
    description: "Stato del control plane e dei relativi adapter.",
    requiredCapabilities: ["command.read"],
    allowedSizes: ["standard", "wide"],
    defaultSize: "standard",
  },
] as const;

export type CommandWidgetDefinition = (typeof COMMAND_WIDGET_CATALOG)[number];
export type CommandWidgetId = CommandWidgetDefinition["id"];

export type CommandWidgetLayoutItem = {
  id: CommandWidgetId;
  size: CommandWidgetSize;
  visible: boolean;
};

export type CommandWidgetPublicDefinition = {
  id: CommandWidgetId;
  label: string;
  description: string;
  allowedSizes: CommandWidgetSize[];
  defaultSize: CommandWidgetSize;
};

export type CommandSurfaceAccess = {
  role: string;
  canCustomize: boolean;
  allowedNavigation: CommandNavigationId[];
  widgetCatalog: CommandWidgetPublicDefinition[];
  defaultLayout: CommandWidgetLayoutItem[];
};

export const COMMAND_NAVIGATION = [
  { id: "command", path: "/", requiredCapability: "command.read" },
  { id: "operations", path: "/operations", requiredCapability: "operations.read" },
  { id: "workforce", path: "/workforce", requiredCapability: "workforce.read" },
  { id: "finance", path: "/finance", requiredCapability: "finance.read" },
  { id: "procurement", path: "/procurement", requiredCapability: "procurement.read" },
  { id: "assets", path: "/assets", requiredCapability: "asset.read" },
  { id: "warehouse", path: "/warehouse", requiredCapability: "warehouse.read" },
  { id: "mission", path: "/mission", requiredCapability: "mission.read" },
  { id: "documents", path: "/documents", requiredCapability: "documents.read" },
  { id: "governance", path: "/governance", requiredCapability: "governance.read" },
  { id: "communications", path: "/communications", requiredCapability: "communication.read" },
  { id: "externals", path: "/externals", requiredCapability: "external_adapters.read" },
  { id: "authority", path: "/onboarding", requiredCapability: "authority.read" },
  { id: "events", path: "/events", requiredCapability: "events.read" },
  { id: "pwa", path: "/pwa/diagnostics", requiredCapability: "command.read" },
  { id: "settings", path: "/settings", requiredCapability: "settings.read" },
] as const;

export type CommandNavigationId = (typeof COMMAND_NAVIGATION)[number]["id"];

function hasAllCapabilities(capabilities: readonly string[], required: readonly string[]) {
  return required.every((capability) => capabilities.includes(capability));
}

export function getAllowedCommandWidgets(capabilities: readonly string[]) {
  return COMMAND_WIDGET_CATALOG.filter((widget) =>
    hasAllCapabilities(capabilities, widget.requiredCapabilities),
  );
}

export function getAllowedCommandNavigation(capabilities: readonly string[]) {
  return COMMAND_NAVIGATION.filter((item) => capabilities.includes(item.requiredCapability));
}

export function defaultCommandWidgetLayout(
  capabilities: readonly string[],
): CommandWidgetLayoutItem[] {
  return getAllowedCommandWidgets(capabilities).map((widget) => ({
    id: widget.id,
    size: widget.defaultSize,
    visible: true,
  }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeCommandWidgetLayout(
  input: unknown,
  capabilities: readonly string[],
): CommandWidgetLayoutItem[] {
  const allowed = getAllowedCommandWidgets(capabilities);
  const allowedById = new Map(allowed.map((widget) => [widget.id, widget]));
  const result: CommandWidgetLayoutItem[] = [];
  const seen = new Set<CommandWidgetId>();

  if (Array.isArray(input)) {
    for (const rawItem of input.slice(0, COMMAND_WIDGET_CATALOG.length)) {
      if (!isObject(rawItem) || typeof rawItem.id !== "string") continue;
      const widget = allowedById.get(rawItem.id as CommandWidgetId);
      if (!widget || seen.has(widget.id)) continue;

      const requestedSize = typeof rawItem.size === "string" ? rawItem.size : "";
      const size = widget.allowedSizes.includes(requestedSize as never)
        ? requestedSize as CommandWidgetSize
        : widget.defaultSize;

      result.push({
        id: widget.id,
        size,
        visible: typeof rawItem.visible === "boolean" ? rawItem.visible : true,
      });
      seen.add(widget.id);
    }
  }

  for (const widget of allowed) {
    if (seen.has(widget.id)) continue;
    result.push({ id: widget.id, size: widget.defaultSize, visible: true });
  }

  return result;
}

export function publicCommandWidgetCatalog(
  capabilities: readonly string[],
): CommandWidgetPublicDefinition[] {
  return getAllowedCommandWidgets(capabilities).map((widget) => ({
    id: widget.id,
    label: widget.label,
    description: widget.description,
    allowedSizes: [...widget.allowedSizes],
    defaultSize: widget.defaultSize,
  }));
}

export function firstAuthorizedPath(capabilities: readonly string[]) {
  return getAllowedCommandNavigation(capabilities)[0]?.path ?? "/access-denied";
}

export function commandSurfaceAccess(
  role: string,
  capabilities: readonly string[],
): CommandSurfaceAccess {
  return {
    role,
    canCustomize: capabilities.includes("command.customize"),
    allowedNavigation: getAllowedCommandNavigation(capabilities).map((item) => item.id),
    widgetCatalog: publicCommandWidgetCatalog(capabilities),
    defaultLayout: defaultCommandWidgetLayout(capabilities),
  };
}
