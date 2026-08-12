import { existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import puppeteer from "puppeteer-core";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/$/, "");
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the feature audit.");

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const silentWav = (seconds = 12) => {
  const sampleRate = 8_000;
  const bytesPerSample = 2;
  const dataSize = sampleRate * seconds * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
};
const fixtureAudioUrl = `data:audio/wav;base64,${silentWav().toString("base64")}`;
const androidUserAgent = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/140.0.0.0 Mobile Safari/537.36",
].join(" ");

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const failures = [];
const results = {};

const fail = (scope, message) => failures.push(`${scope}: ${message}`);
const readCountdown = (page) => page.evaluate(() => {
  const read = (selector) => document.querySelector(selector)?.textContent?.trim() ?? "";
  const countdown = document.querySelector("[data-wedding-countdown]");
  return {
    target: countdown?.getAttribute("data-countdown-target") ?? "",
    days: read("[data-countdown-days]"),
    hours: read("[data-countdown-hours]"),
    minutes: read("[data-countdown-minutes]"),
    seconds: read("[data-countdown-seconds]"),
  };
});
const countdownParts = (value) => [value.days, value.hours, value.minutes, value.seconds];
const countdownIsPlaceholder = (value) => countdownParts(value).every((part) => part === "--");
const countdownIsNumeric = (value) => countdownParts(value).every((part) => /^\d+$/.test(part));
const countdownTotal = (value) =>
  Number(value.days) * 86_400
  + Number(value.hours) * 3_600
  + Number(value.minutes) * 60
  + Number(value.seconds);
const sameCountdownDisplay = (first, second) =>
  countdownParts(first).every((part, index) => part === countdownParts(second)[index]);
const deliberatelyOpenRsvp = async (page) => {
  await page.evaluate((duration) => new Promise((resolve) => {
    const start = window.scrollY;
    const destination = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const startedAt = performance.now();
    const frame = (time) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      window.scrollTo({ top: start + (destination - start) * eased, behavior: "instant" });
      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  }), 760);
  await wait(1_400);
  await page.mouse.wheel({ deltaY: 2_400 });
  await page.evaluate(() => window.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "instant" }));
  await wait(500);
  await page.waitForFunction(
    () => {
      const opener = document.querySelector("[data-rsvp-open]");
      return opener instanceof HTMLElement
        && opener.getAttribute("aria-disabled") !== "true"
        && opener.tabIndex >= 0;
    },
    { timeout: 8_000 },
  );
  await page.$eval("[data-rsvp-open]", (opener) => opener.click());
  await page.waitForFunction(
    () => document.documentElement.classList.contains("is-rsvp-open")
      && !document.documentElement.classList.contains("is-rsvp-transitioning")
      && document.querySelector("[data-rsvp-scene]")?.getAttribute("aria-hidden") === "false",
    { timeout: 5_000 },
  );
};

try {
  const page = await browser.newPage();
  await page.setUserAgent({ userAgent: androidUserAgent, platform: "Android" });
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  let audioRequests = 0;
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (new URL(request.url()).pathname.endsWith("/assets/audio/our-song.mp3")) {
      audioRequests += 1;
      await request.respond({
        status: 200,
        contentType: "audio/wav",
        headers: { "cache-control": "public, max-age=3600" },
        body: silentWav(),
      });
      return;
    }
    await request.continue();
  });

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });

  const initialMusic = await page.evaluate(() => {
    const audio = document.querySelector("[data-music-audio]");
    const toggle = document.querySelector("[data-music-toggle]");
    const control = document.querySelector("[data-music-control]");
    return {
      exists: audio instanceof HTMLAudioElement && toggle instanceof HTMLButtonElement,
      paused: audio instanceof HTMLAudioElement ? audio.paused : false,
      currentTime: audio instanceof HTMLAudioElement ? audio.currentTime : -1,
      autoplayAttribute: audio?.hasAttribute("autoplay") ?? true,
      preload: audio instanceof HTMLAudioElement ? audio.preload : "",
      expanded: control?.getAttribute("data-music-expanded"),
      ariaExpanded: toggle?.getAttribute("aria-expanded"),
      label: toggle?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });
  if (!initialMusic.exists) fail("music", "control or audio element is missing");
  if (!initialMusic.paused || initialMusic.currentTime !== 0 || initialMusic.autoplayAttribute) {
    fail("music", "audio was not idle on initial load");
  }
  if (initialMusic.preload !== "none") fail("music", `audio preload was ${initialMusic.preload || "unset"}, not none`);
  if (audioRequests !== 0) fail("music", "audio source was requested before deliberate playback");
  if (!initialMusic.label.toLowerCase().includes("click to play our song")) {
    fail("music", "initial control does not invite an explicit click to play");
  }
  if (initialMusic.expanded !== "false" || initialMusic.ariaExpanded !== "false") {
    fail("music", "control was not collapsed on initial load");
  }

  const hiddenCountdownBefore = await readCountdown(page);
  await wait(1_100);
  const hiddenCountdownAfter = await readCountdown(page);
  if (!countdownIsPlaceholder(hiddenCountdownBefore)) {
    fail("countdown", "hidden RSVP countdown did not retain its placeholder state");
  }
  if (!sameCountdownDisplay(hiddenCountdownBefore, hiddenCountdownAfter)) {
    fail("countdown", "hidden RSVP countdown changed before a deliberate open");
  }

  await page.$eval("[data-music-audio]", (audio, source) => {
    audio.src = source;
  }, fixtureAudioUrl);

  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "playing",
    { timeout: 5_000 },
  );
  const expandedAfterPlay = await page.$eval(
    "[data-music-control]",
    (control) => control.getAttribute("data-music-expanded"),
  );
  if (expandedAfterPlay !== "true") fail("music", "first tap did not expand the control");
  await page.$eval("[data-music-audio]", (audio) => {
    if (Number.isFinite(audio.duration) && audio.duration > 2) audio.currentTime = 1;
  });
  await wait(100);
  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "paused",
  );
  const pausedState = await page.$eval("[data-music-audio]", (audio) => ({
    paused: audio.paused,
    currentTime: audio.currentTime,
    expanded: document.querySelector("[data-music-control]")?.getAttribute("data-music-expanded"),
    ariaExpanded: document.querySelector("[data-music-toggle]")?.getAttribute("aria-expanded"),
  }));
  const pausedPosition = pausedState.currentTime;
  if (!pausedState.paused || pausedPosition < 0.9) fail("music", "explicit pause did not retain playback position");
  if (pausedState.expanded !== "false" || pausedState.ariaExpanded !== "false") {
    fail("music", "second tap did not collapse the control");
  }

  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "playing",
    { timeout: 5_000 },
  );
  await wait(200);
  const resumedPosition = await page.$eval("[data-music-audio]", (audio) => audio.currentTime);
  if (resumedPosition + 0.05 < pausedPosition) fail("music", "resume restarted the track from the beginning");
  await wait(4_100);
  const timedCollapse = await page.$eval("[data-music-audio]", (audio) => ({
    paused: audio.paused,
    currentTime: audio.currentTime,
    expanded: document.querySelector("[data-music-control]")?.getAttribute("data-music-expanded"),
    ariaExpanded: document.querySelector("[data-music-toggle]")?.getAttribute("aria-expanded"),
  }));
  if (timedCollapse.expanded !== "false" || timedCollapse.ariaExpanded !== "false" || timedCollapse.paused) {
    fail("music", "idle timeout did not collapse the control while preserving playback");
  }
  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await wait(150);
  const reopenedPlaying = await page.$eval("[data-music-audio]", (audio) => ({
    paused: audio.paused,
    currentTime: audio.currentTime,
    expanded: document.querySelector("[data-music-control]")?.getAttribute("data-music-expanded"),
  }));
  if (
    reopenedPlaying.expanded !== "true"
    || reopenedPlaying.paused
    || reopenedPlaying.currentTime + 0.05 < timedCollapse.currentTime
  ) {
    fail("music", "reopening the timed-out control interrupted active playback");
  }
  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "paused",
  );

  await page.reload({ waitUntil: "networkidle0" });
  await page.$eval("[data-music-audio]", (audio, source) => {
    audio.src = source;
  }, fixtureAudioUrl);
  const reloadMusic = await page.evaluate(() => {
    const audio = document.querySelector("[data-music-audio]");
    return {
      paused: audio instanceof HTMLAudioElement ? audio.paused : false,
      state: document.querySelector("[data-music-control]")?.getAttribute("data-music-state"),
    };
  });
  if (!reloadMusic.paused || reloadMusic.state === "playing") {
    fail("music", "session persistence caused autoplay after reload");
  }
  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "playing",
    { timeout: 5_000 },
  );
  await wait(150);
  const sessionResumePosition = await page.$eval("[data-music-audio]", (audio) => audio.currentTime);
  if (sessionResumePosition + 0.1 < resumedPosition) {
    fail("music", "stored session position was not restored after an explicit replay click");
  }
  await page.$eval("[data-music-toggle]", (toggle) => toggle.click());

  await deliberatelyOpenRsvp(page);
  const openedCountdownBefore = await readCountdown(page);
  const expectedCountdown = Math.max(
    0,
    Math.floor((Date.parse(openedCountdownBefore.target) - Date.now()) / 1_000),
  );
  if (!countdownIsNumeric(openedCountdownBefore)) {
    fail("countdown", "countdown did not calculate immediately after RSVP opened");
  } else if (Math.abs(countdownTotal(openedCountdownBefore) - expectedCountdown) > 2) {
    fail("countdown", "opened countdown does not match the centralized ISO target");
  }
  await wait(1_100);
  const openedCountdownAfter = await readCountdown(page);
  const countdownStep = countdownTotal(openedCountdownBefore) - countdownTotal(openedCountdownAfter);
  if (!countdownIsNumeric(openedCountdownAfter) || countdownStep < 1 || countdownStep > 2) {
    fail("countdown", `open RSVP one-second update advanced by ${countdownStep}s`);
  }

  const genericRsvp = await page.evaluate(() => {
    const scene = document.querySelector("[data-rsvp-scene]");
    const countdown = scene?.querySelector("[data-wedding-countdown]");
    const form = scene?.querySelector("form");
    const assistance = scene?.querySelector(".rsvp-assistance");
    const music = document.querySelector("[data-music-control]");
    const comesBefore = (first, second) => Boolean(
      first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return {
      open: scene?.getAttribute("aria-hidden") === "false" && !scene?.hasAttribute("inert"),
      assistanceExists: assistance instanceof HTMLElement,
      ordered: comesBefore(countdown, form) && (!assistance || comesBefore(form, assistance)),
      scrollable: scene instanceof HTMLElement
        && getComputedStyle(scene).overflowY === "auto"
        && scene.scrollHeight > scene.clientHeight,
      musicHidden: music instanceof HTMLElement
        && ["hidden", "collapse"].includes(getComputedStyle(music).visibility),
    };
  });
  if (!genericRsvp.open || !genericRsvp.ordered || !genericRsvp.scrollable) {
    fail("rsvp", "gated RSVP content order or internal scrolling regressed");
  }
  if (genericRsvp.assistanceExists) fail("variants", "generic invitation rendered a family contact section");
  if (!genericRsvp.musicHidden) fail("music", "music pill remained visible behind the RSVP dialog");

  await page.$eval("[data-rsvp-close]", (control) => control.click());
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("is-rsvp-open")
      && document.querySelector("[data-rsvp-scene]")?.getAttribute("aria-hidden") === "true",
    { timeout: 5_000 },
  );
  const closedCountdownBefore = await readCountdown(page);
  await wait(1_100);
  const closedCountdownAfter = await readCountdown(page);
  if (!sameCountdownDisplay(closedCountdownBefore, closedCountdownAfter)) {
    fail("countdown", "countdown continued updating after RSVP closed");
  }

  await page.goto(`${baseUrl}/invite/ABC123/`, { waitUntil: "networkidle0" });
  const groomVariant = await page.evaluate(() => {
    const assistance = document.querySelector(".rsvp-assistance");
    const entries = Array.from(assistance?.querySelectorAll("li") ?? [], (item) => {
      const label = item.querySelector("span")?.textContent?.trim() ?? "";
      const name = item.querySelector("strong")?.textContent?.trim() ?? "";
      const link = item.querySelector("a");
      const phone = link?.textContent?.trim() ?? "";
      const href = link?.getAttribute("href")?.trim() ?? "";
      return {
        label,
        name,
        phone,
        href,
        complete: Boolean(label && name && phone && /^tel:\+?\d+$/.test(href)),
      };
    });
    return {
      exists: assistance instanceof HTMLElement,
      side: assistance?.getAttribute("data-contact-side"),
      heading: assistance?.querySelector("h3")?.textContent?.trim() ?? "",
      entries,
    };
  });
  if (groomVariant.exists) {
    if (!["bride", "groom"].includes(groomVariant.side ?? "")) {
      fail("variants", "contact section rendered for an invalid invitation side");
    }
    if (!groomVariant.heading.toLowerCase().includes(groomVariant.side ?? "")) {
      fail("variants", "contact heading does not match the valid invitation side");
    }
    if (groomVariant.entries.some((entry) => !entry.complete)) {
      fail("variants", "contact section rendered an incomplete contact entry");
    }
    fail("variants", "invite ABC123 rendered contacts even though its sample phone numbers are blank");
  }

  results.music = {
    noAutoplay: initialMusic.paused && !initialMusic.autoplayAttribute,
    preloadNone: initialMusic.preload === "none",
    collapsedByDefault: initialMusic.expanded === "false",
    manualCollapse: pausedState.expanded === "false",
    autoCollapse: timedCollapse.expanded === "false",
    playingWhileCollapsed: timedCollapse.expanded === "false" && !timedCollapse.paused,
    explicitPlayAndPause: pausedState.paused && pausedPosition >= 0.9,
    resumePosition: Number(resumedPosition.toFixed(2)),
    sessionResumePosition: Number(sessionResumePosition.toFixed(2)),
    audioRequests,
  };
  results.countdown = {
    target: openedCountdownBefore.target,
    placeholderWhileHidden: countdownIsPlaceholder(hiddenCountdownBefore)
      && sameCountdownDisplay(hiddenCountdownBefore, hiddenCountdownAfter),
    openedSecondsRemaining: countdownTotal(openedCountdownBefore),
    oneSecondStep: countdownStep,
    pausedAfterClose: sameCountdownDisplay(closedCountdownBefore, closedCountdownAfter),
  };
  results.variants = {
    genericContactsHidden: !genericRsvp.assistanceExists,
    inviteABC123ContactsHidden: !groomVariant.exists,
  };
  results.rsvp = {
    open: genericRsvp.open,
    internallyScrollable: genericRsvp.scrollable,
    contentOrderValid: genericRsvp.ordered,
  };
  await page.close();

  const completedPage = await browser.newPage();
  await completedPage.setUserAgent({ userAgent: androidUserAgent, platform: "Android" });
  await completedPage.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await completedPage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await completedPage.evaluateOnNewDocument(() => {
    const realDateNow = Date.now.bind(Date);
    const offset = Date.parse("2027-06-16T11:00:00+08:00") - realDateNow();
    Date.now = () => realDateNow() + offset;
  });
  await completedPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const completedHiddenState = await readCountdown(completedPage);
  if (!countdownIsPlaceholder(completedHiddenState)) {
    fail("countdown", "past-date countdown evaluated while RSVP was still hidden");
  }
  await deliberatelyOpenRsvp(completedPage);
  const completedState = await completedPage.evaluate(() => ({
    gridHidden: document.querySelector("[data-countdown-grid]")?.hasAttribute("hidden") ?? false,
    messageHidden: document.querySelector("[data-countdown-message]")?.hasAttribute("hidden") ?? true,
    message: document.querySelector("[data-countdown-message]")?.textContent?.trim() ?? "",
  }));
  if (!completedState.gridHidden || completedState.messageHidden || !completedState.message) {
    fail("countdown", "past-date fallback was not graceful after RSVP opened");
  }
  results.countdown.completedMessage = completedState.message;
  await completedPage.close();

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
