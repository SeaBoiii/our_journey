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

// Captured from the published main branch on 2026-08-06 before the pacing pass.
const mainBranchScrollHeights = new Map([
  ["390x844", 18585],
  ["393x852", 18744],
  ["430x932", 20331],
  ["768x1024", 22225],
  ["1440x900", 19824],
  ["1920x1080", 23395],
]);

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

async function scrollShortPhase(page, selector, progress, settle = 900) {
  await page.evaluate(
    ({ selector, progress }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing short phase ${selector}`);
      const top = window.scrollY + element.getBoundingClientRect().top;
      window.scrollTo({ top: top + element.getBoundingClientRect().height * progress, behavior: "instant" });
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
    const finalRowSelectors = {
      message: ".final-message",
      names: ".final-names",
      time: ".final-copy time",
      divider: ".final-copy > img",
      attendance: ".attendance-request",
      cta: ".final-copy [data-rsvp-open]",
    };
    const transform = getComputedStyle(document.querySelector("[data-staircase]")).transform;
    const matrix = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
    const faceZone = couple
      ? {
          left: couple.left + couple.width * 0.18,
          right: couple.left + couple.width * 0.82,
          top: couple.top + couple.height * 0.07,
          bottom: couple.top + couple.height * 0.31,
        }
      : null;
    const faceArea = faceZone ? (faceZone.right - faceZone.left) * (faceZone.bottom - faceZone.top) : 1;
    const finalRows = Object.fromEntries(
      Object.entries(finalRowSelectors).map(([name, selector]) => {
        const row = rect(selector);
        const faceIntersection = faceZone && row
          ? Math.max(0, Math.min(faceZone.right, row.right) - Math.max(faceZone.left, row.left))
            * Math.max(0, Math.min(faceZone.bottom, row.bottom) - Math.max(faceZone.top, row.top))
          : 0;
        return [name, row
          ? {
              top: row.top,
              right: row.right,
              bottom: row.bottom,
              left: row.left,
              width: row.width,
              height: row.height,
              faceOverlapRatio: faceIntersection / faceArea,
            }
          : null];
      }),
    );
    const rowFaceOverlapRatios = Object.fromEntries(
      Object.entries(finalRows).map(([name, row]) => [name, row?.faceOverlapRatio ?? 1]),
    );
    const maximumRowFaceOverlapRatio = Math.max(...Object.values(rowFaceOverlapRatios));
    const ctaBottomGap = finalRows.cta ? window.innerHeight - finalRows.cta.bottom : null;

    return {
      pavilionOpacity: opacity("[data-pavilion-assembly]"),
      pavilionPreviewOpacity: opacity("[data-pavilion-preview] img"),
      coupleOpacity: opacity("[data-couple]"),
      finalOpacity: opacity("[data-final-copy]"),
      staircaseScale: Math.hypot(matrix.a, matrix.b),
      stairLandingY: staircase ? staircase.top + staircase.height * 0.0631 : null,
      pavilionBaseY: pavilionPicture ? pavilionPicture.top + pavilionPicture.height * 0.913 : null,
      finalCenterOffsetX: finalCopy ? finalCopy.left + finalCopy.width / 2 - window.innerWidth / 2 : null,
      finalCenterOffsetY: finalCopy ? finalCopy.top + finalCopy.height / 2 - window.innerHeight / 2 : null,
      faceZone,
      finalRows,
      rowFaceOverlapRatios,
      maximumRowFaceOverlapRatio,
      ctaBottomGap,
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
      const svh = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.getBoundingClientRect().height / window.innerHeight * 100 : -1;
      };
      const order = [
        '[data-story-beat="date"]',
        '[data-story-beat="invitation"]',
        '[data-story-beat="celebration"]',
        '[data-story-beat="story"]',
        '[data-story-beat="itinerary"]',
        '[data-story-beat="doa"]',
        '[data-story-beat="location"]',
        "[data-final-ascent]",
        "[data-phase='pavilion']",
      ].map(top);
      const scheduleRows = [...document.querySelectorAll(".schedule-level")];
      const pageText = document.body.textContent ?? "";
      return {
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        order,
        hasTopRsvp: Boolean(document.querySelector(".nav-rsvp")),
        scrollHeight: document.documentElement.scrollHeight,
        rsvpTop: top("#rsvp"),
        removedMetaphorPresent: /Our day|The staircase becomes our timeline/i.test(pageText),
        scheduleCount: scheduleRows.length,
        maximumScheduleRowSvh: Math.max(...scheduleRows.map((row) => row.getBoundingClientRect().height / window.innerHeight * 100)),
        sceneSvh: {
          arrival: svh(".arrival"),
          initialBreath: svh(".ascent-breath"),
          saveDate: svh(".save-date-beat"),
          formalInvitation: svh(".formal-invitation"),
          celebration: svh(".event-details"),
          story: svh(".story-beat"),
          itinerary: svh(".itinerary-scene"),
          doa: svh(".doa-beat"),
          location: svh(".location-beat"),
          finalBreath: svh(".final-ascent-breath"),
          pavilion: svh(".pavilion-journey"),
        },
      };
    });

    const viewportKey = `${viewport.width}x${viewport.height}`;
    const mainScrollHeight = mainBranchScrollHeights.get(viewportKey);
    const reductionPercent = mainScrollHeight
      ? (1 - staticState.scrollHeight / mainScrollHeight) * 100
      : null;

    if (staticState.horizontalOverflow) failures.push(`${viewport.width}x${viewport.height}: horizontal overflow`);
    if (staticState.hasTopRsvp) failures.push(`${viewport.width}x${viewport.height}: prominent top RSVP remains`);
    if (staticState.removedMetaphorPresent) failures.push(`${viewport.width}x${viewport.height}: removed staircase metaphor copy remains`);
    if (staticState.scheduleCount !== 4 || staticState.maximumScheduleRowSvh > 18) {
      failures.push(`${viewport.width}x${viewport.height}: itinerary is not one compact four-event composition`);
    }
    if (!staticState.order.every((value, index, values) => index === 0 || value > values[index - 1])) {
      failures.push(`${viewport.width}x${viewport.height}: narrative order is not strictly ascending`);
    }
    const sceneRanges = {
      arrival: [150, 165],
      initialBreath: [30, 40],
      saveDate: [55, 65],
      formalInvitation: [70, 80],
      celebration: [55, 65],
      story: [70, 80],
      itinerary: [85, 100],
      doa: [60, 72],
      location: [55, 65],
      finalBreath: [30, 40],
      pavilion: [280, 340],
    };
    for (const [scene, [minimum, maximum]] of Object.entries(sceneRanges)) {
      const value = staticState.sceneSvh[scene];
      if (value < minimum - 0.5 || value > maximum + 0.5) {
        failures.push(`${viewport.width}x${viewport.height}: ${scene} track is ${value.toFixed(1)}svh`);
      }
    }
    if (reductionPercent !== null && reductionPercent < 40) {
      failures.push(`${viewport.width}x${viewport.height}: scroll reduction is only ${reductionPercent.toFixed(1)}%`);
    }

    await scrollPhase(page, "#ascension", 0.55);
    const ascentMiddle = await readSceneState(page);
    await scrollShortPhase(page, "[data-final-ascent]", 0.76);
    const ascentReveal = await readSceneState(page);
    await scrollShortPhase(page, "[data-final-ascent]", 0.98);
    const ascentEnd = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0);
    const pavilionStart = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.1);
    const pavilionDistant = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.44);
    const pavilionApproach = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.84);
    const coupleHold = await readSceneState(page);
    await scrollPhase(page, "#pavilion", 0.96);
    const finalState = await readSceneState(page);

    if (ascentMiddle.pavilionOpacity > 0.02 || ascentMiddle.pavilionPreviewOpacity > 0.02) {
      failures.push(`${viewport.width}x${viewport.height}: pavilion visible before the final ascent`);
    }
    if (
      ascentReveal.pavilionPreviewOpacity < 0.04
      || ascentReveal.pavilionPreviewOpacity > 0.18
      || ascentEnd.pavilionPreviewOpacity < 0.1
      || ascentEnd.pavilionPreviewOpacity > 0.18
      || ascentReveal.pavilionOpacity > 0.02
      || ascentEnd.pavilionOpacity > 0.02
    ) {
      failures.push(`${viewport.width}x${viewport.height}: faint pavilion does not emerge during the final ascent`);
    }
    if (ascentReveal.coupleOpacity > 0.02 || ascentEnd.coupleOpacity > 0.02 || pavilionDistant.coupleOpacity > 0.02) {
      failures.push(`${viewport.width}x${viewport.height}: couple visible before reveal`);
    }
    if (
      pavilionStart.pavilionPreviewOpacity < 0.1
      || pavilionStart.pavilionPreviewOpacity > 0.2
      || pavilionStart.pavilionOpacity > 0.03
    ) {
      failures.push(`${viewport.width}x${viewport.height}: pavilion continuity breaks at the pavilion phase start`);
    }
    if (pavilionDistant.pavilionOpacity < 0.12 || pavilionDistant.pavilionOpacity > 0.8) {
      failures.push(`${viewport.width}x${viewport.height}: distant pavilion opacity is not atmospheric`);
    }
    if (coupleHold.coupleOpacity < 0.68 || coupleHold.finalOpacity > 0.08) {
      failures.push(`${viewport.width}x${viewport.height}: couple hold/final-message ordering regressed`);
    }
    const rowFaceOverlap = Object.entries(finalState.rowFaceOverlapRatios)
      .filter(([, ratio]) => ratio > 0.02);
    if (
      finalState.finalOpacity < 0.82
      || Math.abs(finalState.finalCenterOffsetX ?? Number.POSITIVE_INFINITY) > 2
      || Math.abs(finalState.finalCenterOffsetY ?? Number.POSITIVE_INFINITY) > 2
      || rowFaceOverlap.length > 0
    ) {
      failures.push(
        `${viewport.width}x${viewport.height}: final message is hidden, off-centre, or a final row obscures the couple's faces`
        + (rowFaceOverlap.length
          ? ` (${rowFaceOverlap.map(([row, ratio]) => `${row} ${ratio.toFixed(3)}`).join(", ")})`
          : ""),
      );
    }
    if (viewport.width < 600) {
      const { faceZone, finalRows, ctaBottomGap } = finalState;
      const hierarchyRows = ["names", "time", "divider", "attendance", "cta"]
        .map((name) => [name, finalRows[name]])
        .filter(([, row]) => row !== null);
      const rowsAreOrdered = hierarchyRows.every(([, row], index, rows) => (
        index === 0 || row.top >= rows[index - 1][1].bottom - 1
      ));
      const faceClearance = Math.max(6, viewport.height * 0.008);
      const messageClearsFaces = Boolean(
        finalRows.message
        && faceZone
        && finalRows.message.bottom <= faceZone.top - faceClearance,
      );
      const lowerCopyClearsFaces = Boolean(
        finalRows.names
        && faceZone
        && finalRows.names.top >= faceZone.bottom + faceClearance,
      );
      if (!rowsAreOrdered || !messageClearsFaces || !lowerCopyClearsFaces) {
        failures.push(
          `${viewport.width}x${viewport.height}: mobile final hierarchy does not keep copy clearly above and below the faces`,
        );
      }
      const minimumCtaBottomGap = 20;
      const maximumCtaBottomGap = Math.min(112, viewport.height * 0.13);
      if (
        ctaBottomGap === null
        || ctaBottomGap < minimumCtaBottomGap
        || ctaBottomGap > maximumCtaBottomGap
      ) {
        failures.push(
          `${viewport.width}x${viewport.height}: final CTA bottom gap ${ctaBottomGap?.toFixed(1) ?? "missing"}px is outside `
          + `${minimumCtaBottomGap}-${maximumCtaBottomGap.toFixed(1)}px`,
        );
      }
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
      rsvpTop: Number(staticState.rsvpTop.toFixed(1)),
      mainBranchScrollHeight: mainScrollHeight,
      reductionPercent: reductionPercent === null ? null : Number(reductionPercent.toFixed(1)),
      sceneSvh: Object.fromEntries(
        Object.entries(staticState.sceneSvh).map(([scene, value]) => [scene, Number(value.toFixed(1))]),
      ),
      landingGap: Number.isFinite(landingGap) ? Number(landingGap.toFixed(1)) : null,
      stairLandingY: pavilionApproach.stairLandingY === null ? null : Number(pavilionApproach.stairLandingY.toFixed(1)),
      pavilionBaseY: pavilionApproach.pavilionBaseY === null ? null : Number(pavilionApproach.pavilionBaseY.toFixed(1)),
      distantPavilionOpacity: pavilionDistant.pavilionOpacity,
      coupleHoldOpacity: coupleHold.coupleOpacity,
      finalCenterOffsetX: finalState.finalCenterOffsetX === null ? null : Number(finalState.finalCenterOffsetX.toFixed(2)),
      finalCenterOffsetY: finalState.finalCenterOffsetY === null ? null : Number(finalState.finalCenterOffsetY.toFixed(2)),
      finalRowFaceOverlapRatios: Object.fromEntries(
        Object.entries(finalState.rowFaceOverlapRatios)
          .map(([row, ratio]) => [row, Number(ratio.toFixed(3))]),
      ),
      maximumFinalRowFaceOverlapRatio: Number(finalState.maximumRowFaceOverlapRatio.toFixed(3)),
      mobileFinalHierarchy: viewport.width < 600
        ? {
            messageBottom: finalState.finalRows.message
              ? Number(finalState.finalRows.message.bottom.toFixed(1))
              : null,
            faceTop: finalState.faceZone ? Number(finalState.faceZone.top.toFixed(1)) : null,
            faceBottom: finalState.faceZone ? Number(finalState.faceZone.bottom.toFixed(1)) : null,
            namesTop: finalState.finalRows.names
              ? Number(finalState.finalRows.names.top.toFixed(1))
              : null,
            ctaBottomGap: finalState.ctaBottomGap === null
              ? null
              : Number(finalState.ctaBottomGap.toFixed(1)),
          }
        : null,
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
