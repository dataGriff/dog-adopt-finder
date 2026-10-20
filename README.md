# dog-adopt-finder

A Cloudflare Worker that captures the dogs listed on each rescue website as a snapshot and posts it to the [Dogs API](https://github.com/dataGriff/dog-adopt-api). It implements the `finder` service of [dog-adopt-spec](https://github.com/dataGriff/dog-adopt-spec): the AsyncAPI under `services/finder/asyncapi` and the acceptance criteria in `services/finder/features/capture-snapshot.feature`.

## Set up, not switched on

Whether scraping rescue websites is acceptable has not been decided. This repository is built so that question can be answered later without touching the code, and so nothing happens by accident in the meantime:

| Guard | State |
| --- | --- |
| Schedule | `triggers.crons` is empty in `wrangler.jsonc`. The scheduled handler exists but nothing fires it. |
| Live fetching | Off. A run in live mode fails with "live fetching is disabled" unless the var `FINDER_LIVE_FETCH` names that one adapter. |
| Fixtures | **Synthetic.** The HTML under `src/adapters/*/fixtures` was written by hand to match the selectors the previous implementation parsed. No rescue website was fetched to build it. |
| Running | Only by hand: `POST /run/:adapter`, protected by a bearer secret. |

Everything else (parsing, validation against the contract, queueing, posting to the API with idempotency, retry rules) is complete and tested against the fixtures.

## How it works

```
POST /run/cardiff-dogs-home?mode=fixture
  -> FixtureFetcher (or LiveFetcher, gated)        src/fetch/
  -> adapter.discover(listing) + adapter.parse(...)  src/adapters/cardiff-dogs-home/
  -> rescueSnapshotSchema.parse(...)                 @dogadopt/contracts (the OpenAPI body schema)
  -> SnapshotCaptured CloudEvent                     finder.snapshot.captured.v1
  -> Queue dogadopt-finder-snapshots
  -> queue consumer                                   src/consumer.ts
  -> POST /v1/ingest/rescues/{rescueId}/snapshots     Idempotency-Key = envelope id, bearer = FINDER_SERVICE_TOKEN
```

The consumer acks on 2xx and on 400/401/404/409 (a retry cannot change those), and retries on 429, 5xx and network errors. An adapter that throws sends an `AdapterFailed` event on `finder.adapter.failed.v1` instead, which the consumer logs.

Only factual, non-copyrightable data is captured: name, age category, size, gender, breed words, compatibility flags, and a *link* to the rescue's own image. Descriptions are never read. Anything a page does not state is `null`.

## Running locally

```sh
pnpm install
cp .dev.vars.example .dev.vars      # set FINDER_RUN_TOKEN and FINDER_SERVICE_TOKEN
pnpm dev                            # wrangler dev on http://localhost:8787 (the API's dev port is also 8787; change one)
```

```sh
curl http://localhost:8787/adapters
curl -X POST -H "Authorization: Bearer $FINDER_RUN_TOKEN" \
  "http://localhost:8787/run/cardiff-dogs-home?mode=fixture"
# {"ok":true,"eventId":"...","adapter":"cardiff-dogs-home","rescueId":"...","mode":"fixture","dogCount":3}
```

With `wrangler dev` the queue is simulated locally, so the consumer runs a few seconds later and posts to `API_BASE_URL` (set in `wrangler.jsonc` vars; point it at a local dog-adopt-api).

```sh
pnpm check     # fixtures:check, lint, typecheck, test, wrangler deploy --dry-run
pnpm test
```

## Adding an adapter

1. Create `src/adapters/<rescue-slug>/` with an `index.ts` exporting an `Adapter` (see `src/adapters/types.ts`): `name`, `adapterVersion`, `rescueId` (must exist in `@dogadopt/contracts/seed/rescues.json`), `listingUrl`, `discover(listingHtml)`, `parse(listingHtml, pageHtmlByUrl, options)` and `fixtures` keyed by absolute URL.
2. Put the saved HTML under `fixtures/*.html` and run `pnpm fixtures:build` (it generates `fixtures.generated.ts`, which is committed; CI checks it is current).
3. Add it to `src/adapters/registry.ts`.
4. Write one test that parses the fixtures and asserts the snapshot passes `rescueSnapshotSchema` with the dogs you expect. That is the only test an adapter needs.

## Enabling live fetching later

Do these in order, one rescue at a time, and only after the decision to scrape that site has been taken (check its terms and robots.txt first):

1. Save real copies of the listing page and a few dog pages, replace the synthetic fixtures under `src/adapters/<adapter>/fixtures/`, run `pnpm fixtures:build`, and fix the parsing rules until the adapter test passes on real pages. Bump `adapterVersion`.
2. Set the Worker var `FINDER_LIVE_FETCH=<adapter name>` (in `wrangler.jsonc` `vars` or the dashboard). Only that adapter may fetch; every other adapter keeps running from fixtures.
3. Run it by hand once: `POST /run/<adapter>?mode=live`. The live fetcher identifies itself as `DogAdoptFinder/1.0 (+https://github.com/dataGriff/dog-adopt-finder)` and waits at least one second between requests to the same host. Check the API's `SnapshotResult` counts.
4. Only then add a schedule in `wrangler.jsonc`, e.g. `"triggers": { "crons": ["0 8 * * *"] }`, and deploy.

To switch it off again, unset `FINDER_LIVE_FETCH` or empty the crons; both take effect on the next deploy.

## Deploying

`deploy.yml` deploys on push to `main` only when the `CLOUDFLARE_API_TOKEN` secret exists. Before the first deploy create the queue (`wrangler queues create dogadopt-finder-snapshots`) and set the secrets:

```sh
wrangler secret put FINDER_RUN_TOKEN
wrangler secret put FINDER_SERVICE_TOKEN   # the token the Dogs API was configured with
```

and set `API_BASE_URL` for production in `wrangler.jsonc`.

## Contracts pin

`@dogadopt/contracts` is installed from git pinned to a commit of [dog-adopt-spec](https://github.com/dataGriff/dog-adopt-spec) (currently `831a65676ba4a9e4bda06de644f0b7611096e57f`), so an install without the lockfile still resolves to exactly what was tested. To take a newer contract: change the sha in `package.json`, run `pnpm install`, then `pnpm typecheck && pnpm test`. On a release, pin a tag instead.

### Installing the contracts in CI

`dog-adopt-spec` is a private repository, so GitHub Actions needs a token that can read it. Create a fine-grained personal access token with **Contents: read** on `dataGriff/dog-adopt-spec` and store it in this repository as the secret `CONTRACTS_READ_TOKEN`. The CI and deploy workflows rewrite every GitHub clone URL to use it before `pnpm install`. If the spec repository is made public the secret is no longer needed.
