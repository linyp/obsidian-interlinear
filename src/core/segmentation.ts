/**
 * Pure segmentation + batch pack/unpack.
 *
 * - `selectSegments` keeps each translatable block's ORIGINAL index, so the
 *   render layer maps a translation back to its exact source block by index.
 * - `packBatch`/`unpackBatch` are the wire contract: numbered `<<<SEG k>>>`
 *   sentinels (one per line) survive arbitrary markdown far better than JSON.
 * - `chunkByBudget` packs by character budget to cut round-trips.
 */
import { BlockDescriptor, isTranslatable } from "./blockRules";

export interface Segment {
  /** Position in the original blocks array (mapping key). */
  index: number;
  text: string;
}

/** Filter to translatable blocks, preserving original positions. */
export function selectSegments(blocks: BlockDescriptor[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (isTranslatable(blocks[i])) {
      out.push({ index: i, text: blocks[i].text.trim() });
    }
  }
  return out;
}

/** Pack segments into one prompt payload with numbered sentinels. */
export function packBatch(segments: string[]): string {
  return segments
    .map((s, i) => `<<<SEG ${i + 1}>>>\n${s}`)
    .join("\n\n");
}

export type UnpackResult =
  | { ok: true; segments: string[] }
  | {
      ok: false;
      reason: "no-markers" | "non-sequential" | "count-mismatch";
      got: number;
      expected: number;
    };

// Marker must occupy its own line so a marker appearing mid-prose won't match.
const MARKER_LINE_RE = /^<<<SEG\s+(\d+)>>>[ \t]*$/gm;

/**
 * Recover the N translated segments. Returns `ok: false` (with a reason) on any
 * count/order mismatch so the caller can fall back to per-segment requests.
 */
export function unpackBatch(raw: string, expectedCount: number): UnpackResult {
  const markers: Array<{ num: number; contentStart: number; markerStart: number }> = [];
  MARKER_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_LINE_RE.exec(raw)) !== null) {
    markers.push({
      num: parseInt(m[1], 10),
      markerStart: m.index,
      contentStart: MARKER_LINE_RE.lastIndex,
    });
  }

  if (markers.length === 0) {
    return { ok: false, reason: "no-markers", got: 0, expected: expectedCount };
  }

  const sequential = markers.every((mk, i) => mk.num === i + 1);
  if (!sequential) {
    return { ok: false, reason: "non-sequential", got: markers.length, expected: expectedCount };
  }

  const segments: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].contentStart;
    const end = i + 1 < markers.length ? markers[i + 1].markerStart : raw.length;
    segments.push(raw.slice(start, end).trim());
  }

  if (segments.length !== expectedCount) {
    return { ok: false, reason: "count-mismatch", got: segments.length, expected: expectedCount };
  }
  return { ok: true, segments };
}

/**
 * Group segments into chunks no larger than `maxChars` (by summed text length),
 * preserving order/indices. A single oversized segment gets its own chunk.
 */
export function chunkByBudget(segments: Segment[], maxChars: number): Segment[][] {
  const chunks: Segment[][] = [];
  let current: Segment[] = [];
  let currentLen = 0;

  for (const seg of segments) {
    const len = seg.text.length;
    if (len >= maxChars) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      chunks.push([seg]);
      continue;
    }
    if (current.length > 0 && currentLen + len > maxChars) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(seg);
    currentLen += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
