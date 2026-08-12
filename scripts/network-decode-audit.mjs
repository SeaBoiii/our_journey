import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the network/decode audit.");

const androidUserAgent = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/140.0.0.0 Mobile Safari/537.36",
].join(" ");
const networkProfiles = [
  {
    name: "fast-4g",
    latency: 20,
    downloadThroughput: 4 * 1024 * 1024 / 8,
    uploadThroughput: 3 * 1024 * 1024 / 8,
  },
  {
    name: "slow-4g",
    latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
  },
];
const passDuration = 7_000;
const warmupQuietWindow = 400;
const warmupActivityDuration = 1_800;
const warmupActivityCadence = 75;
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const warnings = [];
const results = [];

async function openFreshPage(profile, passName) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  let audioRequests = 0;

  await page.setUserAgent({ userAgent: androidUserAgent, platform: "Android" });
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/\.mp3(?:\?|$)/i.test(request.url())) audioRequests += 1;
  });
  await page.evaluateOnNewDocument(() => {
    const trace = {
      decodeStarts: [],
      interactions: [],
    };
    Object.defineProperty(window, "__journeyNetworkDecodeAudit", {
      configurable: false,
      enumerable: false,
      value: trace,
      writable: false,
    });

    const nativeDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function auditedDecode(...args) {
      trace.decodeStarts.push({
        at: performance.now(),
        source: this.currentSrc || this.src || "",
      });
      return nativeDecode.apply(this, args);
    };

    ["scroll", "touchmove", "wheel"].forEach((type) => {
      window.addEventListener(type, () => {
        trace.interactions.push({ at: performance.now(), type });
      }, { capture: true, passive: true });
    });
  });

  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.clearBrowserCache");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.downloadThroughput,
    uploadThroughput: profile.uploadThroughput,
    connectionType: "cellular4g",
  });

  await page.goto(`${baseUrl}/?network-audit=${profile.name}-${passName}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("[data-journey-root]");
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  return {
    context,
    page,
    errors,
    getAudioRequests: () => audioRequests,
  };
}

async function waitForVisualWarmup(page) {
  await page.waitForFunction(
    () => document.querySelector("[data-journey-root]")?.getAttribute("data-asset-warmup") === "complete",
    { timeout: 60_000 },
  );
}

async function exerciseStagedWarmup(page) {
  return page.evaluate(async ({ activityCadence, activityDuration }) => {
    const root = document.querySelector("[data-journey-root]");
    const trace = window.__journeyNetworkDecodeAudit;
    if (!root || !trace) throw new Error("Warmup audit instrumentation is unavailable");

    const opening = {
      state: root.getAttribute("data-asset-warmup"),
      stage: root.getAttribute("data-asset-warmup-stage"),
    };
    const startedAt = performance.now();
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const steps = Math.max(1, Math.ceil(activityDuration / activityCadence));

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      window.scrollTo({ top: maxScroll * progress, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("touchmove"));
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
      await new Promise((resolve) => window.setTimeout(resolve, activityCadence));
    }

    return {
      opening,
      startedAt,
      activityEndedAt: trace.interactions.at(-1)?.at ?? performance.now(),
      maxScroll,
    };
  }, {
    activityCadence: warmupActivityCadence,
    activityDuration: warmupActivityDuration,
  });
}

async function readWarmupAudit(page, activity) {
  return page.evaluate(({ activityEndedAt, maxScroll, opening, quietWindow, startedAt }) => {
    const root = document.querySelector("[data-journey-root]");
    const trace = window.__journeyNetworkDecodeAudit;
    if (!root || !trace) throw new Error("Warmup audit instrumentation is unavailable");

    const interactions = trace.interactions.filter((event) => (
      event.at >= startedAt && event.at <= activityEndedAt
    ));
    const decodeStarts = trace.decodeStarts.filter((decode) => decode.at >= startedAt);
    const violations = decodeStarts.flatMap((decode) => {
      const priorInteraction = interactions.findLast((event) => event.at <= decode.at);
      if (!priorInteraction) return [];
      const quietFor = decode.at - priorInteraction.at;
      return quietFor < quietWindow
        ? [{ ...decode, priorInteraction: priorInteraction.type, quietFor }]
        : [];
    });

    return {
      opening,
      completion: {
        state: root.getAttribute("data-asset-warmup"),
        stage: root.getAttribute("data-asset-warmup-stage"),
      },
      activityDurationMs: activityEndedAt - startedAt,
      maxScroll,
      interactionCounts: Object.fromEntries(
        ["scroll", "touchmove", "wheel"].map((type) => [
          type,
          interactions.filter((event) => event.type === type).length,
        ]),
      ),
      decodeStarts: decodeStarts.map((decode) => ({
        ...decode,
        at: decode.at - startedAt,
      })),
      violations: violations.map((violation) => ({
        ...violation,
        at: violation.at - startedAt,
      })),
      quietWindowMs: quietWindow,
    };
  }, {
    ...activity,
    quietWindow: warmupQuietWindow,
  });
}

async function sampleAscent(page) {
  return page.evaluate((duration) => new Promise((resolve, reject) => {
    const ascent = document.querySelector("#ascension");
    const pavilion = document.querySelector("#pavilion");
    if (!ascent || !pavilion) {
      reject(new Error("Missing ascent or pavilion phase"));
      return;
    }

    const ascentBounds = ascent.getBoundingClientRect();
    const pavilionBounds = pavilion.getBoundingClientRect();
    const startScroll = window.scrollY + ascentBounds.top;
    const pavilionTop = window.scrollY + pavilionBounds.top;
    const pavilionDistance = Math.max(0, pavilionBounds.height - window.innerHeight);
    const endScroll = pavilionTop + pavilionDistance * 0.84;
    const frameDeltas = [];
    const longFrameTimes = [];
    let previousTime;
    let startTime;

    window.scrollTo({ top: startScroll, behavior: "instant" });

    const frame = (time) => {
      startTime ??= time;
      if (previousTime !== undefined) {
        const delta = time - previousTime;
        frameDeltas.push(delta);
        if (delta > 34) longFrameTimes.push(time);
      }
      previousTime = time;
      const progress = Math.min(1, (time - startTime) / duration);
      window.scrollTo({
        top: startScroll + (endScroll - startScroll) * progress,
        behavior: "instant",
      });

      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }

      requestAnimationFrame(() => {
        const endTime = performance.now();
        const imageResources = performance
          .getEntriesByType("resource")
          .filter((entry) => (
            entry.responseEnd >= startTime
            && entry.responseEnd <= endTime
            && (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?|$)/i.test(entry.name)
              || entry.initiatorType === "img")
          ));
        const correlatedLongFrames = longFrameTimes.filter((frameTime) => (
          imageResources.some((resource) => Math.abs(resource.responseEnd - frameTime) <= 180)
        )).length;
        const sorted = [...frameDeltas].sort((first, second) => first - second);
        const percentile = (value) => (
          sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] ?? 0
        );

        resolve({
          frames: frameDeltas.length,
          p50FrameMs: percentile(0.5),
          p95FrameMs: percentile(0.95),
          maxFrameMs: sorted.at(-1) ?? 0,
          framesOver34Ms: frameDeltas.filter((delta) => delta > 34).length,
          framesOver50Ms: frameDeltas.filter((delta) => delta > 50).length,
          imageCompletions: imageResources.length,
          correlatedLongFrames,
          scrollCompleted: Math.abs(window.scrollY - endScroll) <= 2,
        });
      });
    };

    requestAnimationFrame(frame);
  }), passDuration);
}

async function readSelectedAssets(page) {
  return page.evaluate(async () => {
    const read = async (selector) => {
      const image = document.querySelector(selector);
      if (!(image instanceof HTMLImageElement)) return null;

      const currentSrc = image.currentSrc || image.src;
      if (!currentSrc) return null;
      const file = decodeURIComponent(new URL(currentSrc, document.baseURI).pathname.split("/").at(-1) ?? "");
      const filenameWidthMatch = file.match(/-(\d+)(?=\.[^.]+$)/);
      const intrinsicSource = await new Promise((resolve) => {
        const probe = new Image();
        let settled = false;
        const finish = (loaded) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve({
            loaded,
            width: loaded ? probe.naturalWidth : null,
            height: loaded ? probe.naturalHeight : null,
          });
        };
        const timeout = window.setTimeout(() => finish(false), 8_000);
        probe.addEventListener("load", () => finish(true), { once: true });
        probe.addEventListener("error", () => finish(false), { once: true });
        probe.src = currentSrc;
      });

      return {
        file,
        currentSrc,
        filenameWidth: filenameWidthMatch ? Number(filenameWidthMatch[1]) : null,
        elementNaturalWidth: image.naturalWidth,
        elementNaturalHeight: image.naturalHeight,
        sourceWidth: intrinsicSource.width,
        sourceHeight: intrinsicSource.height,
        sourceLoaded: intrinsicSource.loaded,
      };
    };

    const entries = await Promise.all(Object.entries({
      sky: ".sky-picture img",
      staircase: "[data-staircase] img",
      pavilion: ".pavilion-picture img",
      couple: ".couple-picture img",
      ringHand: "[data-ring-hand]",
      storyCloud: "[data-cloud-event='story'] img",
      doaCloud: "[data-cloud-event='doa'] img",
      finalCloud: "[data-cloud-event='final'] img",
      pavilionCloud: ".pavilion-cloud-bank",
    }).map(async ([name, selector]) => [name, await read(selector)]));
    return Object.fromEntries(entries);
  });
}

function assertMobileSourceCap(profileName, assetName, asset, cap) {
  if (!asset?.currentSrc || !asset.sourceLoaded || !Number.isFinite(asset.sourceWidth)) {
    failures.push(`${profileName}: mobile ${assetName} source could not be inspected`);
    return;
  }

  if (asset.sourceWidth > cap) {
    failures.push(
      `${profileName}: mobile ${assetName} selected ${asset.file} at ${asset.sourceWidth}px (cap ${cap}px)`,
    );
  }
  if (asset.filenameWidth !== null && asset.filenameWidth > cap) {
    failures.push(
      `${profileName}: mobile ${assetName} currentSrc filename ${asset.file} exceeds the ${cap}px cap`,
    );
  }
}

const rounds = (value) => Number(value.toFixed(1));
const compactTrace = (trace) => ({
  ...trace,
  p50FrameMs: rounds(trace.p50FrameMs),
  p95FrameMs: rounds(trace.p95FrameMs),
  maxFrameMs: rounds(trace.maxFrameMs),
});

try {
  for (const profile of networkProfiles) {
    const coldSession = await openFreshPage(profile, "cold-repeat");
    const firstPass = await sampleAscent(coldSession.page);
    await waitForVisualWarmup(coldSession.page);
    await coldSession.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await wait(350);
    const repeatPass = await sampleAscent(coldSession.page);
    const coldAudioRequests = coldSession.getAudioRequests();
    const coldErrors = [...coldSession.errors];
    await coldSession.context.close();

    const warmedSession = await openFreshPage(profile, "prewarmed");
    const warmupActivity = await exerciseStagedWarmup(warmedSession.page);
    await waitForVisualWarmup(warmedSession.page);
    const warmupAudit = await readWarmupAudit(warmedSession.page, warmupActivity);
    const warmedPass = await sampleAscent(warmedSession.page);
    const selectedAssets = await readSelectedAssets(warmedSession.page);
    const warmedAudioRequests = warmedSession.getAudioRequests();
    const warmedErrors = [...warmedSession.errors];
    await warmedSession.context.close();

    const firstPassWorse = (
      firstPass.p95FrameMs > repeatPass.p95FrameMs + 8
      || firstPass.maxFrameMs > repeatPass.maxFrameMs + 25
    );
    const probableDecodeHitch = firstPassWorse && firstPass.imageCompletions > 0;
    const warmedP95Delta = warmedPass.p95FrameMs - repeatPass.p95FrameMs;

    if (probableDecodeHitch) {
      warnings.push(`${profile.name}: probable network/image decode hitch`);
    }
    if (![firstPass, repeatPass, warmedPass].every((pass) => pass.scrollCompleted)) {
      failures.push(`${profile.name}: page did not remain scrollable through every pass`);
    }
    if (warmedPass.p95FrameMs > 34 && warmedP95Delta > 10) {
      failures.push(`${profile.name}: prewarmed first pass remained materially worse than the repeat pass`);
    }
    if (coldAudioRequests + warmedAudioRequests > 0) {
      failures.push(`${profile.name}: audio downloaded without guest interaction`);
    }
    if (warmupAudit.opening.state === "complete") {
      failures.push(`${profile.name}: staged warmup completed at opening before journey progression`);
    }
    if (warmupAudit.completion.state !== "complete") {
      failures.push(`${profile.name}: staged warmup did not complete after journey progression`);
    }
    const missingInteractionTypes = Object.entries(warmupAudit.interactionCounts)
      .filter(([, count]) => count === 0)
      .map(([type]) => type);
    if (missingInteractionTypes.length > 0) {
      failures.push(`${profile.name}: warmup audit missed ${missingInteractionTypes.join(", ")} activity`);
    }
    if (warmupAudit.decodeStarts.length === 0) {
      failures.push(`${profile.name}: warmup decode instrumentation observed no staged decode calls`);
    }
    if (warmupAudit.violations.length > 0) {
      const worstGap = Math.min(...warmupAudit.violations.map((violation) => violation.quietFor));
      failures.push(
        `${profile.name}: ${warmupAudit.violations.length} image decode(s) began within ${warmupQuietWindow}ms of scroll/touch/wheel activity (minimum gap ${rounds(worstGap)}ms)`,
      );
    }
    assertMobileSourceCap(profile.name, "sky", selectedAssets.sky, 640);
    assertMobileSourceCap(profile.name, "staircase", selectedAssets.staircase, 640);
    assertMobileSourceCap(profile.name, "couple", selectedAssets.couple, 640);
    assertMobileSourceCap(profile.name, "ring hand", selectedAssets.ringHand, 640);
    assertMobileSourceCap(profile.name, "pavilion", selectedAssets.pavilion, 1024);
    if (coldErrors.length || warmedErrors.length) {
      failures.push(`${profile.name}: ${[...coldErrors, ...warmedErrors].join(" | ")}`);
    }

    results.push({
      profile: profile.name,
      network: {
        latencyMs: profile.latency,
        downloadMbps: rounds(profile.downloadThroughput * 8 / 1024 / 1024),
        uploadMbps: rounds(profile.uploadThroughput * 8 / 1024 / 1024),
      },
      cpuThrottle: 1,
      firstPass: compactTrace(firstPass),
      repeatPass: compactTrace(repeatPass),
      prewarmedFirstPass: compactTrace(warmedPass),
      probableDecodeHitch,
      warmedP95DeltaMs: rounds(warmedP95Delta),
      warmupAudit,
      selectedAssets,
      audioRequests: coldAudioRequests + warmedAudioRequests,
    });
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    viewport: "390x844@3x",
    passDurationMs: passDuration,
    results,
    warnings,
    failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
