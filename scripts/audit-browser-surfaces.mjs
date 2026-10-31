import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = (process.env.ZEROW_RUNTIME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const chromiumPath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const outputPath = process.env.ZEROW_BROWSER_AUDIT_OUTPUT || "";
const screenshotDirectory = process.env.ZEROW_BROWSER_SCREENSHOT_DIR || "";
const requestedProfiles = new Set((process.env.ZEROW_BROWSER_PROFILES || "").split(",").map((value) => value.trim()).filter(Boolean));
const requestedRoutes = new Set((process.env.ZEROW_BROWSER_ROUTES || "").split(",").map((value) => value.trim()).filter(Boolean));
const includeWarehouseProfile = process.env.ZEROW_INCLUDE_WAREHOUSE_PROFILE === "1";
const verifyCreationDialogs = process.env.ZEROW_VERIFY_CREATION_DIALOGS === "1";

const ownerRoutes = [
  "/", "/command", "/onboarding", "/operations", "/workforce", "/planning", "/presenze",
  "/assets", "/warehouse", "/mission", "/documents", "/documents/scan", "/finance", "/procurement",
  "/events", "/governance", "/communications", "/ai", "/externals", "/pwa/diagnostics",
  "/governance/security", "/release", "/settings", "/qr", "/tenants",
];

const operationalRoutes = [
  "/", "/operations", "/workforce", "/presenze", "/warehouse", "/mission", "/documents",
  "/communications", "/ai", "/pwa/diagnostics", "/settings", "/qr",
];

const profiles = [
  {
    id: "owner-desktop",
    actorId: "e2e-owner",
    email: "e2e-owner@example.invalid",
    name: "E2E Owner",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    routes: ownerRoutes,
  },
  {
    id: "owner-mobile",
    actorId: "e2e-owner",
    email: "e2e-owner@example.invalid",
    name: "E2E Owner",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    routes: ownerRoutes,
  },
  {
    id: "worker-mobile",
    actorId: "e2e-worker",
    email: "e2e-worker@example.invalid",
    name: "Operatore E2E",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    routes: operationalRoutes,
  },
  {
    id: "delivery-driver-mobile",
    actorId: "e2e-driver",
    email: "e2e-driver@example.invalid",
    name: "Autista Consegna E2E",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    routes: operationalRoutes,
  },
  ...(includeWarehouseProfile ? [{
    id: "warehouse-mobile",
    actorId: process.env.ZEROW_WAREHOUSE_ACTOR_ID || "e2e-reviewer",
    email: process.env.ZEROW_WAREHOUSE_ACTOR_EMAIL || "e2e-reviewer@example.invalid",
    name: process.env.ZEROW_WAREHOUSE_ACTOR_NAME || "Magazziniere E2E",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    routes: operationalRoutes,
  }] : []),
].filter((profile) => requestedProfiles.size === 0 || requestedProfiles.has(profile.id));

const terminologyRules = [
  { id: "legacy-brand", pattern: /\bGEXY\b/i },
  { id: "legacy-map-provider", pattern: /\bMAPBOX\b/i },
  { id: "wrong-warehouse-role", pattern: /responsabile\s+magazziniere/i },
  { id: "ambiguous-asset-name", pattern: /\basset\s+(?:1\s*[\/,]\s*2\s*[\/,]\s*3|[123])\b/i },
  { id: "internal-owner-role", pattern: /(?:RUOLO|PERIMETRO|POLICY)\s*\/\s*OWNER|contesto\s+owner|(?:^|[\s·])owner\s*·\s*(?:tenant|Sites|contesto)|Owner verificato|L[’']Owner|all[’']owner|owner\s+only/i },
  { id: "legacy-surface-label", pattern: /\bsuperficie\b/i },
];

const expectedNavigation = {
  "owner-desktop": { profile: "control", labels: ["Home", "Mappa", "AI", "Commesse", "Altro"], visible: false, links: [] },
  "owner-mobile": { profile: "control", labels: ["Home", "Mappa", "AI", "Commesse", "Altro"], visible: true, links: [["Home", "/command"], ["Mappa", "/command#operational-map"], ["AI", "/command#company-ai"], ["Commesse", "/operations"]] },
  "worker-mobile": { profile: "field", labels: ["Home", "Comunicazioni", "AI", "Presenze", "Impostazioni"], visible: true, links: [["Home", "/"], ["Comunicazioni", "/communications"], ["AI", "/ai"], ["Presenze", "/presenze"], ["Impostazioni", "/settings"]] },
  "delivery-driver-mobile": { profile: "driver", labels: ["Home", "Comunicazioni", "AI", "Presenze", "Impostazioni"], visible: true, links: [["Home", "/"], ["Comunicazioni", "/communications"], ["AI", "/ai"], ["Presenze", "/presenze"], ["Impostazioni", "/settings"]] },
  "warehouse-mobile": { profile: "warehouse", labels: ["Home", "Comunicazioni", "AI", "Magazzino", "Impostazioni"], visible: true, links: [["Home", "/"], ["Comunicazioni", "/communications"], ["AI", "/ai"], ["Magazzino", "/warehouse"], ["Impostazioni", "/settings"]] },
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Chromium DevTools timeout: ${stderr.slice(-1000)}`)), 15_000);
    const onData = (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      resolve(match[1]);
    };
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chromium exited before DevTools was ready (${code}): ${stderr.slice(-1000)}`));
    });
  });
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "zerow-browser-audit-"));
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const chromium = spawn(chromiumPath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--remote-debugging-port=0",
  `--user-data-dir=${userDataDirectory}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let cdp;
try {
  const browserWebSocketUrl = await waitForDevTools(chromium);
  cdp = new CdpConnection(browserWebSocketUrl);
  await cdp.open();

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await Promise.all([
    cdp.send("Page.enable", {}, sessionId),
    cdp.send("Runtime.enable", {}, sessionId),
    cdp.send("Network.enable", {}, sessionId),
    cdp.send("Log.enable", {}, sessionId),
  ]);

  const errors = [];
  const requests = new Map();
  const networkIssues = [];
  let currentCase = null;
  cdp.on("Runtime.exceptionThrown", (event) => errors.push({ type: "exception", detail: event.exceptionDetails?.text || "runtime exception" }));
  cdp.on("Runtime.consoleAPICalled", (event) => {
    if (event.type !== "error" && event.type !== "assert") return;
    errors.push({ type: `console.${event.type}`, detail: event.args?.map((item) => item.value || item.description).filter(Boolean).join(" ") || "console error" });
  });
  cdp.on("Log.entryAdded", (event) => {
    if (event.entry?.level !== "error") return;
    if (/^Failed to load resource:/i.test(event.entry.text)) return;
    errors.push({ type: "log.error", detail: event.entry.text });
  });
  cdp.on("Network.requestWillBeSent", (event) => {
    if (!currentCase) return;
    requests.set(event.requestId, {
      profile: currentCase.profile,
      route: currentCase.route,
      method: event.request?.method || "GET",
      url: event.request?.url || "",
      documentUrl: event.documentURL || "",
      initiator: event.initiator?.stack?.callFrames?.[0]?.url || event.initiator?.type || "unknown",
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    if ((event.response?.status || 0) < 400) return;
    const request = requests.get(event.requestId);
    if (!request) return;
    networkIssues.push({
      ...request,
      type: "http",
      status: event.response.status,
      url: event.response.url || request.url || "",
    });
  });
  cdp.on("Network.loadingFailed", (event) => {
    if (event.canceled || /ERR_ABORTED/i.test(event.errorText || "")) return;
    const request = requests.get(event.requestId);
    if (!request) return;
    networkIssues.push({
      ...request,
      type: "network",
      detail: event.errorText || "Caricamento non riuscito",
    });
  });

  const results = [];
  const navigationInteractions = [];
  const creationFormInteractions = [];
  for (const profile of profiles) {
    currentCase = null;
    await cdp.send("Page.navigate", { url: "about:blank" }, sessionId);
    await delay(250);
    await cdp.send("Network.setExtraHTTPHeaders", {
      headers: {
        "oai-authenticated-user-id": profile.actorId,
        "oai-authenticated-user-email": profile.email,
        "oai-authenticated-user-full-name": encodeURIComponent(profile.name),
        "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      },
    }, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", profile.viewport, sessionId);

    for (const route of profile.routes.filter((value) => requestedRoutes.size === 0 || requestedRoutes.has(value))) {
      currentCase = { profile: profile.id, route };
      const errorStart = errors.length;
      await cdp.send("Page.navigate", { url: `${baseUrl}${route}` }, sessionId);
      const deadline = Date.now() + 15_000;
      let snapshot;
      while (Date.now() < deadline) {
        await delay(250);
        const evaluation = await cdp.send("Runtime.evaluate", {
          expression: `(() => ({
            ready: document.readyState,
            title: document.title,
            href: location.href,
            text: document.body?.innerText || "",
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollHeight: document.documentElement.scrollHeight,
            unavailable: (document.body?.innerText || "").includes("Questa sezione non è disponibile")
              || (document.body?.innerText || "").includes("Questa superficie non è disponibile"),
            accessDenied: (document.body?.innerText || "").includes("Accesso non autorizzato")
              || (document.body?.innerText || "").includes("ACCESSO NEGATO"),
            commercialShell: document.body?.classList.contains("zw-commercial-shell") || false,
            navigation: (() => {
              const rails = [...document.querySelectorAll(".zw-mobile-nav--global")];
              const rail = rails[0];
              return {
                count: rails.length,
                profile: rail?.getAttribute("data-navigation-profile") || "",
                source: rail?.getAttribute("data-navigation-source") || "",
                visible: rail ? getComputedStyle(rail).display !== "none" && rail.getBoundingClientRect().height > 0 : false,
                labels: rail ? [...rail.querySelectorAll(".zw-mobile-nav__label")].map((element) => (element.textContent || "").trim()) : [],
                hrefs: rail ? [...rail.querySelectorAll("a")].map((element) => element.getAttribute("href") || "") : [],
                active: rail ? [...rail.querySelectorAll('[aria-current="page"]')].map((element) => element.getAttribute("aria-label") || "") : [],
              };
            })(),
            visualContract: (() => {
              const topbar = document.querySelector(".zw-command-topbar");
              const card = document.querySelector(".carbon-card, .carbon-card-neon");
              return {
                topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
                cardRadius: card ? getComputedStyle(card).borderRadius : null,
                background: getComputedStyle(document.body).backgroundColor,
              };
            })(),
            overflowElements: [...document.querySelectorAll("body *")].flatMap((element) => {
              const rect = element.getBoundingClientRect();
              const viewportWidth = document.documentElement.clientWidth;
              const overflow = rect.right > viewportWidth && rect.left < viewportWidth
                ? rect.right - viewportWidth
                : rect.left < 0 && rect.right > 0 ? -rect.left : 0;
              if (overflow <= 2 || rect.width <= 0 || rect.height <= 0) return [];
              return [{
                tag: element.tagName.toLowerCase(),
                className: typeof element.className === "string" ? element.className.slice(0, 240) : "",
                text: (element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160),
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
                width: Math.round(rect.width * 10) / 10,
                overflow: Math.round(overflow * 10) / 10,
              }];
            }).sort((left, right) => right.overflow - left.overflow).slice(0, 12),
          }))()`,
          returnByValue: true,
        }, sessionId);
        snapshot = evaluation.result?.value;
        if (snapshot?.ready === "complete" && snapshot.text.trim().length > 0) break;
      }
      await delay(400);
      const finalEvaluation = await cdp.send("Runtime.evaluate", {
        expression: `(() => ({
          ready: document.readyState,
          title: document.title,
          href: location.href,
          text: document.body?.innerText || "",
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          unavailable: (document.body?.innerText || "").includes("Questa sezione non è disponibile")
            || (document.body?.innerText || "").includes("Questa superficie non è disponibile"),
          accessDenied: (document.body?.innerText || "").includes("Accesso non autorizzato")
            || (document.body?.innerText || "").includes("ACCESSO NEGATO"),
          commercialShell: document.body?.classList.contains("zw-commercial-shell") || false,
          navigation: (() => {
            const rails = [...document.querySelectorAll(".zw-mobile-nav--global")];
            const rail = rails[0];
            return {
              count: rails.length,
              profile: rail?.getAttribute("data-navigation-profile") || "",
              source: rail?.getAttribute("data-navigation-source") || "",
              visible: rail ? getComputedStyle(rail).display !== "none" && rail.getBoundingClientRect().height > 0 : false,
              labels: rail ? [...rail.querySelectorAll(".zw-mobile-nav__label")].map((element) => (element.textContent || "").trim()) : [],
              hrefs: rail ? [...rail.querySelectorAll("a")].map((element) => element.getAttribute("href") || "") : [],
              active: rail ? [...rail.querySelectorAll('[aria-current="page"]')].map((element) => element.getAttribute("aria-label") || "") : [],
            };
          })(),
          visualContract: (() => {
            const topbar = document.querySelector(".zw-command-topbar");
            const card = document.querySelector(".carbon-card, .carbon-card-neon");
            return {
              topbarHeight: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
              cardRadius: card ? getComputedStyle(card).borderRadius : null,
              background: getComputedStyle(document.body).backgroundColor,
            };
          })(),
          overflowElements: [...document.querySelectorAll("body *")].flatMap((element) => {
            const rect = element.getBoundingClientRect();
            const viewportWidth = document.documentElement.clientWidth;
            const overflow = rect.right > viewportWidth && rect.left < viewportWidth
              ? rect.right - viewportWidth
              : rect.left < 0 && rect.right > 0 ? -rect.left : 0;
            if (overflow <= 2 || rect.width <= 0 || rect.height <= 0) return [];
            return [{
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className.slice(0, 240) : "",
              text: (element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160),
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              overflow: Math.round(overflow * 10) / 10,
            }];
          }).sort((left, right) => right.overflow - left.overflow).slice(0, 12),
        }))()`,
        returnByValue: true,
      }, sessionId);
      snapshot = finalEvaluation.result?.value || snapshot;
      const hitTargetEvaluation = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const rail = document.querySelector(".zw-mobile-nav--global");
          const mobileHeader = document.querySelector(".zw-mobile-shell-header");
          const visible = (element) => Boolean(element)
            && getComputedStyle(element).display !== "none"
            && getComputedStyle(element).visibility !== "hidden"
            && element.getBoundingClientRect().height > 0;
          return {
            mobileHeader: {
              count: document.querySelectorAll(".zw-mobile-shell-header").length,
              visible: visible(mobileHeader),
            },
            visibleLocalTopbars: [...document.querySelectorAll(".zw-command-topbar, .zw-module-local-header")]
              .filter((element) => visible(element)).length,
            hitTargets: rail ? [...rail.querySelectorAll(".zw-mobile-nav__item")].map((element) => {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return {
                label: element.getAttribute("aria-label") || "",
                reachable: Boolean(hit && (hit === element || element.contains(hit))),
                pointerEvents: getComputedStyle(element).pointerEvents,
              };
            }) : [],
          };
        })()`,
        returnByValue: true,
      }, sessionId);
      snapshot.shellContract = hitTargetEvaluation.result?.value || null;
      let screenshot = null;
      if (screenshotDirectory) {
        const routeLabel = route === "/" ? "home" : route.replace(/^\//, "").replaceAll(/[^a-z0-9]+/gi, "-").replace(/-$/, "");
        screenshot = path.join(screenshotDirectory, `${profile.id}-${routeLabel || "root"}.png`);
        const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
        await writeFile(screenshot, Buffer.from(capture.data, "base64"));
      }
      results.push({
        profile: profile.id,
        route,
        ...snapshot,
        screenshot,
        horizontalOverflow: Math.max(0, (snapshot?.scrollWidth || 0) - (snapshot?.clientWidth || 0)),
        errors: errors.slice(errorStart),
      });

      if (profile.id === "owner-mobile" && route === "/command") {
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('[data-navigation-action="open-module-menu"]')?.click()`,
        }, sessionId);
        await delay(350);
        const menuEvaluation = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const sidebar = document.querySelector(".zw-global-workspace-sidebar");
            const rect = sidebar?.getBoundingClientRect();
            const open = Boolean(sidebar && rect && rect.right > 0 && rect.left <= 1 && getComputedStyle(sidebar).display !== "none");
            sidebar?.querySelector('button[aria-label="Chiudi menu"]')?.click();
            return { open };
          })()`,
          returnByValue: true,
        }, sessionId);
        navigationInteractions.push({
          profile: profile.id,
          route,
          action: "open-module-menu",
          passed: menuEvaluation.result?.value?.open === true,
        });
      }
      if (verifyCreationDialogs && profile.id === "owner-mobile" && ["/onboarding", "/assets", "/mission"].includes(route)) {
        const buttonLabel = route === "/onboarding" ? "Nuovo magazzino" : route === "/assets" ? "Nuovo asset" : "Nuova missione";
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 600, deviceScaleFactor: 1, mobile: true }, sessionId);
        let openEvaluation = { result: { value: false } };
        const formReadyDeadline = Date.now() + 12_000;
        while (Date.now() < formReadyDeadline && openEvaluation.result?.value !== true) {
          openEvaluation = await cdp.send("Runtime.evaluate", {
            expression: `(() => {
              const button = [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim().includes(${JSON.stringify(buttonLabel)}));
              if (!button || button.disabled) return false;
              button.click();
              return true;
            })()`,
            returnByValue: true,
          }, sessionId);
          if (openEvaluation.result?.value !== true) await delay(250);
        }
        await delay(650);

        let initialAssetUsageOptions = [];
        if (route === "/assets") {
          const initialEvaluation = await cdp.send("Runtime.evaluate", {
            expression: `(() => [...(document.querySelector('select[aria-label="Profilo di utilizzo asset"]')?.options || [])].map((option) => option.value))()`,
            returnByValue: true,
          }, sessionId);
          initialAssetUsageOptions = initialEvaluation.result?.value ?? [];
          await cdp.send("Runtime.evaluate", {
            expression: `(() => {
              const select = document.querySelector('select[aria-label="Tipologia asset"]');
              if (!select) return false;
              select.value = "vehicle";
              select.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            })()`,
            returnByValue: true,
          }, sessionId);
          await delay(250);
        }

        const dialogEvaluation = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const dialog = document.querySelector('[data-slot="dialog-content"][data-state="open"]');
            if (!dialog) return { open: false };
            const style = getComputedStyle(dialog);
            const rect = dialog.getBoundingClientRect();
            const before = dialog.scrollTop;
            dialog.scrollTop = dialog.scrollHeight;
            const after = dialog.scrollTop;
            const text = dialog.textContent || "";
            const common = {
              open: true,
              title: dialog.querySelector('[data-slot="dialog-title"]')?.textContent?.trim() || "",
              overflowY: style.overflowY,
              touchAction: style.touchAction,
              clientHeight: dialog.clientHeight,
              scrollHeight: dialog.scrollHeight,
              scrollMoved: dialog.scrollHeight <= dialog.clientHeight + 1 || after > before,
              fitsViewport: rect.top >= -1 && rect.bottom <= innerHeight + 1,
              horizontalOverflow: Math.max(0, dialog.scrollWidth - dialog.clientWidth),
              closePresent: Boolean(dialog.querySelector('[data-slot="dialog-close"]')),
            };
            if (${JSON.stringify(route)} === "/onboarding") return {
              ...common,
              hasName: Boolean(dialog.querySelector('#warehouse-name')),
              hasServerLocation: Boolean(dialog.querySelector('#warehouse-location')) && text.includes("Riconosci luogo"),
              hasRadius: Boolean(dialog.querySelector('#warehouse-radius')),
              serverCopy: text.includes("server-side") && text.includes("registro scorte"),
            };
            if (${JSON.stringify(route)} === "/assets") return {
              ...common,
              hasWarehouseCatalog: (dialog.querySelector('select[aria-label="Ubicazione fisica asset"]')?.options.length || 0) >= 2,
              freeTextLocationRemoved: !text.includes("Sede / ubicazione"),
              initialUsageOptions: ${JSON.stringify(initialAssetUsageOptions)},
              vehicleUsageOptions: [...(dialog.querySelector('select[aria-label="Profilo di utilizzo asset"]')?.options || [])].map((option) => option.value),
              hasPayloadField: Boolean(dialog.querySelector('input[placeholder="Es. 3500"]')),
            };
            return {
              ...common,
              hasJobBinding: Boolean(dialog.querySelector('select[aria-label="Commessa o trasporto autonomo"]')),
              hasTransportMode: Boolean(dialog.querySelector('select[aria-label="Modalità trasporto"]')),
              hasCanonicalStops: Boolean(dialog.querySelector('select[aria-label="Location canonica tappa 1"]')) && Boolean(dialog.querySelector('select[aria-label="Location canonica tappa 2"]')),
              hasServerResources: Boolean(dialog.querySelector('select[aria-label="Autista reale"]')) && Boolean(dialog.querySelector('select[aria-label="Mezzo di trasporto"]')),
              hasReadbackAction: text.includes("Crea e rileggi"),
            };
          })()`,
          returnByValue: true,
        }, sessionId);
        const dialog = dialogEvaluation.result?.value ?? { open: false };
        const commonPassed = openEvaluation.result?.value === true
          && dialog.open === true
          && ["auto", "scroll"].includes(dialog.overflowY)
          && ["pan-y", "auto"].includes(dialog.touchAction)
          && dialog.scrollMoved === true
          && dialog.fitsViewport === true
          && dialog.horizontalOverflow <= 2
          && dialog.closePresent === true;
        const formPassed = route === "/onboarding"
          ? dialog.title === "Configura un magazzino" && dialog.hasName && dialog.hasServerLocation && dialog.hasRadius && dialog.serverCopy
          : route === "/assets"
            ? dialog.title === "Registra asset" && dialog.hasWarehouseCatalog && dialog.freeTextLocationRemoved
              && JSON.stringify(dialog.initialUsageOptions) === JSON.stringify(["OPERATIONAL"])
              && JSON.stringify(dialog.vehicleUsageOptions) === JSON.stringify(["OPERATIONAL", "TRANSPORT", "DUAL_USE"])
              && dialog.hasPayloadField
            : dialog.title === "Nuova missione" && dialog.hasJobBinding && dialog.hasTransportMode && dialog.hasCanonicalStops && dialog.hasServerResources && dialog.hasReadbackAction;
        creationFormInteractions.push({ profile: profile.id, route, buttonLabel, ...dialog, passed: commonPassed && formPassed });
        await cdp.send("Runtime.evaluate", { expression: `document.querySelector('[data-slot="dialog-content"][data-state="open"] [data-slot="dialog-close"]')?.click()` }, sessionId);
        await delay(150);
        await cdp.send("Emulation.setDeviceMetricsOverride", profile.viewport, sessionId);
      }
      currentCase = null;
    }

    const expectedProfileNavigation = expectedNavigation[profile.id];
    if (expectedProfileNavigation?.visible) {
      const interactionStart = expectedProfileNavigation.profile === "control" ? "/command" : "/";
      for (const [label, expectedDestination] of expectedProfileNavigation.links) {
        currentCase = { profile: profile.id, route: `navigation:${label}` };
        await cdp.send("Page.navigate", { url: `${baseUrl}${interactionStart}` }, sessionId);
        const readyDeadline = Date.now() + 12_000;
        while (Date.now() < readyDeadline) {
          const readyEvaluation = await cdp.send("Runtime.evaluate", {
            expression: `document.readyState === "complete" && Boolean(document.querySelector(".zw-mobile-nav--global"))`,
            returnByValue: true,
          }, sessionId);
          if (readyEvaluation.result?.value === true) break;
          await delay(200);
        }
        const clickEvaluation = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const target = [...document.querySelectorAll(".zw-mobile-nav__item")]
              .find((element) => element.getAttribute("aria-label") === ${JSON.stringify(label)});
            if (!target) return false;
            target.click();
            return true;
          })()`,
          returnByValue: true,
        }, sessionId);
        let destination = "";
        const destinationDeadline = Date.now() + 12_000;
        while (Date.now() < destinationDeadline) {
          const destinationEvaluation = await cdp.send("Runtime.evaluate", {
            expression: `location.pathname + location.hash`,
            returnByValue: true,
          }, sessionId);
          destination = destinationEvaluation.result?.value || "";
          if (destination === expectedDestination) break;
          await delay(200);
        }
        navigationInteractions.push({
          profile: profile.id,
          route: interactionStart,
          action: `navigate:${label}`,
          expectedDestination,
          destination,
          passed: clickEvaluation.result?.value === true && destination === expectedDestination,
        });
      }
      currentCase = null;
    }
  }

  const routeFailures = results.filter((item) => !item.text?.trim() || item.unavailable || item.accessDenied);
  const overflows = results.filter((item) => item.horizontalOverflow > 2);
  const browserErrors = results.flatMap((item) => item.errors.map((error) => ({ profile: item.profile, route: item.route, ...error })))
    .filter((item) => !/favicon|apple-touch-icon|AbortError|ERR_ABORTED/i.test(item.detail));
  const expectedDegradations = networkIssues.filter((item) => item.type === "http" && item.status === 503 && /\/api\/weather(?:\?|$)/.test(item.url));
  const unexpectedNetworkIssues = networkIssues.filter((item) => !expectedDegradations.includes(item));
  const terminologyIssues = results.flatMap((item) => {
    const normalizedText = (item.text || "").replace(/\s+/g, " ").trim();
    return terminologyRules.flatMap((rule) => {
      const match = normalizedText.match(rule.pattern);
      if (!match || match.index === undefined) return [];
      const start = Math.max(0, match.index - 80);
      return [{
        profile: item.profile,
        route: item.route,
        rule: rule.id,
        excerpt: normalizedText.slice(start, match.index + match[0].length + 80),
      }];
    });
  });
  const navigationIssues = results.flatMap((item) => {
    const expected = expectedNavigation[item.profile];
    if (!expected) return [];
    const issues = [];
    if (!item.commercialShell) issues.push("commercial-shell-missing");
    if (item.navigation?.count !== 1) issues.push(`global-navigation-count:${item.navigation?.count ?? 0}`);
    if (item.navigation?.profile !== expected.profile) issues.push(`profile:${item.navigation?.profile || "missing"}`);
    if (item.navigation?.source !== "authority-server") issues.push(`source:${item.navigation?.source || "missing"}`);
    if (item.navigation?.visible !== expected.visible) issues.push(`visibility:${String(item.navigation?.visible)}`);
    if (JSON.stringify(item.navigation?.labels ?? []) !== JSON.stringify(expected.labels)) issues.push(`labels:${JSON.stringify(item.navigation?.labels ?? [])}`);
    const mobile = item.profile.endsWith("mobile");
    if (item.shellContract?.mobileHeader?.count !== 1) issues.push(`mobile-header-count:${item.shellContract?.mobileHeader?.count ?? 0}`);
    if (item.shellContract?.mobileHeader?.visible !== mobile) issues.push(`mobile-header-visibility:${String(item.shellContract?.mobileHeader?.visible)}`);
    if (mobile && item.shellContract?.visibleLocalTopbars !== 0) issues.push(`local-topbars-visible:${item.shellContract?.visibleLocalTopbars}`);
    if (expected.visible && item.shellContract?.hitTargets?.some((target) => !target.reachable || target.pointerEvents === "none")) issues.push("navigation-hit-target-blocked");
    return issues.length ? [{ profile: item.profile, route: item.route, issues }] : [];
  });
  const navigationInteractionIssues = navigationInteractions.filter((item) => !item.passed);
  const creationFormIssues = creationFormInteractions.filter((item) => !item.passed);

  if (outputPath) await writeFile(outputPath, JSON.stringify({ results, routeFailures, overflows, browserErrors, networkIssues, expectedDegradations, unexpectedNetworkIssues, terminologyIssues, navigationIssues, navigationInteractions, navigationInteractionIssues, creationFormInteractions, creationFormIssues }, null, 2));

  assert.deepEqual(routeFailures.map(({ profile, route }) => ({ profile, route })), [], "Every authorized browser surface must render");
  assert.deepEqual(overflows.map(({ profile, route, horizontalOverflow }) => ({ profile, route, horizontalOverflow })), [], "Browser surfaces must not overflow horizontally");
  assert.deepEqual(browserErrors, [], "Browser surfaces must not emit runtime errors");
  assert.deepEqual(unexpectedNetworkIssues, [], "Browser surfaces must not emit unexpected HTTP or network failures");
  assert.deepEqual(terminologyIssues, [], "Browser surfaces must use the canonical product terminology");
  assert.deepEqual(navigationIssues, [], "Every browser surface must use one canonical server-derived role navigation");
  assert.deepEqual(navigationInteractionIssues, [], "Every mobile-navigation destination and module-menu action must work in the browser");
  assert.deepEqual(creationFormIssues, [], "Warehouse, asset and mission creation dialogs must remain complete and scrollable on mobile");

  console.log(JSON.stringify({
    status: "PASS",
    baseUrl,
    profiles: profiles.length,
    routeProfileCases: results.length,
    desktopCases: results.filter((item) => item.profile.endsWith("desktop")).length,
    mobileCases: results.filter((item) => item.profile.endsWith("mobile")).length,
    browserErrors: browserErrors.length,
    networkIssues: networkIssues.length,
    expectedDegradations: expectedDegradations.length,
    horizontalOverflows: overflows.length,
    terminologyIssues: terminologyIssues.length,
    navigationIssues: navigationIssues.length,
    navigationInteractions: navigationInteractions.length,
    creationFormInteractions: creationFormInteractions.length,
    outputPath: outputPath || null,
    screenshotDirectory: screenshotDirectory || null,
  }, null, 2));
} finally {
  cdp?.close();
  chromium.kill("SIGTERM");
  if (chromium.exitCode === null && chromium.signalCode === null) {
    await Promise.race([once(chromium, "exit"), delay(3_000)]);
  }
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
