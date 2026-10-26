# PageSpeed monitor

Runs Lighthouse tests for the URLs configured in `url.js`, saves the results as
JSON using local Lighthouse and can optionally send them to ClickHouse.

Related project: [Lighthouse testing dashboard](https://github.com/abyss-soft/lighthouse-testing)

## Requirements

- Node.js 22.19 or newer
- npm

## Setup

```sh
npm install
cp .env.example .env
```

Edit `url.js` to add or remove pages. Set `COUNT_TESTING` in `.env` to control
how many times each page is measured. `LIGHTHOUSE_TIMEOUT_MS` controls the
maximum page-load wait during each local Lighthouse audit (default: 120000).
The URLs in `url.js` and ClickHouse settings in `.env.example` are examples;
replace them with values you control. `CLICKHOUSE_URL` has no built-in
production endpoint.

## Run and test

```sh
npm start
npm test
```

Measurements run locally with Lighthouse and a headless Chrome browser; each
page receives sequential mobile and desktop audits. No PageSpeed API, API key,
or Google quota is used. The process exits with a non-zero status if any
measurement fails. Puppeteer downloads a compatible Chrome for Testing during
`npm install`; on Linux, Chrome system dependencies may also be required.

Results are saved under `log/` when `SAVELOGS=true`. ClickHouse sending is
disabled by default; to enable it, replace the example endpoint and credentials
in `.env`, then set `SENDDATA=true`.

## View a result

The result will be visible on the ClickHouse dashboard.
To view it manually, open `view/index.html` in your browser and select the JSON file from `log/`.
