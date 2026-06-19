import {
  ITEM_BY_TRANSLATED,
  ITEM_NS_NAMES,
  type BaseType,
} from "@/assets/data";
import { distance } from "fastest-levenshtein";

export type ItemNamespace = "ITEM" | "GEM" | "UNIQUE";

export interface RecognizedToken {
  line: string;
  name: string;
  displayName: string;
  ns: ItemNamespace;
  count: number;
  fuzzy: boolean;
}

export interface TokenizeResult {
  recognized: RecognizedToken[];
  unrecognized: string[];
}

const NAMESPACES: ItemNamespace[] = ["ITEM", "GEM", "UNIQUE"];

// Longest item name we'll try to match (in words), e.g. "Countess Seske's Rune of Archery".
const MAX_NAME_WORDS = 6;

// Count marker: "6x ", "1x ", "12 " (x optional). Captures the count.
const COUNT_ANCHOR = /(\d+)\s*[xX×]?\s+/g;

function findExact(
  name: string,
): { ns: ItemNamespace; base: BaseType } | undefined {
  if (!name) return undefined;
  for (const ns of NAMESPACES) {
    const found = ITEM_BY_TRANSLATED(ns, name);
    if (found && found.length) {
      return { ns, base: found[0] };
    }
  }
  return undefined;
}

/** Normalises curly/back apostrophes and strips other punctuation from a word.
 *  Keeps digits and parentheses so names like "Thaumaturgic Flux (Level 19)"
 *  survive intact (stripping them caused fuzzy to match the wrong level). */
function cleanWord(word: string): string {
  return word.replace(/[’`´]/g, "'").replace(/[^A-Za-z0-9'()-]/g, "");
}

/** Cleaned leading words of a segment, stopped at the first garbage word. */
function segmentWords(segment: string): string[] {
  const words: string[] = [];
  for (const raw of segment.split(/\s+/)) {
    const w = cleanWord(raw);
    if (!w) break; // punctuation/garbage word ends the candidate name
    words.push(w);
    if (words.length >= MAX_NAME_WORDS) break;
  }
  return words;
}

/** Longest word-prefix that EXACTLY matches a known item name. */
function matchExact(
  words: string[],
): { ns: ItemNamespace; base: BaseType } | undefined {
  let best: { ns: ItemNamespace; base: BaseType } | undefined;
  for (let n = 1; n <= words.length; n++) {
    const match = findExact(words.slice(0, n).join(" "));
    if (match) best = match;
  }
  return best;
}

/**
 * Fuzzy fallback for OCR errors: finds the closest ITEM name (by Levenshtein
 * distance) to some word-prefix of the segment. Rewards are all ITEM-namespace
 * currency/runes, so we only search ITEM names to keep it cheap.
 */
function matchFuzzy(
  words: string[],
  itemNames: string[],
): { ns: ItemNamespace; base: BaseType } | undefined {
  let bestName: string | undefined;
  let bestDist = Infinity;
  for (let n = 1; n <= words.length; n++) {
    const cand = words.slice(0, n).join(" ");
    if (cand.length < 5) continue;
    const lc = cand.toLowerCase();
    for (const name of itemNames) {
      if (Math.abs(name.length - cand.length) > 4) continue;
      const d = distance(lc, name.toLowerCase());
      const threshold = Math.max(2, Math.floor(name.length * 0.2));
      if (d <= threshold && d < bestDist) {
        bestDist = d;
        bestName = name;
      }
    }
  }
  if (!bestName) return undefined;
  const found = ITEM_BY_TRANSLATED("ITEM", bestName);
  return found && found.length ? { ns: "ITEM", base: found[0] } : undefined;
}

export function tokenizeRewardText(text: string): TokenizeResult {
  const recognized: RecognizedToken[] = [];
  const unrecognized: string[] = [];

  // Materialised lazily — only built if a fuzzy match is actually needed.
  let itemNamesCache: string[] | undefined;
  const itemNames = () => (itemNamesCache ??= Array.from(ITEM_NS_NAMES()));

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const lineMatches: RecognizedToken[] = [];

    // Pass 1: every "Nx <name>" anchor inside the (possibly noisy) line.
    COUNT_ANCHOR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COUNT_ANCHOR.exec(line)) !== null) {
      const count = Number(m[1]);
      const words = segmentWords(line.slice(m.index + m[0].length));
      let match = matchExact(words);
      let fuzzy = false;
      if (!match) {
        match = matchFuzzy(words, itemNames());
        fuzzy = match != null;
      }
      if (match) {
        lineMatches.push({
          line: rawLine,
          name: match.base.refName,
          displayName: match.base.name,
          ns: match.ns,
          count,
          fuzzy,
        });
      }
    }

    // Pass 2: a clean line that is exactly an item name (no count) -> count 1.
    if (lineMatches.length === 0) {
      const bare = findExact(line);
      if (bare) {
        lineMatches.push({
          line: rawLine,
          name: bare.base.refName,
          displayName: bare.base.name,
          ns: bare.ns,
          count: 1,
          fuzzy: false,
        });
      }
    }

    if (lineMatches.length) {
      recognized.push(...lineMatches);
    } else {
      unrecognized.push(rawLine);
    }
  }

  return { recognized, unrecognized };
}
