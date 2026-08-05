import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const viewportFilter = process.argv[3];
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the journey audit.");

const configuredViewports = [
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const viewports = viewportFilter
  ? configuredViewports.filter(({ width, height }) => `${width}x${height}` === viewportFilter)
  : configuredViewports;

if (viewports.length === 0) throw new Error(`Unknown viewport filter: ${viewportFilter}`);

const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const results = [];

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function scrollPhase(page, selector, progress, settle = 1150) {
  await page.evaluate(
    ({ selector, progress }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing phase ${selector}`);
      const top = window.scrollY + element.getBoundingClientRect().top;
      const distance = Math.max(0, element.getBoundingClientRect().height - window.innerHeight);
      window.scrollTo({ top: top + distance * progress, behavior: "instant" });
    },
    { selector, progress },
  );
  await wait(settle);
}

async function readSceneState(page) {
  return page.evaluate(() => {
    const opacity = (selector) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).opacity) : -1;
    };
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const staircase = rect("[data-staircase]");
    const pavilionPicture = rect(".pavilion-picture");
    const couple = rect("[data-couple]");
    const finalCopy = rect("[data-final-copy]");
    const transform = getComputedStyle(document.querySelector("[data-staircase]")).transform;
    const matrix = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
    const intersection = couple && finalCopy
      ? Math.max(0, Math.min(couple.right, finalCopy.right) - Math.max(couple.left, finalCopy.left))
        * Math.max(0, Math.min(couple.bottom, finalCopy.bottom) - Math.max(couple.top, finalCopy.top))
      : 0;
    const finalArea = finalCopy ? finalCopy.width * finalCopy.height : 1;

    return {
      pavilionOpacity: opacity("[data-pavilion-assembly]"),
      coupleOpacity: opacity("[data-couple]"),
      finalOpacity: opacity("[data-final-copy]"),
      staircaseScale: Math.hypot(matrix.a, matrix.b),
      stairLandingY: staircase ? staircase.top + staircase.height * 0.0631 : null,
      pavilionBaseY: pavilionPicture ? pavilionPicture.top + pavilionPicture.height * 0.913 : null,
      finalOverlapRatio: intersection / finalArea,
    };
  });
}

try {
  for (const viewport of viewports) {
    const page = await browser.newPage();
    const errors = [];
    await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600 });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });

    const staticState = await page.evaluate(() => {
      const top = (selector) => {
        const element = document.querySelector(selector);
        return element ? window.scrollY + element.getBoundingClientRect().top : -1;
      };
      const order = [
        '[data-story-beat="date"]',
        '[data-story-beat="invitation"]',
        '[data-story-beat="celebration"]',
        ".itinerary-ascent",
        '[data-story-beat="doa"]',
        '[data-story-beat="location"]',
        "[data-final-ascent]",
        "[data-phase='pavilion']",
        "#rsvp",
      ].map(top);
      return {
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        order,
        hasTopRsvp: Boolean(document.querySelector(".nav-rsvp")),
        scrollHeight: document.documentElement.scrollHeight,
      };
    });

    if (staticState.horizontalOverflow) failures.push(`${viewport.width}x${viewport.height}: horizontal overflow`);
    if (staticState.hasTopRsvp) failures.push(`${viewport.width}x${viewport.height}: prominent top RSVP remains`);
    if (!staticState.order.every((value, index, values) => index === 0 || value > values[index - 1])) {
      failures.push(`${viewport.width}x${viewport.height}: narrative order is not strictly ascending`);
    }

    await scrollPhase(page, "#ascension", 0.55);
    const ascentMiddle = await readSceneState(page);
    await scrollPhase(page, "#ascension", 0.98);
    const ascentEnd = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.05);
    const pavilionStart = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.22);
    const pavilionDistant = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.48);
    const pavilionApproach = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.8);
    const coupleHold = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.96);
    const finalState = await readSceneState(page);

    if (ascentMiddle.pavilionOpacity > 0.02 || ascentEnd.pavilionOpacity > 0.02) {
      failures.push(`${viewport.width}x${viewport.height}: pavilion visible during informational ascent`);
    }
    if (ascentEnd.coupleOpacity > 0.02 || pavilionDistant.coupleOpacity > 0.02) {
      failures.push(`${viewport.width}x${viewport.height}: couple visible before reveal`);
    }
    if (pavilionStart.pavilionOpacity > 0.03) {
      failures.push(`${viewport.width}x${viewport.height}: pavilion visible at pavilion phase start`);
    }
    if (pavilionDistant.pavilionOpacity < 0.12 || pavilionDistant.pavilionOpacity > 0.8) {
      failures.push(`${viewport.width}x${viewport.height}: distant pavilion opacity is not atmospheric`);
    }
    if (coupleHold.coupleOpacity < 0.68 || coupleHold.finalOpacity > 0.08) {
      failures.push(`${viewport.width}x${viewport.height}: couple hold/final-message ordering regressed`);
    }
    if (finalState.finalOpacity < 0.82 || finalState.finalOverlapRatio > 0.08) {
      failures.push(`${viewport.width}x${viewport.height}: final message is hidden or overlaps the couple`);
    }
    const landingGap = pavilionApproach.stairLandingY === null || pavilionApproach.pavilionBaseY === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(pavilionApproach.stairLandingY - pavilionApproach.pavilionBaseY);
    if (landingGap > Math.max(90, viewport.height * 0.12)) {
      failures.push(`${viewport.width}x${viewport.height}: staircase/pavilion landing gap ${landingGap.toFixed(1)}px`);
    }
    if (errors.length) failures.push(`${viewport.width}x${viewport.height}: ${errors.join(" | ")}`);

    results.push({
      viewport: `${viewport.width}x${viewport.height}`,
      scrollHeight: staticState.scrollHeight,
      landingGap: Number.isFinite(landingGap) ? Number(landingGap.toFixed(1)) : null,
      stairLandingY: pavilionApproach.stairLandingY === null ? null : Number(pavilionApproach.stairLandingY.toFixed(1)),
      pavilionBaseY: pavilionApproach.pavilionBaseY === null ? null : Number(pavilionApproach.pavilionBaseY.toFixed(1)),
      distantPavilionOpacity: pavilionDistant.pavilionOpacity,
      coupleHoldOpacity: coupleHold.coupleOpacity,
      finalOverlapRatio: Number(finalState.finalOverlapRatio.toFixed(3)),
    });
    await page.close();
  }

  const reducedPage = await browser.newPage();
  await reducedPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await reducedPage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await reducedPage.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
  await scrollPhase(reducedPage, "#ascension", 0.6, 250);
  const reducedAscent = await readSceneState(reducedPage);
  await scrollPhase(reducedPage, "#pavilion", 0.45, 250);
  const reducedPavilion = await readSceneState(reducedPage);
  await scrollPhase(reducedPage, "#pavilion", 0.9, 250);
  const reducedFinal = await readSceneState(reducedPage);
  if (reducedAscent.pavilionOpacity > 0.02 || reducedAscent.coupleOpacity > 0.02) {
    failures.push("reduced motion: pavilion/couple visible during ascent");
  }
  if (reducedPavilion.pavilionOpacity < 0.9 || reducedPavilion.coupleOpacity < 0.9 || reducedPavilion.finalOpacity > 0.02) {
    failures.push("reduced motion: pavilion state order regressed");
  }
  if (reducedFinal.finalOpacity < 0.9) failures.push("reduced motion: final message not revealed");
  await reducedPage.close();

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
