import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the motion audit.");

const browser = await puppeteer.launch({ executablePath, headless: true });
const failures = [];
const results = [];

async function tracePhase(page, selector, startProgress, endProgress, duration) {
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
      const deltas = [];
      const scales = [];
      const landingGaps = [];
      const pavilionOpacities = [];
      let previousTime;
      let startTime;

      window.scrollTo({ top: startScroll, behavior: "instant" });

      const frame = (time) => {
        startTime ??= time;
        if (previousTime !== undefined) deltas.push(time - previousTime);
        previousTime = time;
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
          const sorted = [...deltas].sort((a, b) => a - b);
          const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
          const regressions = scales.slice(1).filter((scale, index) => scale + 0.002 < scales[index]).length;
          resolve({
            frames: deltas.length,
            p95FrameMs: percentile(0.95),
            maxFrameMs: sorted.at(-1) ?? 0,
            longFrames: deltas.filter((delta) => delta > 34).length,
            scaleRegressions: regressions,
            maxLandingGap: landingGaps.length ? Math.max(...landingGaps) : 0,
            maxPavilionOpacity: Math.max(...pavilionOpacities),
          });
        }
      };

      requestAnimationFrame(frame);
    }),
    { selector, startProgress, endProgress, duration },
  );
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600 });
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0" });
    const ascent = await tracePhase(page, "#ascension", 0, 0.98, 3600);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const pavilion = await tracePhase(page, "#pavilion", 0, 0.72, 5200);

    if (ascent.scaleRegressions > 0 || pavilion.scaleRegressions > 0) {
      failures.push(`${viewport.width}x${viewport.height}: staircase scale regressed during ascent`);
    }
    if (ascent.maxPavilionOpacity > 0.02) {
      failures.push(`${viewport.width}x${viewport.height}: pavilion leaked into ascent trace`);
    }
    if (pavilion.maxLandingGap > 8) {
      failures.push(`${viewport.width}x${viewport.height}: moving landing gap reached ${pavilion.maxLandingGap.toFixed(1)}px`);
    }
    if (ascent.p95FrameMs > 25 || pavilion.p95FrameMs > 25) {
      failures.push(`${viewport.width}x${viewport.height}: p95 frame pacing exceeded 25ms`);
    }

    results.push({ viewport: `${viewport.width}x${viewport.height}`, ascent, pavilion });
    await page.close();
  }

  console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
