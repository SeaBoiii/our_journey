import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the reverse journey audit.");

const allViewports = [
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];
const widthFilterValue = process.env.REVERSE_AUDIT_WIDTH;
const widthFilter = widthFilterValue === undefined ? null : Number(widthFilterValue);
if (widthFilter !== null && !Number.isFinite(widthFilter)) {
  throw new Error("REVERSE_AUDIT_WIDTH must be a numeric viewport width.");
}
const viewports = widthFilter === null
  ? allViewports
  : allViewports.filter((viewport) => viewport.width === widthFilter);
if (!viewports.length) {
  throw new Error(
    `REVERSE_AUDIT_WIDTH=${widthFilter} does not match a configured viewport (${allViewports.map(({ width }) => width).join(", ")}).`,
  );
}
const beats = [
  ["date", '[data-story-beat="date"]'],
  ["invitation", '[data-story-beat="invitation"]'],
  ["celebration", '[data-story-beat="celebration"]'],
  ["story", '[data-story-beat="story"]'],
  ["itinerary", '[data-story-beat="itinerary"]'],
  ["doa", '[data-story-beat="doa"]'],
  ["location", '[data-story-beat="location"]'],
];

const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const results = [];
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function prepare(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [
      document.querySelector("[data-staircase] img"),
      document.querySelector(".pavilion-picture img"),
      document.querySelector(".couple-picture img"),
    ].filter(Boolean);
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await wait(1500);
}

async function animatedScroll(page, target, duration = 360, settle = 800) {
  await page.evaluate(
    ({ target, duration }) => new Promise((resolve) => {
      const start = window.scrollY;
      const maximum = document.documentElement.scrollHeight - window.innerHeight;
      const destination = Math.max(0, Math.min(maximum, target));
      const startedAt = performance.now();
      const frame = (time) => {
        const progress = Math.min(1, (time - startedAt) / duration);
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        window.scrollTo({ top: start + (destination - start) * eased, behavior: "instant" });
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    }),
    { target, duration },
  );
  await wait(settle);
}

async function centerElement(page, selector, settle = 800) {
  const target = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing reverse-audit beat: ${selector}`);
    const rect = element.getBoundingClientRect();
    return window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
  }, selector);
  await animatedScroll(page, target, 360, settle);
}

async function phaseProgress(page, selector, progress, settle = 800) {
  const target = await page.evaluate(
    ({ selector, progress }) => {
      const phase = document.querySelector(selector);
      if (!phase) throw new Error(`Missing reverse-audit phase: ${selector}`);
      const top = window.scrollY + phase.getBoundingClientRect().top;
      const distance = Math.max(0, phase.getBoundingClientRect().height - window.innerHeight);
      return top + distance * progress;
    },
    { selector, progress },
  );
  await animatedScroll(page, target, 360, settle);
}

async function readBeat(page, selector) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing reverse-audit beat: ${selector}`);
    const style = getComputedStyle(element);
    const matrix = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
    const ascentBeats = [...document.querySelectorAll(".ascent-beat")];
    const activeBeats = ascentBeats.filter((beat) => beat.classList.contains("is-active"));
    const otherVisibleBeats = ascentBeats
      .filter((beat) => beat !== element)
      .map((beat) => {
        const bounds = beat.getBoundingClientRect();
        return {
          name: beat.getAttribute("data-story-beat") ?? "unnamed",
          opacity: Number.parseFloat(getComputedStyle(beat).opacity),
          intersectsViewport: bounds.bottom > 0 && bounds.top < window.innerHeight,
        };
      })
      .filter((beat) => beat.intersectsViewport);
    return {
      opacity: Number.parseFloat(style.opacity),
      y: matrix.m42,
      visibility: style.visibility,
      isActive: element.classList.contains("is-active"),
      activeCount: activeBeats.length,
      activeNames: activeBeats.map((beat) => beat.getAttribute("data-story-beat") ?? "unnamed"),
      otherVisibleBeats,
      maximumOtherVisibleOpacity: Math.max(0, ...otherVisibleBeats.map((beat) => beat.opacity)),
    };
  }, selector);
}

function assertFocusedBeat(label, direction, name, state) {
  if (!state.isActive || state.activeCount !== 1) {
    failures.push(
      `${label}: ${name} does not own the single active ascent state on ${direction} scroll `
      + `(active: ${state.activeNames.join(", ") || "none"})`,
    );
  }
  if (state.maximumOtherVisibleOpacity > 0.1) {
    failures.push(
      `${label}: another in-viewport beat is too prominent beside ${name} on ${direction} scroll `
      + `(${state.otherVisibleBeats
        .filter((beat) => beat.opacity > 0.1)
        .map((beat) => `${beat.name} ${beat.opacity.toFixed(3)}`)
        .join(", ")})`,
    );
  }
}

async function readWorld(page) {
  return page.evaluate(() => {
    const styleNumber = (selector, property) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element)[property]) : -1;
    };
    const translateY = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      return transform === "none" ? 0 : new DOMMatrix(transform).m42;
    };
    const transformState = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      const matrix = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
      return {
        a: matrix.a,
        b: matrix.b,
        c: matrix.c,
        d: matrix.d,
        e: matrix.e,
        f: matrix.f,
      };
    };
    const cloudState = (side) => {
      const element = document.querySelector(`[data-rsvp-reveal-cloud="${side}"]`);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const transform = getComputedStyle(element).transform;
      const matrix = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
      return {
        x: matrix.e,
        y: matrix.f,
        xRatio: bounds.width > 0 ? matrix.e / bounds.width : null,
        yRatio: bounds.height > 0 ? matrix.f / bounds.height : null,
      };
    };
    const finalCopy = document.querySelector("[data-final-copy]");
    const finalStyle = finalCopy ? getComputedStyle(finalCopy) : null;
    const finalRect = finalCopy?.getBoundingClientRect() ?? null;
    const rsvpOpener = document.querySelector("[data-rsvp-open]");
    const rsvpStyle = rsvpOpener ? getComputedStyle(rsvpOpener) : null;
    const identityOpacities = [
      styleNumber(".final-names", "opacity"),
      styleNumber(".final-copy time", "opacity"),
      styleNumber(".final-copy > img", "opacity"),
    ];
    const skyWorld = document.querySelector(".sky-world");
    const skyWorldRect = skyWorld?.getBoundingClientRect() ?? null;
    const skyPicture = document.querySelector(".sky-picture");
    const skyRect = skyPicture?.getBoundingClientRect() ?? null;
    return {
      pavilionOpacity: styleNumber("[data-pavilion-assembly]", "opacity"),
      pavilionPreviewOpacity: styleNumber("[data-pavilion-preview] img", "opacity"),
      coupleOpacity: styleNumber("[data-couple]", "opacity"),
      finalOpacity: styleNumber("[data-final-copy]", "opacity"),
      titleOpacity: styleNumber(".final-message", "opacity"),
      identityOpacities,
      minimumIdentityOpacity: Math.min(...identityOpacities),
      attendanceOpacity: styleNumber(".attendance-request", "opacity"),
      ctaOpacity: styleNumber("[data-rsvp-open]", "opacity"),
      glintOpacity: styleNumber("[data-ring-glint]", "opacity"),
      finalVisibility: finalStyle?.visibility ?? "missing",
      ctaState: rsvpOpener
        ? {
            tabIndex: rsvpOpener.tabIndex,
            tabIndexAttribute: rsvpOpener.getAttribute("tabindex"),
            ariaHidden: rsvpOpener.getAttribute("aria-hidden"),
            ariaDisabled: rsvpOpener.getAttribute("aria-disabled"),
            pointerEvents: rsvpStyle.pointerEvents,
            visibility: rsvpStyle.visibility,
          }
        : null,
      rsvpCloudCount: document.querySelectorAll("[data-rsvp-reveal-cloud]").length,
      rsvpClouds: {
        left: cloudState("left"),
        right: cloudState("right"),
      },
      pavilionTransform: transformState("[data-pavilion-assembly]"),
      coupleTransform: transformState("[data-couple]"),
      finalCenterX: finalRect ? finalRect.left + finalRect.width / 2 - window.innerWidth / 2 : null,
      finalCenterY: finalRect ? finalRect.top + finalRect.height / 2 - window.innerHeight / 2 : null,
      skyPosition: skyWorld ? getComputedStyle(skyWorld).position : "missing",
      skyY: translateY(".sky-picture"),
      farCloudY: translateY(".pavilion-clouds [data-layer='back']"),
      skyAnimation: getComputedStyle(document.querySelector(".sky-picture img")).animationName,
      skyWorldOverscansViewport: skyWorldRect
        ? skyWorldRect.left <= -1
          && skyWorldRect.top <= -1
          && skyWorldRect.right >= window.innerWidth + 1
          && skyWorldRect.bottom >= window.innerHeight + 1
        : false,
      skyCoversViewport: skyRect
        ? skyRect.left <= 0 && skyRect.top <= 0 && skyRect.right >= window.innerWidth && skyRect.bottom >= window.innerHeight
        : false,
      openingOpacity: styleNumber("[data-opening-copy]", "opacity"),
      cueOpacity: styleNumber("[data-scroll-cue]", "opacity"),
    };
  });
}

function maximumTransformDelta(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  return Math.max(
    ...["a", "b", "c", "d", "e", "f"].map((property) => Math.abs(first[property] - second[property])),
  );
}

function ctaIsAvailable(state) {
  return Boolean(
    state
    && state.tabIndex === 0
    && state.tabIndexAttribute === "0"
    && state.ariaHidden === "false"
    && state.ariaDisabled === "false"
    && state.pointerEvents === "auto"
    && state.visibility === "visible",
  );
}

function ctaIsUnavailable(state) {
  return Boolean(
    state
    && state.tabIndex === -1
    && state.tabIndexAttribute === "-1"
    && state.ariaHidden === "true"
    && state.ariaDisabled === "true"
    && state.pointerEvents === "none",
  );
}

async function pollGlint(page, duration = 1800) {
  const startedAt = Date.now();
  let maximum = 0;
  while (Date.now() - startedAt < duration) {
    maximum = Math.max(maximum, await page.$eval("[data-ring-glint]", (element) => Number.parseFloat(getComputedStyle(element).opacity)));
    await wait(90);
  }
  return maximum;
}

try {
  for (const viewport of viewports) {
    const label = `${viewport.width}x${viewport.height}`;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600 });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
    await prepare(page);

    await animatedScroll(page, 0, 1, 1700);
    const worldTop = await readWorld(page);
    const forward = {};
    for (const [name, selector] of beats) {
      await centerElement(page, selector);
      forward[name] = await readBeat(page, selector);
      if (forward[name].opacity < 0.97 || Math.abs(forward[name].y) > 1.5) {
        failures.push(`${label}: ${name} is not fully readable when centred on forward scroll`);
      }
      assertFocusedBeat(label, "forward", name, forward[name]);
    }

    await phaseProgress(page, "#pavilion", 0);
    const pavilionStart = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.1);
    const pavilionDistant = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.72);
    const coupleSilhouette = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.82);
    const coupleReveal = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.83);
    const settledCouple = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.84, 60);
    const glintMaximum = await pollGlint(page);
    const coupleHold = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.91);
    const titleStage = await readWorld(page);
    await phaseProgress(page, "#pavilion", 0.95);
    const attendanceStage = await readWorld(page);
    await phaseProgress(page, "#pavilion", 1);
    const final = await readWorld(page);

    if (
      pavilionStart.pavilionOpacity > 0.03
      || pavilionStart.pavilionPreviewOpacity < 0.1
      || pavilionStart.pavilionPreviewOpacity > 0.2
    ) {
      failures.push(`${label}: distant pavilion continuity breaks at phase start`);
    }
    if (pavilionDistant.pavilionOpacity < 0.12 || pavilionDistant.pavilionOpacity > 0.8) {
      failures.push(`${label}: distant pavilion is not atmospheric`);
    }
    if (coupleSilhouette.coupleOpacity < 0.08 || coupleSilhouette.coupleOpacity > 0.82) {
      failures.push(`${label}: couple silhouette pacing is outside the intended window`);
    }
    if (coupleReveal.coupleOpacity < 0.68) failures.push(`${label}: couple is not fully revealed by 82%`);
    if (
      coupleHold.coupleOpacity < 0.68
      || coupleHold.titleOpacity > 0.08
      || coupleHold.attendanceOpacity > 0.08
      || coupleHold.ctaOpacity > 0.08
    ) {
      failures.push(`${label}: couple stillness/final-title ordering regressed`);
    }
    if (glintMaximum < 0.25) failures.push(`${label}: first ring glint was not observable in its hold window`);
    if (
      titleStage.titleOpacity < 0.8
      || titleStage.attendanceOpacity > 0.08
      || titleStage.ctaOpacity > 0.08
    ) {
      failures.push(`${label}: title is not staged ahead of attendance and RSVP`);
    }
    if (
      attendanceStage.titleOpacity < 0.9
      || attendanceStage.minimumIdentityOpacity < 0.9
      || attendanceStage.attendanceOpacity < 0.8
      || attendanceStage.ctaOpacity > 0.08
      || !ctaIsUnavailable(attendanceStage.ctaState)
    ) {
      failures.push(`${label}: attendance is not staged ahead of the RSVP reveal`);
    }
    const pavilionStillnessDelta = Math.max(
      maximumTransformDelta(settledCouple.pavilionTransform, coupleHold.pavilionTransform),
      maximumTransformDelta(settledCouple.pavilionTransform, titleStage.pavilionTransform),
      maximumTransformDelta(settledCouple.pavilionTransform, attendanceStage.pavilionTransform),
      maximumTransformDelta(settledCouple.pavilionTransform, final.pavilionTransform),
    );
    const coupleStillnessDelta = Math.max(
      maximumTransformDelta(settledCouple.coupleTransform, coupleHold.coupleTransform),
      maximumTransformDelta(settledCouple.coupleTransform, titleStage.coupleTransform),
      maximumTransformDelta(settledCouple.coupleTransform, attendanceStage.coupleTransform),
      maximumTransformDelta(settledCouple.coupleTransform, final.coupleTransform),
    );
    if (pavilionStillnessDelta > 0.75 || coupleStillnessDelta > 0.75) {
      failures.push(
        `${label}: pavilion/couple transform continued after the 82% settling point `
        + `(pavilion ${pavilionStillnessDelta.toFixed(2)}, couple ${coupleStillnessDelta.toFixed(2)})`,
      );
    }
    const coveredClouds = attendanceStage.rsvpClouds;
    const clearedClouds = final.rsvpClouds;
    const cloudsBeginCovered = Boolean(
      coveredClouds.left
      && coveredClouds.right
      && Math.abs(coveredClouds.left.x) < 1.5
      && Math.abs(coveredClouds.left.y) < 1.5
      && Math.abs(coveredClouds.right.x) < 1.5
      && Math.abs(coveredClouds.right.y) < 1.5,
    );
    const cloudsClearAsymmetrically = Boolean(
      clearedClouds.left
      && clearedClouds.right
      && clearedClouds.left.xRatio < -0.35
      && clearedClouds.right.xRatio > 0.35
      && clearedClouds.left.yRatio > 0.15
      && clearedClouds.right.yRatio > 0.15
      && (
        Math.abs(Math.abs(clearedClouds.left.xRatio) - Math.abs(clearedClouds.right.xRatio)) > 0.025
        || Math.abs(clearedClouds.left.yRatio - clearedClouds.right.yRatio) > 0.025
      ),
    );
    if (final.rsvpCloudCount !== 2 || !cloudsBeginCovered || !cloudsClearAsymmetrically) {
      failures.push(`${label}: RSVP is not cleared by two asymmetric lower clouds`);
    }
    if (
      final.titleOpacity < 0.9
      || final.minimumIdentityOpacity < 0.9
      || final.attendanceOpacity < 0.9
      || final.ctaOpacity < 0.9
      || Math.abs(final.finalCenterX ?? Number.POSITIVE_INFINITY) > 2
      || Math.abs(final.finalCenterY ?? Number.POSITIVE_INFINITY) > 2
      || !ctaIsAvailable(final.ctaState)
    ) {
      failures.push(`${label}: final copy/RSVP is not centred, visible, and interactive`);
    }

    await phaseProgress(page, "#pavilion", 0.95);
    const reversedHold = await readWorld(page);
    if (
      reversedHold.titleOpacity < 0.9
      || reversedHold.attendanceOpacity < 0.8
      || reversedHold.ctaOpacity > 0.08
      || !ctaIsUnavailable(reversedHold.ctaState)
      || Math.abs(reversedHold.rsvpClouds.left?.x ?? Number.POSITIVE_INFINITY) > 1.5
      || Math.abs(reversedHold.rsvpClouds.left?.y ?? Number.POSITIVE_INFINITY) > 1.5
      || Math.abs(reversedHold.rsvpClouds.right?.x ?? Number.POSITIVE_INFINITY) > 1.5
      || Math.abs(reversedHold.rsvpClouds.right?.y ?? Number.POSITIVE_INFINITY) > 1.5
    ) {
      failures.push(`${label}: RSVP clouds/CTA did not reverse to the covered non-interactive state`);
    }
    await phaseProgress(page, "#pavilion", 0.83);
    const reversedCoupleHold = await readWorld(page);
    if (
      reversedCoupleHold.titleOpacity > 0.08
      || reversedCoupleHold.attendanceOpacity > 0.08
      || reversedCoupleHold.ctaOpacity > 0.08
      || !ctaIsUnavailable(reversedCoupleHold.ctaState)
    ) {
      failures.push(`${label}: late pavilion copy retained stale state below its reveal thresholds`);
    }

    const reverse = {};
    for (const [name, selector] of [...beats].reverse()) {
      await centerElement(page, selector);
      reverse[name] = await readBeat(page, selector);
      const direct = forward[name];
      if (
        reverse[name].opacity < 0.97
        || Math.abs(reverse[name].y) > 1.5
        || Math.abs(reverse[name].opacity - direct.opacity) > 0.02
        || Math.abs(reverse[name].y - direct.y) > 1.5
      ) {
        failures.push(`${label}: ${name} retained a stale state after reversing from the pavilion`);
      }
      assertFocusedBeat(label, "reverse", name, reverse[name]);
      const world = await readWorld(page);
      if (
        world.pavilionOpacity > 0.03
        || world.pavilionPreviewOpacity > 0.03
        || world.coupleOpacity > 0.03
        || world.titleOpacity > 0.03
        || world.attendanceOpacity > 0.03
        || world.ctaOpacity > 0.03
        || !ctaIsUnavailable(world.ctaState)
      ) {
        failures.push(
          `${label}: pavilion state leaked back into the ${name} scene `
          + `(pavilion ${world.pavilionOpacity.toFixed(3)}, preview ${world.pavilionPreviewOpacity.toFixed(3)}, `
          + `couple ${world.coupleOpacity.toFixed(3)}, title ${world.titleOpacity.toFixed(3)}, `
          + `attendance ${world.attendanceOpacity.toFixed(3)}, CTA ${world.ctaOpacity.toFixed(3)})`,
        );
      }
    }

    for (const name of ["location", "doa", "story", "location", "story", "doa"]) {
      const selector = beats.find(([beatName]) => beatName === name)?.[1];
      await centerElement(page, selector, 700);
      const state = await readBeat(page, selector);
      if (state.opacity < 0.97 || Math.abs(state.y) > 1.5) {
        failures.push(`${label}: ${name} failed during repeated direction changes`);
      }
      assertFocusedBeat(label, "repeated-direction", name, state);
    }

    const maximumScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await animatedScroll(page, maximumScroll, 520, 1800);
    const worldBottom = await readWorld(page);
    await animatedScroll(page, 0, 520, 1800);
    const worldReturned = await readWorld(page);
    const skyTravel = Math.abs((worldBottom.skyY ?? 0) - (worldTop.skyY ?? 0));
    const farCloudTravel = Math.abs((worldBottom.farCloudY ?? 0) - (worldTop.farCloudY ?? 0));
    const maximumPlaneTravel = 0.75;

    if (worldTop.skyPosition !== "fixed") failures.push(`${label}: sky-world is no longer fixed`);
    if (skyTravel > maximumPlaneTravel) {
      failures.push(`${label}: sky wrapper accumulated ${skyTravel.toFixed(2)}px of document-scroll transform travel`);
    }
    if (farCloudTravel > maximumPlaneTravel) {
      failures.push(`${label}: far-cloud wrapper accumulated ${farCloudTravel.toFixed(2)}px of document-scroll transform travel`);
    }
    if (
      !worldTop.skyWorldOverscansViewport
      || !worldBottom.skyWorldOverscansViewport
      || !worldReturned.skyWorldOverscansViewport
      || !worldTop.skyCoversViewport
      || !worldBottom.skyCoversViewport
      || !worldReturned.skyCoversViewport
    ) {
      failures.push(`${label}: fixed sky world or picture plane exposed a viewport edge`);
    }
    if (
      Math.abs((worldReturned.skyY ?? 0) - (worldTop.skyY ?? 0)) > 0.75
      || Math.abs((worldReturned.farCloudY ?? 0) - (worldTop.farCloudY ?? 0)) > 0.75
    ) {
      failures.push(`${label}: sky or far clouds did not return to their initial position`);
    }
    if (worldReturned.openingOpacity < 0.95 || worldReturned.cueOpacity < 0.95) {
      failures.push(`${label}: arrival did not fully restore after bottom-to-top reversal`);
    }
    if (errors.length) failures.push(`${label}: ${errors.join(" | ")}`);

    results.push({
      viewport: label,
      skyTravel: Number(skyTravel.toFixed(2)),
      farCloudTravel: Number(farCloudTravel.toFixed(2)),
      glintMaximum: Number(glintMaximum.toFixed(2)),
      coupleSilhouetteOpacity: Number(coupleSilhouette.coupleOpacity.toFixed(3)),
      coupleRevealOpacity: Number(coupleReveal.coupleOpacity.toFixed(3)),
      pavilionStillnessDelta: Number(pavilionStillnessDelta.toFixed(3)),
      coupleStillnessDelta: Number(coupleStillnessDelta.toFixed(3)),
      finalStaging: {
        hold: {
          title: Number(coupleHold.titleOpacity.toFixed(3)),
          attendance: Number(coupleHold.attendanceOpacity.toFixed(3)),
          cta: Number(coupleHold.ctaOpacity.toFixed(3)),
        },
        title: {
          title: Number(titleStage.titleOpacity.toFixed(3)),
          attendance: Number(titleStage.attendanceOpacity.toFixed(3)),
          cta: Number(titleStage.ctaOpacity.toFixed(3)),
        },
        attendance: {
          title: Number(attendanceStage.titleOpacity.toFixed(3)),
          attendance: Number(attendanceStage.attendanceOpacity.toFixed(3)),
          cta: Number(attendanceStage.ctaOpacity.toFixed(3)),
        },
        final: {
          title: Number(final.titleOpacity.toFixed(3)),
          attendance: Number(final.attendanceOpacity.toFixed(3)),
          cta: Number(final.ctaOpacity.toFixed(3)),
          ctaState: final.ctaState,
        },
        reversedBelowReveal: {
          title: Number(reversedHold.titleOpacity.toFixed(3)),
          attendance: Number(reversedHold.attendanceOpacity.toFixed(3)),
          cta: Number(reversedHold.ctaOpacity.toFixed(3)),
          ctaState: reversedHold.ctaState,
        },
      },
      finalClouds: final.rsvpClouds,
      finalCenterOffset: [Number((final.finalCenterX ?? 0).toFixed(2)), Number((final.finalCenterY ?? 0).toFixed(2))],
      reverseBeatStates: Object.fromEntries(
        Object.entries(reverse).map(([name, state]) => [name, {
          opacity: Number(state.opacity.toFixed(3)),
          y: Number(state.y.toFixed(2)),
          isActive: state.isActive,
          activeCount: state.activeCount,
          maximumOtherVisibleOpacity: Number(state.maximumOtherVisibleOpacity.toFixed(3)),
        }]),
      ),
    });
    await page.close();
  }

  const reducedPage = await browser.newPage();
  await reducedPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await reducedPage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await reducedPage.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
  await prepare(reducedPage);
  const reducedTop = await readWorld(reducedPage);
  await phaseProgress(reducedPage, "#pavilion", 0.45, 300);
  const reducedPavilion = await readWorld(reducedPage);
  await phaseProgress(reducedPage, "#pavilion", 0.9, 300);
  const reducedFinal = await readWorld(reducedPage);
  await phaseProgress(reducedPage, "#pavilion", 0.6, 300);
  const reducedReversed = await readWorld(reducedPage);
  const reducedMaximum = await reducedPage.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await animatedScroll(reducedPage, reducedMaximum, 300, 300);
  const reducedBottom = await readWorld(reducedPage);
  if (
    Math.abs(reducedTop.skyY ?? 0) > 0.5
    || Math.abs(reducedBottom.skyY ?? 0) > 0.5
    || Math.abs(reducedTop.farCloudY ?? 0) > 0.5
    || Math.abs(reducedBottom.farCloudY ?? 0) > 0.5
    || reducedTop.skyAnimation !== "none"
  ) {
    failures.push("reduced motion: sky idle drift or scroll parallax remains active");
  }
  if (
    !ctaIsUnavailable(reducedTop.ctaState)
    || !ctaIsUnavailable(reducedPavilion.ctaState)
    || !ctaIsUnavailable(reducedReversed.ctaState)
  ) {
    failures.push("reduced motion: RSVP CTA is available outside the final state");
  }
  if (reducedFinal.finalOpacity < 0.9 || !ctaIsAvailable(reducedFinal.ctaState)) {
    failures.push("reduced motion: final message/RSVP CTA not revealed and available together");
  }
  await reducedPage.close();

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
