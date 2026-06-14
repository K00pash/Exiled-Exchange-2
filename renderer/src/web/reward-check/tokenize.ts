import { ITEM_BY_TRANSLATED, type BaseType } from "@/assets/data";

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

// Longest item name we'll try to match (in words), e.g. "Ancient Rune of the Titan".
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

/** Normalises curly/back apostrophes and strips other punctuation from a word. */
function cleanWord(word: string): string {
  return word.replace(/[’`´]/g, "'").replace(/[^A-Za-z'-]/g, "");
}

/**
 * Given the text right after a count marker (possibly trailed by OCR noise),
 * find the LONGEST known item name that the text starts with.
 */
function matchLongestNamePrefix(
  segment: string,
): { ns: ItemNamespace; base: BaseType } | undefined {
  const words: string[] = [];
  for (const raw of segment.split(/\s+/)) {
    const w = cleanWord(raw);
    if (!w) break; // punctuation/garbage word ends the candidate name
    words.push(w);
    if (words.length >= MAX_NAME_WORDS) break;
  }

  let best: { ns: ItemNamespace; base: BaseType } | undefined;
  for (let n = 1; n <= words.length; n++) {
    const candidate = words.slice(0, n).join(" ");
    const match = findExact(candidate);
    if (match) best = match; // keep the longest that matches
  }
  return best;
}

export function tokenizeRewardText(text: string): TokenizeResult {
  const recognized: RecognizedToken[] = [];
  const unrecognized: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const lineMatches: RecognizedToken[] = [];

    // Pass 1: every "Nx <name>" anchor inside the (possibly noisy) line.
    COUNT_ANCHOR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COUNT_ANCHOR.exec(line)) !== null) {
      const count = Number(m[1]);
      const segment = line.slice(m.index + m[0].length);
      const match = matchLongestNamePrefix(segment);
      if (match) {
        lineMatches.push({
          line: rawLine,
          name: match.base.refName,
          displayName: match.base.name,
          ns: match.ns,
          count,
          fuzzy: false,
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
