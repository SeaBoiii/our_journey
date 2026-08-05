import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find((candidate) => existsSync(candidate));

if (!executablePath) throw new Error("Chrome or Edge is required for the smoke test.");

const browser = await puppeteer.launch({ executablePath, headless: true });
const errors = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${baseUrl}/invite/ABC123/`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("#rsvp")?.scrollIntoView({ block: "start" }));
  await page.waitForFunction(() => {
    const island = document.querySelector("astro-island[client='visible']");
    return island && !island.hasAttribute("ssr");
  });
  await page.waitForSelector('input[name="name"]');

  const initialName = await page.$eval('input[name="name"]', (input) => input.value);
  if (initialName !== "Ivan Tan") {
    throw new Error(`Expected personalized name Ivan Tan, received ${initialName}.`);
  }

  await page.click('input[value="attending"]');
  await page.click('button[aria-label="Increase number of guests"]');
  await page.type('textarea[name="notes"]', "No shellfish, please.");
  await page.click('button[type="submit"]');
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const submissionStatus = await page.evaluate(() => ({
    message: document.querySelector('[role="status"], [role="alert"]')?.textContent?.trim() ?? "",
    attendance: document.querySelector('input[name="attendance"]:checked')?.value ?? "",
    guestCount: document.querySelector('input[name="guestCount"]')?.value ?? "",
    validationMessages: [...document.querySelectorAll('[id$="-error"]')].map((element) => element.textContent?.trim()),
  }));

  if (!submissionStatus.message.includes("Your response is saved on this device. Thank you.")) {
    throw new Error(`RSVP did not submit: ${JSON.stringify(submissionStatus)}`);
  }

  const result = await page.evaluate(() => {
    const stored = window.localStorage.getItem("our-journey:rsvp:abc123");
    const parsed = stored ? JSON.parse(stored) : null;
    return {
      attendance: parsed?.values?.attendance,
      guestCount: parsed?.values?.guestCount,
      notes: parsed?.values?.notes,
      hasSubmittedAt: Boolean(parsed?.submittedAt),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

  if (
    result.attendance !== "attending" ||
    result.guestCount !== 2 ||
    result.notes !== "No shellfish, please." ||
    !result.hasSubmittedAt ||
    result.horizontalOverflow
  ) {
    throw new Error(`RSVP smoke-test result was invalid: ${JSON.stringify(result)}`);
  }

  if (errors.length > 0) {
    throw new Error(`Browser errors: ${errors.join(" | ")}`);
  }

  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await browser.close();
}
