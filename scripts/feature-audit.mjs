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

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const failures = [];
const results = {};

const fail = (scope, message) => failures.push(`${scope}: ${message}`);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });

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
      expanded: control?.getAttribute("data-music-expanded"),
      ariaExpanded: toggle?.getAttribute("aria-expanded"),
      label: toggle?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });
  if (!initialMusic.exists) fail("music", "control or audio element is missing");
  if (!initialMusic.paused || initialMusic.currentTime !== 0 || initialMusic.autoplayAttribute) {
    fail("music", "audio was not idle on initial load");
  }
  if (!initialMusic.label.toLowerCase().includes("click to play our song")) {
    fail("music", "initial control does not invite an explicit click to play");
  }
  if (initialMusic.expanded !== "false" || initialMusic.ariaExpanded !== "false") {
    fail("music", "control was not collapsed on initial load");
  }

  const countdownBefore = await page.evaluate(() => {
    const read = (selector) => Number(document.querySelector(selector)?.textContent ?? Number.NaN);
    const target = document.querySelector("[data-wedding-countdown]")?.getAttribute("data-countdown-target") ?? "";
    return {
      target,
      days: read("[data-countdown-days]"),
      hours: read("[data-countdown-hours]"),
      minutes: read("[data-countdown-minutes]"),
      seconds: read("[data-countdown-seconds]"),
    };
  });
  const countdownTotal = (value) =>
    value.days * 86_400 + value.hours * 3_600 + value.minutes * 60 + value.seconds;
  const expectedCountdown = Math.max(0, Math.floor((Date.parse(countdownBefore.target) - Date.now()) / 1_000));
  if (!Object.values(countdownBefore).every((value) => typeof value === "string" || Number.isFinite(value))) {
    fail("countdown", "countdown did not render numeric values");
  } else if (Math.abs(countdownTotal(countdownBefore) - expectedCountdown) > 2) {
    fail("countdown", "rendered time does not match the centralized ISO target");
  }
  await wait(1_100);
  const countdownAfter = await page.evaluate(() => {
    const read = (selector) => Number(document.querySelector(selector)?.textContent ?? Number.NaN);
    return {
      days: read("[data-countdown-days]"),
      hours: read("[data-countdown-hours]"),
      minutes: read("[data-countdown-minutes]"),
      seconds: read("[data-countdown-seconds]"),
    };
  });
  const countdownStep = countdownTotal(countdownBefore) - countdownTotal(countdownAfter);
  if (countdownStep < 1 || countdownStep > 2) {
    fail("countdown", `one-second update advanced by ${countdownStep}s`);
  }

  await page.$eval("[data-music-audio]", (audio, source) => {
    audio.src = source;
  }, fixtureAudioUrl);

  await page.click("[data-music-toggle]");
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
  await page.click("[data-music-toggle]");
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "paused",
  );
  const pausedState = await page.$eval("[data-music-audio]", (audio) => ({
    paused: audio.paused,
    currentTime: audio.currentTime,
    expanded: document.querySelector("[data-music-control]")?.getAttribute("data-music-expanded"),
  }));
  const pausedPosition = pausedState.currentTime;
  if (!pausedState.paused || pausedPosition < 0.9) fail("music", "explicit pause did not retain playback position");
  if (pausedState.expanded !== "false") fail("music", "second tap did not collapse the control");

  await page.click("[data-music-toggle]");
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
  }));
  if (timedCollapse.expanded !== "false" || timedCollapse.paused) {
    fail("music", "idle timeout did not collapse the control while preserving playback");
  }
  await page.click("[data-music-toggle]");
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
  await page.click("[data-music-toggle]");
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
  await page.click("[data-music-toggle]");
  await page.waitForFunction(
    () => document.querySelector("[data-music-control]")?.getAttribute("data-music-state") === "playing",
    { timeout: 5_000 },
  );
  await wait(150);
  const sessionResumePosition = await page.$eval("[data-music-audio]", (audio) => audio.currentTime);
  if (sessionResumePosition + 0.1 < resumedPosition) {
    fail("music", "stored session position was not restored after an explicit replay click");
  }
  await page.click("[data-music-toggle]");

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await wait(1_800);
  await page.click("[data-rsvp-open]");
  await page.waitForFunction(() => document.documentElement.classList.contains("is-rsvp-open"));
  await wait(700);
  const brideRsvp = await page.evaluate(() => {
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
      side: assistance?.getAttribute("data-contact-side"),
      heading: assistance?.querySelector("h3")?.textContent?.trim() ?? "",
      contactCount: assistance?.querySelectorAll("li").length ?? 0,
      ordered: comesBefore(countdown, form) && comesBefore(form, assistance),
      scrollable: scene instanceof HTMLElement
        && getComputedStyle(scene).overflowY === "auto"
        && scene.scrollHeight > scene.clientHeight,
      musicHidden: music instanceof HTMLElement
        && ["hidden", "collapse"].includes(getComputedStyle(music).visibility),
    };
  });
  if (!brideRsvp.open || !brideRsvp.ordered || !brideRsvp.scrollable) {
    fail("rsvp", "gated RSVP content order or internal scrolling regressed");
  }
  if (brideRsvp.side !== "bride" || !brideRsvp.heading.toLowerCase().includes("bride") || brideRsvp.contactCount !== 2) {
    fail("variants", "generic invitation did not render the bride-family variant");
  }
  if (!brideRsvp.musicHidden) fail("music", "music pill remained visible behind the RSVP dialog");

  await page.goto(`${baseUrl}/invite/ABC123/`, { waitUntil: "networkidle0" });
  const groomVariant = await page.evaluate(() => {
    const assistance = document.querySelector(".rsvp-assistance");
    return {
      side: assistance?.getAttribute("data-contact-side"),
      heading: assistance?.querySelector("h3")?.textContent?.trim() ?? "",
      labels: Array.from(assistance?.querySelectorAll("li > span") ?? [], (item) => item.textContent?.trim() ?? ""),
    };
  });
  if (
    groomVariant.side !== "groom"
    || !groomVariant.heading.toLowerCase().includes("groom")
    || groomVariant.labels.length !== 2
    || groomVariant.labels.some((label) => !label.toLowerCase().includes("groom"))
  ) {
    fail("variants", "invite metadata did not select the groom-family contacts");
  }

  results.music = {
    noAutoplay: initialMusic.paused && !initialMusic.autoplayAttribute,
    collapsedByDefault: initialMusic.expanded === "false",
    secondTapCollapsed: pausedState.expanded === "false",
    timeoutCollapsedDuringPlayback: timedCollapse.expanded === "false" && !timedCollapse.paused,
    explicitPlayAndPause: pausedState.paused && pausedPosition >= 0.9,
    resumePosition: Number(resumedPosition.toFixed(2)),
    sessionResumePosition: Number(sessionResumePosition.toFixed(2)),
    audioRequests,
  };
  results.countdown = {
    target: countdownBefore.target,
    initialSecondsRemaining: countdownTotal(countdownBefore),
    oneSecondStep: countdownStep,
  };
  results.variants = {
    generic: brideRsvp.side,
    inviteABC123: groomVariant.side,
  };
  results.rsvp = {
    open: brideRsvp.open,
    internallyScrollable: brideRsvp.scrollable,
    contentOrderValid: brideRsvp.ordered,
  };
  await page.close();

  const completedPage = await browser.newPage();
  await completedPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await completedPage.evaluateOnNewDocument(() => {
    Date.now = () => Date.parse("2027-06-16T11:00:00+08:00");
  });
  await completedPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await wait(300);
  const completedState = await completedPage.evaluate(() => ({
    gridHidden: document.querySelector("[data-countdown-grid]")?.hasAttribute("hidden") ?? false,
    messageHidden: document.querySelector("[data-countdown-message]")?.hasAttribute("hidden") ?? true,
    message: document.querySelector("[data-countdown-message]")?.textContent?.trim() ?? "",
  }));
  if (!completedState.gridHidden || completedState.messageHidden || !completedState.message) {
    fail("countdown", "past-date fallback was not graceful");
  }
  results.countdown.completedMessage = completedState.message;
  await completedPage.close();

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
