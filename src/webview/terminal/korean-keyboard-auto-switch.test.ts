import { describe, expect, it } from "vitest";
import {
  convertEnglishKeysToHangul,
  convertHangulToEnglishKeys,
  createKoreanKeyboardInputSourceDetector,
  getKoreanKeyboardInputSourceTarget,
} from "./korean-keyboard-auto-switch";

describe("Korean keyboard auto switch", () => {
  it("converts Dubeolsik English-key input to Hangul syllables", () => {
    expect(convertEnglishKeysToHangul("dkssud")).toBe("안녕");
    expect(convertEnglishKeysToHangul("gksrmf")).toBe("한글");
  });

  it("converts Hangul and jamo typed in Korean mode back to English keys", () => {
    expect(convertHangulToEnglishKeys("햣")).toBe("git");
    expect(convertHangulToEnglishKeys("ㅜㅔㅡ")).toBe("npm");
  });

  it("targets Korean input source for likely wrong-layout English words", () => {
    expect(getKoreanKeyboardInputSourceTarget("dkssud")).toBe("korean");
    expect(getKoreanKeyboardInputSourceTarget("hello")).toBeUndefined();
    expect(getKoreanKeyboardInputSourceTarget("git")).toBeUndefined();
  });

  it("targets English input source for Korean-mode terminal command tokens", () => {
    expect(getKoreanKeyboardInputSourceTarget("햣")).toBe("english");
    expect(getKoreanKeyboardInputSourceTarget("ㅜㅔㅡ")).toBe("english");
    expect(getKoreanKeyboardInputSourceTarget("안녕")).toBeUndefined();
  });

  it("detects the target input source when a delimiter confirms a word", () => {
    const detect = createKoreanKeyboardInputSourceDetector();

    const output = Array.from("dkssud ").map(detect);

    expect(output).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "korean",
    ]);
  });

  it("does not detect pasted multi-character chunks", () => {
    const detect = createKoreanKeyboardInputSourceDetector();

    expect(detect("dkssud ")).toBeUndefined();
  });

  it("tracks backspace before deciding whether to rewrite", () => {
    const detect = createKoreanKeyboardInputSourceDetector();

    const output = ["d", "k", "x", "\x7f", "s", "s", "u", "d", " "]
      .map(detect)
      .filter((target) => target !== undefined);

    expect(output).toEqual(["korean"]);
  });
});
