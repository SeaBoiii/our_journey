import { existsSync } from "node:fs";
import process from "node:process";
import puppeteer from "puppeteer-core";

const [
  url = "http://127.0.0.1:4321/",
  output = "artifacts/capture.png",
  widthValue = "390",
  heightValue = "844",
  scrollValue = "0",
  motionValue = "full",
] = process.argv.slice(2);

const executableCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = executableCandidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error("No supported local Chrome or Edge executable was found.");
}

const width = Number.parseInt(widthValue, 10);
const height = Number.parseInt(heightValue, 10);
const [selectorTarget, localProgressValue] = scrollValue.includes("@")
  ? scrollValue.split("@", 2)
  : [null, scrollValue];
const scrollFraction = Math.max(0, Math.min(1, Number.parseFloat(localProgressValue)));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600 });

  if (motionValue === "reduced") {
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  }

  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(
    ({ fraction, selector }) => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      let top = maxScroll * fraction;

      if (selector) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Capture target not found: ${selector}`);
        const bounds = element.getBoundingClientRect();
        const elementTop = window.scrollY + bounds.top;
        const localScrollableDistance = Math.max(0, bounds.height - window.innerHeight);
        top = elementTop + localScrollableDistance * fraction;
      }

      window.scrollTo({ top, behavior: "instant" });
    },
    { fraction: scrollFraction, selector: selectorTarget },
  );
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await page.screenshot({ path: output, fullPage: false });
  console.log(JSON.stringify({ output, width, height, scrollFraction, selectorTarget, motionValue }));
} finally {
  await browser.close();
}
