import { beforeAll, describe, expect, it } from "vitest";
import { setupTests } from "../../vitest.setup";
import { init, setLocalAugmentFilter } from "@/assets/data";
import { tokenizeRewardText } from "@/web/reward-check/tokenize";

describe("tokenizeRewardText", () => {
  setupTests();

  beforeAll(async () => {
    setLocalAugmentFilter(() => true);
    await init("en");
  });

  it("recognizes a known currency line", () => {
    const result = tokenizeRewardText("Chaos Orb");
    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0].name).toBe("Chaos Orb");
    expect(result.recognized[0].ns).toBe("ITEM");
    expect(result.recognized[0].count).toBe(1);
    expect(result.unrecognized).toHaveLength(0);
  });

  it("parses a leading stack count", () => {
    const result = tokenizeRewardText("5x Exalted Orb");
    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0].name).toBe("Exalted Orb");
    expect(result.recognized[0].count).toBe(5);
  });

  it("parses a leading count without the x separator", () => {
    const result = tokenizeRewardText("12 Chaos Orb");
    expect(result.recognized[0]?.name).toBe("Chaos Orb");
    expect(result.recognized[0]?.count).toBe(12);
  });

  it("extracts Nx item names embedded in noisy OCR text", () => {
    const ocr =
      "TERT cabarailcs STR Atha ee The, ¥ 'fot re 1x Greater Chaos Orb ., od Lt ay, " +
      "TF os. [ a) [ores] uA), ce Ide | 1x Greater Exalted Orb ', aa, [s 1x Greater Regal Orb JR, " +
      'TE gal ee, " BES By aig et., Sa';
    const result = tokenizeRewardText(ocr);
    const names = result.recognized.map((r) => r.name);
    expect(names).toContain("Greater Chaos Orb");
    expect(names).toContain("Greater Exalted Orb");
    expect(names).toContain("Greater Regal Orb");
    for (const r of result.recognized) expect(r.count).toBe(1);
  });

  it("fuzzy-matches a slightly garbled OCR name", () => {
    // OCR dropped the apostrophe and misread one letter (Archery -> Archary)
    const result = tokenizeRewardText("1x Countess Seskes Rune of Archary");
    const names = result.recognized.map((r) => r.name);
    expect(names).toContain("Countess Seske's Rune of Archery");
    expect(result.recognized[0]?.fuzzy).toBe(true);
  });

  it("recognizes a league Ancient Rune", () => {
    const result = tokenizeRewardText("Ancient Rune of Animosity");
    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0].name).toBe("Ancient Rune of Animosity");
    expect(result.recognized[0].ns).toBe("ITEM");
  });

  it("collects unrecognized lines and skips blanks", () => {
    const result = tokenizeRewardText("Chaos Orb\n\n   \nqwerty zxcv");
    expect(result.recognized.map((r) => r.name)).toEqual(["Chaos Orb"]);
    expect(result.unrecognized).toEqual(["qwerty zxcv"]);
  });
});
