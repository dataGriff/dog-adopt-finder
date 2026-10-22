import type { FinderEvent } from '@dogadopt/contracts';

export interface Env {
  /** Base URL of the Dogs API, e.g. https://api.dogadopt.co.uk */
  API_BASE_URL: string;
  /** Names the ONE adapter allowed to fetch its rescue website. Unset means no live fetching at all. */
  FINDER_LIVE_FETCH?: string;
  /** Secret: bearer token required by POST /run/:adapter */
  FINDER_RUN_TOKEN?: string;
  /** Secret: service token the Dogs API issued to the finder */
  FINDER_SERVICE_TOKEN?: string;
  /** Queue dogadopt-finder-snapshots (producer) */
  SNAPSHOTS: Queue<FinderEvent>;
}
