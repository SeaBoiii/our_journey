import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the dynamic viewport audit.");

const widthFilter = process.argv[3] ? Number.parseInt(process.argv[3], 10) : null;
const configuredMobileCases = [
  { width: 390, toolbarVisibleHeight: 760, toolbarCollapsedHeight: 844 },
  { width: 393, toolbarVisibleHeight: 768, toolbarCollapsedHeight: 852 },
  { width: 430, toolbarVisibleHeight: 844, toolbarCollapsedHeight: 932 },
];
const mobileCases = widthFilter
  ? configuredMobileCases.filter(({ width }) => width === widthFilter)
  : configuredMobileCases;
if (!mobileCases.length) throw new Error(`Unknown mobile viewport width: ${widthFilter}`);
const androidChromeUserAgent =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const results = [];
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function prepare(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((image) => image.matches("[data-staircase] img, .pavilion-picture img, .couple-picture img"))
        .map((image) => image.decode().catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await wait(1300);
}

async function phaseProgress(page, progress, settle = 900) {
  await page.evaluate((progress) => {
    const phase = document.querySelector("#pavilion");
    if (!phase) throw new Error("Missing pavilion phase");
    const top = window.scrollY + phase.getBoundingClientRect().top;
    const distance = Math.max(0, phase.getBoundingClientRect().height - window.innerHeight);
    window.scrollTo({ top: top + distance * progress, behavior: "instant" });
  }, progress);
  await wait(settle);
}

async function nudgeScroll(page, delta, settle = 220) {
  await page.evaluate((delta) => {
    window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
  }, delta);
  await wait(settle);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const style = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    const matrix = (selector) => {
      const transform = style(selector)?.transform ?? "none";
      const value = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
      return [value.a, value.b, value.c, value.d, value.e, value.f];
    };
    const camera = document.querySelector(".skyward-stage");
    const cameraRect = camera?.getBoundingClientRect() ?? null;
    const arrivalRect = rect(".arrival-stage");
    const skyRect = rect(".sky-world");
    const finalRect = rect("[data-final-copy]");
    const pavilionPictureRect = rect(".pavilion-picture");
    const coupleRect = rect("[data-couple]");
    const visualHeight = window.visualViewport?.height ?? window.innerHeight;
    const bottomElement = document.elementFromPoint(window.innerWidth / 2, Math.max(0, visualHeight - 1));
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const shellBackground = style(".journey-shell")?.backgroundColor ?? "missing";
    const journeyBackground = style(".skyward-journey")?.backgroundColor ?? "missing";

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualHeight,
      scrollY: window.scrollY,
      cameraHeight: cameraRect?.height ?? -1,
      arrivalCameraHeight: arrivalRect?.height ?? -1,
      cameraTop: cameraRect?.top ?? Number.POSITIVE_INFINITY,
      cameraBottom: cameraRect?.bottom ?? Number.NEGATIVE_INFINITY,
      bottomPointInCamera: Boolean(camera && bottomElement && camera.contains(bottomElement)),
      skyBounds: skyRect
        ? { left: skyRect.left, top: skyRect.top, right: skyRect.right, bottom: skyRect.bottom }
        : null,
      skyPosition: style(".sky-world")?.position ?? "missing",
      bodyBackground,
      shellBackground,
      journeyBackground,
      pavilionMatrix: matrix("[data-pavilion-assembly]"),
      finalMatrix: matrix("[data-final-copy]"),
      pavilionOpacity: Number.parseFloat(style("[data-pavilion-assembly]")?.opacity ?? "-1"),
      finalOpacity: Number.parseFloat(style("[data-final-copy]")?.opacity ?? "-1"),
      finalCenterOffsetX: finalRect ? finalRect.left + finalRect.width / 2 - window.innerWidth / 2 : null,
      finalCenterOffsetY: finalRect ? finalRect.top + finalRect.height / 2 - visualHeight / 2 : null,
      pavilionTopRatio: pavilionPictureRect ? pavilionPictureRect.top / visualHeight : null,
      coupleFaceRatio: coupleRect ? (coupleRect.top + coupleRect.height * 0.19) / visualHeight : null,
    };
  });
}

function matrixDelta(first, second) {
  return Math.max(...first.map((value, index) => Math.abs(value - second[index])));
}

function assertCoverage(state, label) {
  if (Math.abs(state.cameraHeight - state.visualHeight) > 1 || Math.abs(state.arrivalCameraHeight - state.visualHeight) > 1) {
    failures.push(`${label}: 100lvh camera does not cover the visual viewport`);
  }
  if (state.cameraTop > 0.5 || state.cameraBottom < state.visualHeight - 0.5 || !state.bottomPointInCamera) {
    failures.push(`${label}: fullscreen camera exposes content at the bottom edge`);
  }
  if (
    !state.skyBounds
    || state.skyBounds.left > -1.5
    || state.skyBounds.top > -1.5
    || state.skyBounds.right < state.innerWidth + 1.5
    || state.skyBounds.bottom < state.visualHeight + 1.5
    || state.skyPosition !== "fixed"
  ) {
    failures.push(`${label}: fixed sky does not overscan every viewport edge`);
  }
  if (
    state.bodyBackground !== state.shellBackground
    || !state.journeyBackground.includes("234, 242, 247")
  ) {
    failures.push(`${label}: fallback backgrounds can flash a contrasting colour`);
  }
  if (
    state.pavilionOpacity < 0.55
    || state.finalOpacity < 0.85
    || Math.abs(state.finalCenterOffsetX ?? Number.POSITIVE_INFINITY) > 2
    || Math.abs(state.finalCenterOffsetY ?? Number.POSITIVE_INFINITY) > 2
  ) {
    failures.push(`${label}: pavilion/final composition shifted or reset during viewport change`);
  }
}

try {
  for (const mobileCase of mobileCases) {
    const page = await browser.newPage();
    const errors = [];
    await page.setUserAgent({
      userAgent: androidChromeUserAgent,
      platform: "Android",
    });
    await page.setViewport({
      width: mobileCase.width,
      height: mobileCase.toolbarVisibleHeight,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
    await prepare(page);
    await phaseProgress(page, 0.96, 1100);

    const visible = await snapshot(page);
    assertCoverage(visible, `${mobileCase.width}x${mobileCase.toolbarVisibleHeight} toolbar-visible`);
    const visibleScrollY = visible.scrollY;

    const restoredStates = [];
    let collapsed;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await nudgeScroll(page, 28);
      await page.setViewport({
        width: mobileCase.width,
        height: mobileCase.toolbarCollapsedHeight,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      await wait(520);
      collapsed = await snapshot(page);
      assertCoverage(collapsed, `${mobileCase.width}x${mobileCase.toolbarCollapsedHeight} toolbar-collapsed cycle ${cycle + 1}`);

      await nudgeScroll(page, -28);
      await page.setViewport({
        width: mobileCase.width,
        height: mobileCase.toolbarVisibleHeight,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: "instant" }), visibleScrollY);
      await wait(1050);
      const restored = await snapshot(page);
      assertCoverage(restored, `${mobileCase.width}x${mobileCase.toolbarVisibleHeight} restored cycle ${cycle + 1}`);
      restoredStates.push(restored);
      if (
        matrixDelta(visible.pavilionMatrix, restored.pavilionMatrix) > 1
        || matrixDelta(visible.finalMatrix, restored.finalMatrix) > 1
        || Math.abs(visible.pavilionOpacity - restored.pavilionOpacity) > 0.02
        || Math.abs(visible.finalOpacity - restored.finalOpacity) > 0.02
      ) {
        failures.push(`${mobileCase.width}px: pavilion/final state did not return after toolbar cycle ${cycle + 1}`);
      }
    }

    await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
    await wait(400);
    const afterOrientationRefresh = await snapshot(page);
    assertCoverage(afterOrientationRefresh, `${mobileCase.width}px post-orientation refresh`);

    const collapsedPavilionDelta = collapsed
      ? matrixDelta(visible.pavilionMatrix, collapsed.pavilionMatrix)
      : Number.POSITIVE_INFINITY;
    const collapsedFinalDelta = collapsed
      ? matrixDelta(visible.finalMatrix, collapsed.finalMatrix)
      : Number.POSITIVE_INFINITY;
    const collapsedPavilionTopRatioDelta = Math.abs(
      (visible.pavilionTopRatio ?? 0) - (collapsed?.pavilionTopRatio ?? 1),
    );
    const collapsedCoupleFaceRatioDelta = Math.abs(
      (visible.coupleFaceRatio ?? 0) - (collapsed?.coupleFaceRatio ?? 1),
    );
    const collapsedPavilionOpacityDelta = Math.abs(
      visible.pavilionOpacity - (collapsed?.pavilionOpacity ?? -1),
    );
    const collapsedFinalOpacityDelta = Math.abs(
      visible.finalOpacity - (collapsed?.finalOpacity ?? -1),
    );
    if (
      collapsedFinalDelta > 3
      || collapsedPavilionTopRatioDelta > 0.06
      || collapsedCoupleFaceRatioDelta > 0.06
      || collapsedPavilionOpacityDelta > 0.08
      || collapsedFinalOpacityDelta > 0.08
    ) {
      failures.push(`${mobileCase.width}px: toolbar collapse reset or jumped the pavilion timeline`);
    }

    if (errors.length) failures.push(`${mobileCase.width}px: ${errors.join(" | ")}`);
    results.push({
      width: mobileCase.width,
      toolbarVisible: {
        height: visible.visualHeight,
        cameraHeight: visible.cameraHeight,
        finalCenterOffsetY: Number((visible.finalCenterOffsetY ?? 0).toFixed(2)),
      },
      toolbarCollapsed: {
        height: collapsed?.visualHeight,
        cameraHeight: collapsed?.cameraHeight,
        finalCenterOffsetY: Number((collapsed?.finalCenterOffsetY ?? 0).toFixed(2)),
      },
      maximumRestoredPavilionDelta: Number(Math.max(...restoredStates.map((state) => matrixDelta(visible.pavilionMatrix, state.pavilionMatrix))).toFixed(3)),
      maximumRestoredFinalDelta: Number(Math.max(...restoredStates.map((state) => matrixDelta(visible.finalMatrix, state.finalMatrix))).toFixed(3)),
      collapsedPavilionDelta: Number(collapsedPavilionDelta.toFixed(3)),
      collapsedFinalDelta: Number(collapsedFinalDelta.toFixed(3)),
      collapsedPavilionTopRatioDelta: Number(collapsedPavilionTopRatioDelta.toFixed(3)),
      collapsedCoupleFaceRatioDelta: Number(collapsedCoupleFaceRatioDelta.toFixed(3)),
      collapsedPavilionOpacityDelta: Number(collapsedPavilionOpacityDelta.toFixed(3)),
      collapsedFinalOpacityDelta: Number(collapsedFinalOpacityDelta.toFixed(3)),
    });
    await page.close();
  }

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
