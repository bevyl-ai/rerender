// Why a file could not be read, as something you can branch on.
//
// The failures here are ordinary and each wants a different response: an unsupported codec means
// show a fallback, a 403 means retry or re-sign, a fragmented file with no index means fall back to
// server-rendered thumbnails, and a malformed box means the file is broken and no amount of retrying
// will help. Distinguishing them by matching on `error.message` works exactly until the wording
// changes, and after 1.0 the wording is API. So the reason is a field.

export type ExtractErrorCode =
  /** No moov anywhere in the bytes read — not an mp4, or not one this can index. */
  | 'no-moov'
  /** A moov with no video track carrying a sample entry. */
  | 'no-video-track'
  /** A video track whose codec no handler in the registry claims. */
  | 'unsupported-codec'
  /** The sample entry is missing the configuration box its codec needs. */
  | 'missing-config'
  /** The configuration box is too short to describe a decoder. */
  | 'truncated-config'
  /** A box is malformed, or claims more than it can hold. */
  | 'malformed'
  /** The file is fragmented and carries no mfra, so seeking would cost a request per fragment. */
  | 'no-fragment-index'
  /** The fragment index describes a different track than the video one. */
  | 'index-track-mismatch'
  /** A Range request did not come back usable. */
  | 'range-request-failed'
  /** The source cannot do something this file requires — a suffix range, for instance. */
  | 'source-unsupported';

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  /** The URL being read, when the failure knows it. */
  readonly src?: string;

  constructor(code: ExtractErrorCode, message: string, options?: { src?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExtractError';
    this.code = code;
    this.src = options?.src;
  }
}

/** True for an {@link ExtractError}, narrowing so `error.code` is reachable. */
export function isExtractError(error: unknown): error is ExtractError {
  return error instanceof ExtractError;
}
