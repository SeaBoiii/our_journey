import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the RSVP gating audit.");

const selectors = {
  open: "[data-rsvp-open]",
  close: "[data-rsvp-close]",
  scene: "[data-rsvp-scene]",
  journey: "[data-journey-root]",
  pavilion: "[data-pavilion-assembly]",
  couple: "[data-couple]",
  final: "[data-final-copy]",
};

const androidUserAgent = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/140.0.0.0 Mobile Safari/537.36",
].join(" ");

const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const failures = [];
const warnings = [];
const errors = [];
const results = {};
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const fail = (test, message) => failures.push(`${test}: ${message}`);

page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function preparePage() {
  await page.setUserAgent({ userAgent: androidUserAgent, platform: "Android" });
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "no-preference" },
  ]);
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
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
  await wait(900);
}

async function readState() {
  return page.evaluate((selectors) => {
    const elementVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      let effectiveOpacity = 1;
      let current = element;
      while (current && effectiveOpacity > 0.01) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        effectiveOpacity *= Number.parseFloat(style.opacity) || 0;
        current = current.parentElement;
      }
      return effectiveOpacity > 0.01
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
    };
    const matrix = (element) => {
      if (!element) return null;
      const transform = getComputedStyle(element).transform;
      const value = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
      return {
        a: value.a,
        b: value.b,
        c: value.c,
        d: value.d,
        x: value.e,
        y: value.f,
      };
    };
    const visual = (element) => {
      if (!element) return { exists: false };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        exists: true,
        visible: elementVisible(element),
        opacity: Number.parseFloat(style.opacity),
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        rect: {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        matrix: matrix(element),
      };
    };

    const scene = document.querySelector(selectors.scene);
    const journey = document.querySelector(selectors.journey);
    const open = document.querySelector(selectors.open);
    const close = document.querySelector(selectors.close);
    const final = document.querySelector(selectors.final);
    const pavilion = document.querySelector(selectors.pavilion);
    const couple = document.querySelector(selectors.couple);
    const sceneStyle = scene ? getComputedStyle(scene) : null;
    const sceneRect = scene?.getBoundingClientRect() ?? null;
    const firstControl = scene?.querySelector(
      "input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea:not(:disabled), form button:not(:disabled)",
    );
    const firstControlState = visual(firstControl);
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    return {
      url: window.location.href,
      pathname: window.location.pathname,
      hash: window.location.hash,
      historyLength: window.history.length,
      historyState: window.history.state,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      maximumScroll,
      atDocumentBottom: Math.abs(window.scrollY - maximumScroll) <= 2,
      body: {
        position: bodyStyle.position,
        top: bodyStyle.top,
        width: bodyStyle.width,
        overflowY: bodyStyle.overflowY,
      },
      htmlOverflowY: htmlStyle.overflowY,
      backgroundLocked: bodyStyle.position === "fixed"
        || ["hidden", "clip"].includes(bodyStyle.overflowY)
        || ["hidden", "clip"].includes(htmlStyle.overflowY),
      journey: {
        exists: Boolean(journey),
        inert: Boolean(journey?.inert || journey?.hasAttribute("inert")),
        ariaHidden: journey?.getAttribute("aria-hidden"),
      },
      scene: scene
        ? {
            ...visual(scene),
            position: sceneStyle.position,
            ariaHidden: scene.getAttribute("aria-hidden"),
            ariaModal: scene.getAttribute("aria-modal"),
            role: scene.getAttribute("role"),
            inert: Boolean(scene.inert || scene.hasAttribute("inert")),
            coversViewport: sceneRect.left <= 1
              && sceneRect.top <= 1
              && sceneRect.right >= window.innerWidth - 1
              && sceneRect.bottom >= window.innerHeight - 1,
            scrollTop: scene.scrollTop,
            scrollHeight: scene.scrollHeight,
            clientHeight: scene.clientHeight,
          }
        : { exists: false },
      open: visual(open),
      close: visual(close),
      firstControl: {
        ...firstControlState,
        disabled: firstControl ? Boolean(firstControl.disabled) : null,
        tabIndex: firstControl?.tabIndex ?? null,
      },
      activeElementInsideScene: Boolean(scene?.contains(document.activeElement)),
      activeElementName: document.activeElement?.getAttribute("name")
        || document.activeElement?.getAttribute("data-rsvp-close")
        || document.activeElement?.id
        || document.activeElement?.tagName
        || null,
      final: visual(final),
      pavilion: visual(pavilion),
      couple: visual(couple),
    };
  }, selectors);
}

async function animatedScrollToBottom(duration = 760, settle = 1400) {
  await page.evaluate((duration) => new Promise((resolve) => {
    const start = window.scrollY;
    const destination = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const startedAt = performance.now();
    const frame = (time) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.scrollTo({ top: start + (destination - start) * eased, behavior: "instant" });
      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  }), duration);
  await wait(settle);
}

async function swipeUp() {
  const client = await page.createCDPSession();
  try {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 195, y: 760, radiusX: 4, radiusY: 4, force: 1 }],
    });
    for (const y of [650, 525, 400, 275, 150, 80]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 195, y, radiusX: 4, radiusY: 4, force: 1 }],
      });
      await wait(18);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await client.detach();
  }
  await wait(350);
}

async function attemptFurtherDocumentScroll() {
  await page.mouse.move(195, 760);
  await page.mouse.wheel({ deltaY: 2400 });
  await wait(180);
  await swipeUp();
  await page.evaluate(() => window.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "instant" }));
  await wait(500);
}

async function waitForScene(open) {
  await page.waitForFunction(
    ({ selector, open }) => {
      const scene = document.querySelector(selector);
      if (!scene) return false;
      const style = getComputedStyle(scene);
      const rect = scene.getBoundingClientRect();
      const visiblyOpen = style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.9
        && style.pointerEvents !== "none"
        && rect.bottom > 0
        && rect.top < window.innerHeight;
      return open
        ? visiblyOpen
        : style.visibility === "hidden"
          && Number.parseFloat(style.opacity) < 0.05
          && style.pointerEvents === "none";
    },
    { timeout: 5000, polling: "raf" },
    { selector: selectors.scene, open },
  );
  await wait(250);
}

function assertSceneHidden(test, state) {
  if (!state.scene.exists) {
    fail(test, `missing ${selectors.scene}`);
    return;
  }
  if (state.scene.visible || state.scene.opacity > 0.05 || state.scene.pointerEvents !== "none") {
    fail(test, "RSVP scene is visible or interactive before explicit activation");
  }
  if (state.scene.ariaHidden !== "true" && !state.scene.inert) {
    fail(test, "hidden RSVP scene is not aria-hidden or inert");
  }
  if (state.firstControl.visible) {
    fail(test, "an RSVP form control is visible before explicit activation");
  }
}

function maximumMatrixDifference(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const linearDifference = Math.max(
    ...["a", "b", "c", "d"].map((key) => Math.abs(left[key] - right[key]) * 100),
  );
  const translationDifference = Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
  return Math.max(linearDifference, translationDifference);
}

function assertPavilionRestored(test, before, after) {
  if (Math.abs(after.scrollY - before.scrollY) > 1.5) {
    fail(test, `invitation scroll was not restored exactly (${before.scrollY.toFixed(1)} -> ${after.scrollY.toFixed(1)})`);
  }
  if (!after.final.visible || after.final.opacity < 0.9 || !after.pavilion.visible) {
    fail(test, "final pavilion composition is not visible after returning from RSVP");
  }
  if (Math.abs(after.final.opacity - before.final.opacity) > 0.03) {
    fail(test, "final-copy opacity did not restore to its pre-RSVP state");
  }
  if (maximumMatrixDifference(after.final.matrix, before.final.matrix) > 1.5) {
    fail(test, "final-copy transform did not restore to its pre-RSVP state");
  }
  if (maximumMatrixDifference(after.pavilion.matrix, before.pavilion.matrix) > 1.5) {
    fail(test, "pavilion transform did not restore to its pre-RSVP state");
  }
  if (Math.abs(after.pavilion.opacity - before.pavilion.opacity) > 0.03) {
    fail(test, "pavilion opacity did not restore to its pre-RSVP state");
  }
  if (after.backgroundLocked || after.body.position === "fixed") {
    fail(test, "background scroll lock remained active after closing RSVP");
  }
  assertSceneHidden(test, after);
}

async function scrollRsvpInternally() {
  return page.evaluate((sceneSelector) => {
    const scene = document.querySelector(sceneSelector);
    if (!scene) return { exists: false };
    const explicit = scene.querySelector("[data-rsvp-scroll]");
    const candidates = [explicit, scene, ...scene.querySelectorAll("*")].filter(Boolean);
    const container = candidates.find((element) => {
      const style = getComputedStyle(element);
      return element.scrollHeight > element.clientHeight + 4
        && ["auto", "scroll"].includes(style.overflowY);
    });
    if (!container) {
      return {
        exists: false,
        sceneScrollHeight: scene.scrollHeight,
        sceneClientHeight: scene.clientHeight,
      };
    }
    const maximum = container.scrollHeight - container.clientHeight;
    const target = Math.min(maximum, Math.max(180, container.clientHeight * 0.55));
    container.scrollTop = target;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      exists: true,
      maximum,
      requested: target,
      scrollTop: container.scrollTop,
      explicit: container.hasAttribute("data-rsvp-scroll"),
      isScene: container === scene,
    };
  }, selectors.scene);
}

try {
  await preparePage();

  const contract = await page.evaluate((selectors) => ({
    open: Boolean(document.querySelector(selectors.open)),
    close: Boolean(document.querySelector(selectors.close)),
    closeCount: document.querySelectorAll(selectors.close).length,
    closeInFooter: Boolean(document.querySelector(`.site-footer ${selectors.close}`)),
    topClose: Boolean(document.querySelector(".rsvp-back")),
    scene: Boolean(document.querySelector(selectors.scene)),
    journey: Boolean(document.querySelector(selectors.journey)),
  }), selectors);
  results.contract = contract;

  for (const key of ["open", "close", "scene"]) {
    if (!contract[key]) fail("contract", `missing required selector ${selectors[key]}`);
  }
  if (contract.closeCount !== 1 || !contract.closeInFooter || contract.topClose) {
    fail("contract", "RSVP must expose exactly one return action at the end of the scene");
  }

  if (contract.open && contract.close && contract.scene) {
    // Test A: normal document scrolling must end at the final pavilion.
    await animatedScrollToBottom();
    const bottom = await readState();
    if (!bottom.atDocumentBottom) fail("A", "document bottom was not reached");
    if (!bottom.final.visible || bottom.final.opacity < 0.9 || !bottom.pavilion.visible) {
      fail("A", "document bottom does not show the final pavilion composition");
    }
    if (!bottom.open.visible || bottom.open.pointerEvents === "none") {
      fail("A", "RSVP activation control is not available in the final composition");
    }
    if (bottom.scene.position !== "fixed") {
      fail("A", `RSVP scene contributes to normal flow (position is ${bottom.scene.position})`);
    }
    assertSceneHidden("A", bottom);

    await attemptFurtherDocumentScroll();
    const afterFurtherScroll = await readState();
    if (!afterFurtherScroll.atDocumentBottom || Math.abs(afterFurtherScroll.scrollY - bottom.scrollY) > 2) {
      fail("A", "further wheel/touch/programmatic scrolling moved beyond the invitation ending");
    }
    if (Math.abs(afterFurtherScroll.scrollHeight - bottom.scrollHeight) > 1) {
      fail("A", "document height changed while attempting to scroll beyond the pavilion");
    }
    if (!afterFurtherScroll.final.visible || afterFurtherScroll.final.opacity < 0.9) {
      fail("A", "further scrolling displaced the final pavilion composition");
    }
    assertSceneHidden("A", afterFurtherScroll);
    results.testA = { bottom, afterFurtherScroll };

    // Test B: the button alone opens a fixed scene and locks the invitation.
    const invitationEnding = afterFurtherScroll;
    await page.click(selectors.open);
    await waitForScene(true);
    const opened = await readState();
    if (!opened.scene.visible || !opened.scene.coversViewport || opened.scene.position !== "fixed") {
      fail("B", "RSVP did not open as a full-viewport fixed scene");
    }
    if (!opened.firstControl.visible || opened.firstControl.disabled || opened.firstControl.tabIndex < 0) {
      fail("B", "first RSVP form control is not visible and interactive");
    }
    if (opened.scene.ariaHidden === "true" || opened.scene.inert) {
      fail("B", "open RSVP scene remains hidden or inert to assistive technology");
    }
    if (!opened.close.exists || opened.close.pointerEvents === "none") {
      fail("B", "RSVP end return control is missing or non-interactive");
    }
    if (!opened.backgroundLocked) fail("B", "invitation background has no active scroll lock");
    if (opened.body.position === "fixed") {
      const lockedOffset = Number.parseFloat(opened.body.top);
      if (!Number.isFinite(lockedOffset) || Math.abs(lockedOffset + invitationEnding.scrollY) > 2) {
        fail("B", "fixed-body lock did not retain the invitation's exact scroll offset");
      }
    }
    if (!opened.journey.inert) warnings.push("B: background invitation should be inert while RSVP is open");
    if (!opened.activeElementInsideScene) fail("B", "focus was not moved into the RSVP scene");
    if (opened.scene.role !== "dialog" || opened.scene.ariaModal !== "true") {
      warnings.push("B: RSVP scene should expose role=dialog and aria-modal=true");
    }

    const lockedBackground = opened;
    await swipeUp();
    const afterLockedSwipe = await readState();
    if (Math.abs(afterLockedSwipe.scrollY - lockedBackground.scrollY) > 1) {
      fail("B", "background document scroll changed while RSVP was open");
    }
    if (maximumMatrixDifference(afterLockedSwipe.pavilion.matrix, lockedBackground.pavilion.matrix) > 0.75) {
      fail("B", "background pavilion moved while interacting with the RSVP scene");
    }
    results.testB = { opened, afterLockedSwipe };

    // Test C1: internal RSVP scrolling followed by the UI close restores the ending.
    const internalScroll = await scrollRsvpInternally();
    await wait(180);
    if (!internalScroll.exists || internalScroll.scrollTop < 100) {
      fail("C/ui-close", "RSVP content does not scroll internally on mobile");
    }
    const beforeUiClose = await readState();
    await page.click(selectors.close);
    await waitForScene(false);
    const afterUiClose = await readState();
    assertPavilionRestored("C/ui-close", invitationEnding, afterUiClose);

    // Test C2: reopening and using browser Back must close in-place and restore exactly.
    await page.click(selectors.open);
    await waitForScene(true);
    const reopened = await readState();
    const hasRsvpHistoryState = reopened.hash === "#rsvp"
      && reopened.historyState?.rsvpOpen === true;
    if (!hasRsvpHistoryState) {
      fail("C/browser-back", "opening RSVP did not push { rsvpOpen: true } at #rsvp");
    }
    await scrollRsvpInternally();
    await wait(120);

    if (hasRsvpHistoryState) {
      const expectedPathname = reopened.pathname;
      await page.evaluate(() => window.history.back());
      await waitForScene(false);
      const afterBrowserBack = await readState();
      if (afterBrowserBack.pathname !== expectedPathname) {
        fail("C/browser-back", "browser Back navigated away from the invitation");
      }
      assertPavilionRestored("C/browser-back", invitationEnding, afterBrowserBack);
      results.testC = {
        internalScroll,
        beforeUiClose,
        afterUiClose,
        reopened,
        afterBrowserBack,
      };
    } else {
      await page.click(selectors.close);
      await waitForScene(false);
      results.testC = { internalScroll, beforeUiClose, afterUiClose, reopened };
    }
  }

  // Test D runs from a fresh invitation state and removes all CTA access.
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
  await wait(700);
  const dContract = await page.evaluate((selectors) => ({
    open: Boolean(document.querySelector(selectors.open)),
    scene: Boolean(document.querySelector(selectors.scene)),
  }), selectors);
  if (dContract.open && dContract.scene) {
    await page.evaluate((openSelector) => {
      const open = document.querySelector(openSelector);
      open.style.display = "none";
    }, selectors.open);
    await animatedScrollToBottom();
    await attemptFurtherDocumentScroll();
    const buttonHidden = await readState();
    assertSceneHidden("D/hidden", buttonHidden);
    if (!buttonHidden.atDocumentBottom || !buttonHidden.final.visible) {
      fail("D/hidden", "hiding the RSVP button changed the gated pavilion ending");
    }

    await page.evaluate((openSelector) => document.querySelector(openSelector)?.remove(), selectors.open);
    await attemptFurtherDocumentScroll();
    const buttonRemoved = await readState();
    assertSceneHidden("D/removed", buttonRemoved);
    if (!buttonRemoved.atDocumentBottom || !buttonRemoved.final.visible) {
      fail("D/removed", "removing the RSVP button allowed scrolling past the pavilion");
    }
    results.testD = { buttonHidden, buttonRemoved };
  } else {
    if (!dContract.open) fail("D", `missing required selector ${selectors.open}`);
    if (!dContract.scene) fail("D", `missing required selector ${selectors.scene}`);
  }

  if (errors.length) failures.push(`browser errors: ${errors.join(" | ")}`);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    viewport: "390x844",
    selectors,
    results,
    warnings,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
