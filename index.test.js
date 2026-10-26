const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildLighthouseRows,
  getConfig,
  normalizeAmount,
} = require("./index");

test("normalizes Lighthouse numeric values without removing unrelated letters", () => {
  assert.equal(normalizeAmount(" 1,234 ms "), "1234");
  assert.equal(normalizeAmount("5.6 s"), "5.6");
  assert.equal(normalizeAmount("0.014"), "0.014");
  assert.equal(normalizeAmount("—"), "—");
});

test("builds rows from local mobile and desktop Lighthouse reports", () => {
  const rows = buildLighthouseRows(
    {
      categories: { performance: { score: 0.92 } },
      audits: {
        "first-contentful-paint": { displayValue: "1.2 s" },
        "largest-contentful-paint": { displayValue: "2.4 s" },
        "total-blocking-time": { displayValue: "110 ms" },
      },
    },
    {
      categories: { performance: { score: 0.98 } },
      audits: {
        "first-contentful-paint": { displayValue: "900 ms" },
        "largest-contentful-paint": { displayValue: "1,500 ms" },
      },
    },
    "https://example.com/",
    "Home page",
    2,
    1_700_000_000
  );

  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.map(({ platform, measurement, amount }) => [
      platform,
      measurement,
      amount,
    ]),
    [
      ["mobile", "Performance", 92],
      ["mobile", "First-Contentful-Paint", "1.2"],
      ["mobile", "Largest-Contentful-Paint", "2.4"],
      ["mobile", "Total-Blocking-Time", "110"],
      ["desktop", "Performance", 98],
      ["desktop", "First-Contentful-Paint", "900"],
      ["desktop", "Largest-Contentful-Paint", "1500"],
    ]
  );
  assert.equal(rows[0].url, "https://example.com/");
  assert.equal(rows[0].idx, 2);
  assert.equal(rows[0].timestamp, 1_700_000_000);
  assert.equal(rows[0].instrument, "v2");
});

test("uses safe defaults and parses explicit environment settings", () => {
  const defaults = getConfig({});
  assert.deepEqual(
    {
      count: defaults.count,
      lighthouseTimeout: defaults.lighthouseTimeout,
      saveLogs: defaults.saveLogs,
      sendData: defaults.sendData,
      username: defaults.username,
      password: defaults.password,
    },
    {
      count: 1,
      lighthouseTimeout: 120_000,
      saveLogs: false,
      sendData: false,
      username: undefined,
      password: undefined,
    }
  );
  assert.equal(defaults.clickhouseUrl, undefined);

  const config = getConfig({
    COUNT_TESTING: "3",
    LIGHTHOUSE_TIMEOUT_MS: "90000",
    SAVELOGS: "yes",
    SENDDATA: "true",
    USERNAMELOGIN: "user",
    PASSWORDLOGIN: "password",
    CLICKHOUSE_URL: "https://clickhouse.example.com",
  });
  assert.equal(config.count, 3);
  assert.equal(config.lighthouseTimeout, 90_000);
  assert.equal(config.saveLogs, true);
  assert.equal(config.sendData, true);
  assert.equal(config.clickhouseUrl, "https://clickhouse.example.com");
});

test("rejects an invalid measurement count", () => {
  assert.throws(() => getConfig({ COUNT_TESTING: "0" }), {
    message: "COUNT_TESTING must be a positive integer.",
  });
});

test("rejects an invalid Lighthouse timeout", () => {
  assert.throws(() => getConfig({ LIGHTHOUSE_TIMEOUT_MS: "0" }), {
    message: "LIGHTHOUSE_TIMEOUT_MS must be a positive integer.",
  });
});

test("requires a performance score from each Lighthouse strategy", () => {
  assert.throws(
    () =>
      buildLighthouseRows(
        { categories: { performance: { score: 0.9 } }, audits: {} },
        { categories: {}, audits: {} },
        "https://example.com",
        "Example",
        1,
        1
      ),
    { message: "Lighthouse desktop report has no performance score." }
  );
});
