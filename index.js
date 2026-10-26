const fs = require("node:fs/promises");
const path = require("node:path");
const { urlList } = require("./url");

const instrument = "v2";
const defaultLighthouseTimeout = 120_000;

const lighthouseMetrics = [
  ["first-contentful-paint", "First-Contentful-Paint"],
  ["largest-contentful-paint", "Largest-Contentful-Paint"],
  ["total-blocking-time", "Total-Blocking-Time"],
  ["cumulative-layout-shift", "Cumulative-Layout-Shift"],
  ["speed-index", "Speed-Index"],
];

function isEnabled(value, defaultValue = false) {
  if (value === undefined || value.trim() === "") return defaultValue;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

function parseCount(value) {
  if (value === undefined || value.trim() === "") return 1;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("COUNT_TESTING must be a positive integer.");
  }
  return count;
}

function parseTimeout(value) {
  if (value === undefined || value.trim() === "") return defaultLighthouseTimeout;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error("LIGHTHOUSE_TIMEOUT_MS must be a positive integer.");
  }
  return timeout;
}

function normalizeAmount(value) {
  if (typeof value !== "string") return value;
  return value
    .trim()
    .replace(/,/g, "")
    .replace(/\s*(?:ms|s)$/i, "")
    .trim();
}

async function sendResults(rows, config) {
  if (!config.username || !config.password) {
    throw new Error(
      "USERNAMELOGIN and PASSWORDLOGIN are required when SENDDATA is enabled."
    );
  }

  if (!config.clickhouseUrl) {
    throw new Error(
      "Set CLICKHOUSE_URL to your ClickHouse HTTP endpoint when SENDDATA is enabled."
    );
  }

  let endpoint;
  try {
    endpoint = new URL(config.clickhouseUrl);
  } catch {
    throw new Error("CLICKHOUSE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("CLICKHOUSE_URL must use HTTP or HTTPS.");
  }

  const authorization = Buffer.from(
    `${config.username}:${config.password}`
  ).toString("base64");
  const body = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new Error(
      `ClickHouse returned HTTP ${response.status}: ${message || response.statusText}`
    );
  }
}

async function saveResults(rows, index, sectionName) {
  const logDirectory = path.join(__dirname, "log");
  const safeName = sectionName.replace(/[^a-zA-Z0-9_-]/g, "_");
  await fs.mkdir(logDirectory, { recursive: true });
  await fs.writeFile(
    path.join(logDirectory, `all-log${index}${safeName}.json`),
    `${JSON.stringify(rows, null, 2)}\n`,
    "utf8"
  );
}

function getConfig(env = process.env) {
  return {
    count: parseCount(env.COUNT_TESTING),
    lighthouseTimeout: parseTimeout(env.LIGHTHOUSE_TIMEOUT_MS),
    saveLogs: isEnabled(env.SAVELOGS),
    sendData: isEnabled(env.SENDDATA),
    username: env.USERNAMELOGIN,
    password: env.PASSWORDLOGIN,
    clickhouseUrl: env.CLICKHOUSE_URL,
  };
}

function validateTargets(targets) {
  const entries = Object.entries(targets);
  if (entries.length === 0) {
    throw new Error("url.js must contain at least one page to test.");
  }

  for (const [name, value] of entries) {
    let parsedUrl;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new Error(`Invalid URL configured for "${name}".`);
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`URL for "${name}" must use HTTP or HTTPS.`);
    }
  }

  return entries;
}

async function runLighthouse(browser, searchUrl, strategy, timeout) {
  const lighthouseModule = await import("lighthouse");
  const lighthouse = lighthouseModule.default || lighthouseModule.lighthouse;
  if (typeof lighthouse !== "function") {
    throw new Error("The installed Lighthouse package has no runner export.");
  }

  const browserPort = Number(new URL(browser.wsEndpoint()).port);
  if (!Number.isInteger(browserPort) || browserPort < 1) {
    throw new Error("Could not determine the local Chrome debugging port.");
  }

  const result = await lighthouse(
    searchUrl,
    {
      port: browserPort,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      formFactor: strategy,
      screenEmulation:
        strategy === "mobile"
          ? {
              mobile: true,
              width: 412,
              height: 823,
              deviceScaleFactor: 1.75,
              disabled: false,
            }
          : {
              mobile: false,
              width: 1350,
              height: 940,
              deviceScaleFactor: 1,
              disabled: false,
            },
      maxWaitForLoad: timeout,
    }
  );
  if (!result?.lhr) {
    throw new Error(`Local Lighthouse returned no ${strategy} report.`);
  }
  return result.lhr;
}

function buildLighthouseRows(
  mobileReport,
  desktopReport,
  searchUrl,
  sectionName,
  index,
  timestamp
) {
  const rows = [];
  const addRow = (platform, measurement, amount) => {
    rows.push({
      timestamp,
      name: sectionName,
      platform,
      measurement,
      idx: index,
      amount: normalizeAmount(amount),
      url: searchUrl,
      instrument,
    });
  };

  for (const [platform, report] of [
    ["mobile", mobileReport],
    ["desktop", desktopReport],
  ]) {
    const score = report.categories?.performance?.score;
    if (typeof score !== "number") {
      throw new Error(`Lighthouse ${platform} report has no performance score.`);
    }
    addRow(platform, "Performance", Math.round(score * 100));

    for (const [auditId, measurement] of lighthouseMetrics) {
      const audit = report.audits?.[auditId];
      if (audit?.displayValue) {
        addRow(platform, measurement, audit.displayValue);
      }
    }
  }

  return rows;
}

async function measurePage(browser, searchUrl, sectionName, index, config) {
  const mobileReport = await runLighthouse(
    browser,
    searchUrl,
    "mobile",
    config.lighthouseTimeout
  );
  const desktopReport = await runLighthouse(
    browser,
    searchUrl,
    "desktop",
    config.lighthouseTimeout
  );
  const rows = buildLighthouseRows(
    mobileReport,
    desktopReport,
    searchUrl,
    sectionName,
    index,
    Math.floor(Date.now() / 1000)
  );

  if (config.saveLogs) await saveResults(rows, index, sectionName);
  if (config.sendData) await sendResults(rows, config);
  console.log(`Completed ${sectionName} (measurement ${index}).`);
}

async function runMonitoring(options = {}) {
  const config = options.config || getConfig();
  const targets = validateTargets(options.targets || urlList);
  const puppeteer = require("puppeteer");
  let browser;
  let failures = 0;

  try {
    browser = await puppeteer.launch({ headless: true });
    for (const [sectionName, searchUrl] of targets) {
      for (let index = 1; index <= config.count; index += 1) {
        try {
          await measurePage(browser, searchUrl, sectionName, index, config);
        } catch (error) {
          failures += 1;
          console.error(
            `Failed ${sectionName} (measurement ${index}): ${error.message}`
          );
        }
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  if (failures > 0) {
    throw new Error(`${failures} Lighthouse measurement(s) failed.`);
  }
}

if (require.main === module) {
  require("dotenv").config();
  runMonitoring().catch((error) => {
    console.error(`Monitoring stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLighthouseRows,
  getConfig,
  normalizeAmount,
  runLighthouse,
  runMonitoring,
};
