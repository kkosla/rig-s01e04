export type JobStatus = 'ok' | 'retry' | 'fail'

/** Counts of all valid events, not just each job's final status. */
export type StatusCounts = Record<JobStatus, number>

export type DigestRow = {
  job: string
  owner: string | null
  runs: number
  retries: number
  lastStatus: JobStatus
  lastError: string | null
  firstAt: string
  lastAt: string
  hasFail: boolean
}

export type NightDigest = {
  night: string
  rows: DigestRow[]
  badLines: number
  counts: StatusCounts
}

/**
 * Synchronously read runsDir/<night>.jsonl for a YYYY-MM-DD night.
 * Missing files or invalid night names return null; empty files return an empty
 * digest. Other filesystem failures propagate. Invalid JSON/schema lines count
 * as badLines and blank lines are ignored. Rows are sorted by job. First/last
 * events use chronological instants while retaining their source time offsets;
 * owner and lastStatus come from the latest event (later line breaks ties).
 * lastError is the latest supplied error, even if a later event succeeds.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null
