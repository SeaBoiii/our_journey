import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the motion audit.");

const requestedCpuThrottle = Number(process.env.MOTION_CPU_THROTTLE || "1");
if (![1, 3, 4].includes(requestedCpuThrottle)) {
  throw new Error("MOTION_CPU_THROTTLE must be 1, 3, or 4.");
}

const androidUserAgent = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/140.0.0.0 Mobile Safari/537.36",
].join(" ");

const profiles = [
  {
    name: "mobile-dpr3",
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    cpuThrottle: requestedCpuThrottle,
    userAgent: androidUserAgent,
  },
  {
    name: "desktop",
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    cpuThrottle: 1,
  },
];

const performanceScenarios = [
  {
    name: "storyAmbient",
    selector: "[data-story-beat='story']",
    range: "element",
    duration: 1800,
    expectedCloudEvent: "story",
  },
  {
    name: "finalAscent",
    selector: "#ascension",
    range: "phase",
    startProgress: 0.72,
    endProgress: 0.99,
    duration: 2000,
    expectedCloudEvent: "final",
  },
  {
    name: "pavilionReveal",
    selector: "#pavilion",
    range: "phase",
    startProgress: 0.32,
    endProgress: 0.82,
    duration: 2200,
  },
  {
    name: "finalCalm",
    selector: "#pavilion",
    range: "phase",
    startProgress: 0.94,
    endProgress: 0.94,
    duration: 1800,
    stationary: true,
  },
];

const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const warnings = [];
const results = [];

const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function setCpuThrottle(page, rate) {
  await page.emulateCPUThrottling(rate === 1 ? null : rate);
}

// This pass intentionally performs layout reads because it verifies staircase and
// pavilion continuity. Frame pacing is sampled separately without these readbacks.
async function traceContinuityPhase(page, selector, startProgress, endProgress, duration) {
  return page.evaluate(
    ({ selector, startProgress, endProgress, duration }) => new Promise((resolve, reject) => {
      const phase = document.querySelector(selector);
      const staircase = document.querySelector("[data-staircase]");
      const pavilion = document.querySelector("[data-pavilion-assembly]");
      const pavilionPicture = document.querySelector(".pavilion-picture");
      if (!phase || !staircase || !pavilion || !pavilionPicture) {
        reject(new Error(`Missing motion-audit element for ${selector}`));
        return;
      }

      const phaseTop = window.scrollY + phase.getBoundingClientRect().top;
      const phaseDistance = Math.max(0, phase.getBoundingClientRect().height - window.innerHeight);
      const startScroll = phaseTop + phaseDistance * startProgress;
      const endScroll = phaseTop + phaseDistance * endProgress;
      const scales = [];
      const landingGaps = [];
      const pavilionOpacities = [];
      let frames = 0;
      let startTime;

      window.scrollTo({ top: startScroll, behavior: "instant" });

      const frame = (time) => {
        startTime ??= time;
        frames += 1;
        const progress = Math.min(1, (time - startTime) / duration);
        window.scrollTo({ top: startScroll + (endScroll - startScroll) * progress, behavior: "instant" });

        const matrixValue = getComputedStyle(staircase).transform;
        const matrix = matrixValue === "none" ? new DOMMatrix() : new DOMMatrix(matrixValue);
        scales.push(Math.hypot(matrix.a, matrix.b));
        const stairRect = staircase.getBoundingClientRect();
        const pavilionRect = pavilionPicture.getBoundingClientRect();
        const pavilionOpacity = Number.parseFloat(getComputedStyle(pavilion).opacity);
        pavilionOpacities.push(pavilionOpacity);
        if (pavilionOpacity > 0.05 && progress < 0.88) {
          const stairLanding = stairRect.top + stairRect.height * 0.0631;
          const pavilionBase = pavilionRect.top + pavilionRect.height * 0.913;
          landingGaps.push(Math.abs(stairLanding - pavilionBase));
        }

        if (progress < 1) requestAnimationFrame(frame);
        else {
          const expectsIncrease = endScroll >= startScroll;
          const regressions = scales.slice(1).filter((scale, index) => (
            expectsIncrease
              ? scale + 0.002 < scales[index]
              : scale - 0.002 > scales[index]
          )).length;
          resolve({
            frames,
            scaleRegressions: regressions,
            direction: expectsIncrease ? "forward" : "reverse",
            maxLandingGap: landingGaps.length ? Math.max(...landingGaps) : 0,
            maxPavilionOpacity: pavilionOpacities.length ? Math.max(...pavilionOpacities) : 0,
          });
        }
      };

      requestAnimationFrame(frame);
    }),
    { selector, startProgress, endProgress, duration },
  );
}

async function preparePerformanceScenario(page, scenario) {
  const scrollRange = await page.evaluate((scenario) => {
    const target = document.querySelector(scenario.selector);
    if (!target) throw new Error(`Missing performance scenario element for ${scenario.selector}`);

    const rect = target.getBoundingClientRect();
    const targetTop = window.scrollY + rect.top;
    let startScroll;
    let endScroll;

    if (scenario.range === "element") {
      startScroll = targetTop - window.innerHeight * 0.92;
      endScroll = targetTop + rect.height - window.innerHeight * 0.08;
    } else {
      const phaseDistance = Math.max(0, rect.height - window.innerHeight);
      startScroll = targetTop + phaseDistance * scenario.startProgress;
      endScroll = targetTop + phaseDistance * scenario.endProgress;
    }

    startScroll = Math.max(0, startScroll);
    endScroll = Math.max(0, endScroll);
    window.scrollTo({ top: startScroll, behavior: "instant" });
    return { startScroll, endScroll };
  }, scenario);

  await delay(600);
  await page.evaluate(async () => {
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom >= -window.innerHeight * 0.25
        && rect.top <= window.innerHeight * 1.25
        && rect.right >= 0
        && rect.left <= window.innerWidth;
    });
    const imageReady = Promise.all(visibleImages.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }
      await image.decode?.().catch(() => {});
    }));
    await Promise.race([imageReady, new Promise((resolve) => setTimeout(resolve, 800))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  return scrollRange;
}

async function samplePerformanceScenario(page, scenario, scrollRange) {
  return page.evaluate(
    async ({ scenario, scrollRange }) => {
      const deltas = [];
      const longTasks = [];
      const seenActiveCloudEvents = new Set();
      let maxSimultaneousCloudEvents = 0;
      const cloudEvents = [...document.querySelectorAll("[data-cloud-event]")];
      const expectedCloud = scenario.expectedCloudEvent
        ? document.querySelector(`[data-cloud-event="${scenario.expectedCloudEvent}"]`)
        : null;
      const expectedCloudImage = expectedCloud?.querySelector("img");
      let expectedAnimationRunningSeen = expectedCloudImage
        ? expectedCloudImage.getAnimations().some((animation) => animation.playState === "running")
        : false;

      const recordCloudState = () => {
        const activeCloudEvents = cloudEvents.filter((event) => event.classList.contains("is-active"));
        maxSimultaneousCloudEvents = Math.max(
          maxSimultaneousCloudEvents,
          activeCloudEvents.length,
        );
        activeCloudEvents.forEach((event) => {
          seenActiveCloudEvents.add(event.getAttribute("data-cloud-event"));
        });
        if (expectedCloudImage?.getAnimations().some((animation) => animation.playState === "running")) {
          expectedAnimationRunningSeen = true;
        }
      };

      recordCloudState();
      const cloudObserver = new MutationObserver(recordCloudState);
      cloudEvents.forEach((event) => cloudObserver.observe(event, { attributes: true, attributeFilter: ["class"] }));
      const handleExpectedAnimationStart = () => {
        expectedAnimationRunningSeen = true;
      };
      expectedCloudImage?.addEventListener("animationstart", handleExpectedAnimationStart);

      let longTaskObserver;
      if (
        "PerformanceObserver" in window
        && PerformanceObserver.supportedEntryTypes?.includes("longtask")
      ) {
        longTaskObserver = new PerformanceObserver((list) => {
          longTasks.push(...list.getEntries().map((entry) => entry.duration));
        });
        longTaskObserver.observe({ type: "longtask", buffered: false });
      }

      let previousTime;
      let startTime;
      await new Promise((resolve) => {
        const frame = (time) => {
          startTime ??= time;
          if (previousTime !== undefined) deltas.push(time - previousTime);
          previousTime = time;
          const progress = Math.min(1, (time - startTime) / scenario.duration);
          if (!scenario.stationary) {
            window.scrollTo({
              top: scrollRange.startScroll
                + (scrollRange.endScroll - scrollRange.startScroll) * progress,
              behavior: "instant",
            });
          }

          if (progress < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));
      recordCloudState();
      if (longTaskObserver) {
        longTasks.push(...longTaskObserver.takeRecords().map((entry) => entry.duration));
        longTaskObserver.disconnect();
      }
      cloudObserver.disconnect();
      expectedCloudImage?.removeEventListener("animationstart", handleExpectedAnimationStart);

      const sorted = [...deltas].sort((a, b) => a - b);
      const percentile = (value) => (
        sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] ?? 0
      );
      let clusterCount = 0;
      let currentCluster = 0;
      let longestConsecutiveOver34 = 0;
      deltas.forEach((delta) => {
        if (delta > 34) {
          currentCluster += 1;
          return;
        }
        if (currentCluster > 0) {
          clusterCount += 1;
          longestConsecutiveOver34 = Math.max(longestConsecutiveOver34, currentCluster);
          currentCluster = 0;
        }
      });
      if (currentCluster > 0) {
        clusterCount += 1;
        longestConsecutiveOver34 = Math.max(longestConsecutiveOver34, currentCluster);
      }

      const runningAnimations = document
        .getAnimations()
        .filter((animation) => animation.playState === "running");
      const largeVisibleRunningAnimations = runningAnimations.filter((animation) => {
        const target = animation.effect?.target;
        if (!(target instanceof Element)) return false;
        const rect = target.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
        const visibleHeight = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
        let effectiveOpacity = 1;
        let ancestor = target;
        while (ancestor && effectiveOpacity > 0.02) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden") return false;
          effectiveOpacity *= Number.parseFloat(style.opacity) || 0;
          ancestor = ancestor.parentElement;
        }
        return effectiveOpacity > 0.02
          && visibleWidth * visibleHeight > window.innerWidth * window.innerHeight * 0.2;
      });

      return {
        frames: deltas.length,
        p50FrameMs: percentile(0.5),
        p95FrameMs: percentile(0.95),
        maxFrameMs: sorted.at(-1) ?? 0,
        framesOver24Ms: deltas.filter((delta) => delta > 24).length,
        framesOver34Ms: deltas.filter((delta) => delta > 34).length,
        framesOver50Ms: deltas.filter((delta) => delta > 50).length,
        longTaskCount: longTasks.length,
        longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
        over34ClusterCount: clusterCount,
        longestConsecutiveOver34,
        runningAnimationCount: runningAnimations.length,
        largeVisibleRunningAnimationCount: largeVisibleRunningAnimations.length,
        cloudEvents: {
          expected: scenario.expectedCloudEvent ?? null,
          expectedSelectorPresent: scenario.expectedCloudEvent ? Boolean(expectedCloud) : null,
          expectedActiveSeen: scenario.expectedCloudEvent
            ? seenActiveCloudEvents.has(scenario.expectedCloudEvent)
            : null,
          expectedAnimationRunningSeen: scenario.expectedCloudEvent
            ? expectedAnimationRunningSeen
            : null,
          activeEventsSeen: [...seenActiveCloudEvents].filter(Boolean).sort(),
          maxSimultaneous: maxSimultaneousCloudEvents,
        },
      };
    },
    { scenario, scrollRange },
  );
}

function assessPerformance(profile, scenario, trace) {
  const label = `${profile.name}/${scenario.name}`;
  const allowedOver50 = profile.cpuThrottle === 1
    ? Math.max(3, Math.ceil(trace.frames * 0.06))
    : Math.max(4, Math.ceil(trace.frames * 0.1));

  if (profile.cpuThrottle === 1) {
    if (trace.p95FrameMs > 25) {
      failures.push(`${label}: p95 frame pacing exceeded 25ms (${trace.p95FrameMs.toFixed(1)}ms)`);
    } else if (trace.p95FrameMs > 20) {
      warnings.push(`${label}: p95 frame pacing exceeded the preferred 20ms (${trace.p95FrameMs.toFixed(1)}ms)`);
    }
    if (trace.longestConsecutiveOver34 > 5 || trace.framesOver50Ms > allowedOver50) {
      failures.push(`${label}: sustained long-frame cluster detected`);
    } else if (trace.longestConsecutiveOver34 > 2 || trace.framesOver50Ms > 0) {
      warnings.push(`${label}: isolated long frames detected`);
    }
  } else {
    if (trace.p95FrameMs > 50) {
      failures.push(`${label}: throttled p95 frame pacing exceeded 50ms (${trace.p95FrameMs.toFixed(1)}ms)`);
    } else if (trace.p95FrameMs > 34) {
      warnings.push(`${label}: throttled p95 frame pacing exceeded 34ms (${trace.p95FrameMs.toFixed(1)}ms)`);
    }
    if (trace.longestConsecutiveOver34 > 5 || trace.framesOver50Ms > allowedOver50) {
      failures.push(`${label}: sustained throttled long-frame cluster detected`);
    } else if (trace.longestConsecutiveOver34 > 3 || trace.framesOver50Ms > 0) {
      warnings.push(`${label}: throttled long frames detected`);
    }
  }

  if (profile.viewport.isMobile && trace.largeVisibleRunningAnimationCount > 3) {
    warnings.push(
      `${label}: ${trace.largeVisibleRunningAnimationCount} large visible animations exceed the mobile budget of 3`,
    );
  }

  if (scenario.expectedCloudEvent) {
    if (!trace.cloudEvents.expectedSelectorPresent) {
      failures.push(`${label}: missing [data-cloud-event="${scenario.expectedCloudEvent}"]`);
    } else if (!trace.cloudEvents.expectedActiveSeen) {
      failures.push(`${label}: expected cloud event "${scenario.expectedCloudEvent}" never activated`);
    } else if (!trace.cloudEvents.expectedAnimationRunningSeen) {
      failures.push(`${label}: expected cloud event "${scenario.expectedCloudEvent}" activated without a running animation`);
    }
  }

  if (trace.cloudEvents.maxSimultaneous > 1) {
    failures.push(`${label}: ${trace.cloudEvents.maxSimultaneous} narrative cloud events ran simultaneously`);
  }
}

try {
  for (const profile of profiles) {
    const page = await browser.newPage();
    if (profile.userAgent) {
      await page.setUserAgent({
        userAgent: profile.userAgent,
        platform: "Android",
      });
    }
    await page.setViewport(profile.viewport);
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "no-preference" },
    ]);
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });

    const ascent = await traceContinuityPhase(page, "#ascension", 0, 0.98, 3600);
    await delay(1200);
    const pavilion = await traceContinuityPhase(page, "#pavilion", 0, 0.72, 5200);
    await delay(900);
    const pavilionReverse = await traceContinuityPhase(page, "#pavilion", 0.72, 0, 4200);
    await delay(900);
    const ascentReverse = await traceContinuityPhase(page, "#ascension", 0.98, 0, 3200);

    if (
      ascent.scaleRegressions > 0
      || pavilion.scaleRegressions > 0
      || pavilionReverse.scaleRegressions > 0
      || ascentReverse.scaleRegressions > 0
    ) {
      failures.push(`${profile.name}: staircase scale regressed during forward/reverse travel`);
    }
    if (ascent.maxPavilionOpacity > 0.02) {
      failures.push(`${profile.name}: pavilion leaked into ascent trace`);
    }
    if (pavilion.maxLandingGap > 8 || pavilionReverse.maxLandingGap > 8) {
      failures.push(`${profile.name}: moving landing gap exceeded 8px during forward/reverse travel`);
    }

    const performance = {};
    for (const scenario of performanceScenarios) {
      await setCpuThrottle(page, 1);
      const scrollRange = await preparePerformanceScenario(page, scenario);
      await setCpuThrottle(page, profile.cpuThrottle);
      try {
        const trace = await samplePerformanceScenario(page, scenario, scrollRange);
        performance[scenario.name] = trace;
        assessPerformance(profile, scenario, trace);
      } finally {
        await setCpuThrottle(page, 1);
      }
    }

    results.push({
      profile: profile.name,
      viewport: `${profile.viewport.width}x${profile.viewport.height}@${profile.viewport.deviceScaleFactor}x`,
      cpuThrottle: profile.cpuThrottle,
      ascent,
      pavilion,
      pavilionReverse,
      ascentReverse,
      performance,
    });
    await page.close();
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    cpuThrottle: requestedCpuThrottle,
    results,
    warnings,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
