import {
  COMMON_TERMINAL_TOKENS,
  FINAL_JAMO,
  FINAL_KEY_TO_JAMO,
  HANGUL_BASE_CODE,
  HANGUL_FINAL_COUNT,
  HANGUL_LAST_CODE,
  HANGUL_SYLLABLE_SPAN,
  INITIAL_JAMO,
  INITIAL_KEY_TO_JAMO,
  JAMO_TO_KEY,
  MEDIAL_JAMO,
  MEDIAL_KEY_TO_JAMO,
} from "./korean-keyboard-layout";

const isAsciiWord = (value: string): boolean => /^[A-Za-z]+$/.test(value);

const isKoreanWordChar = (value: string): boolean =>
  /^[ㄱ-ㅎㅏ-ㅣ가-힣]$/.test(value);

const isWordChar = (value: string): boolean =>
  /^[A-Za-z]$/.test(value) || isKoreanWordChar(value);

const isDelimiter = (value: string): boolean =>
  value === " " || value === "\t" || value === "\r" || value === "\n";

const isBackspace = (value: string): boolean =>
  value === "\x7f" || value === "\b";

const readMedial = (
  input: string,
  index: number,
): { readonly jamo: string; readonly nextIndex: number } | undefined => {
  const compound = input.slice(index, index + 2);
  const compoundJamo = MEDIAL_KEY_TO_JAMO[compound];
  if (compoundJamo !== undefined) {
    return { jamo: compoundJamo, nextIndex: index + 2 };
  }

  const singleJamo = MEDIAL_KEY_TO_JAMO[input[index] ?? ""];
  if (singleJamo === undefined) {
    return undefined;
  }

  return { jamo: singleJamo, nextIndex: index + 1 };
};

const readFinal = (
  input: string,
  index: number,
): { readonly jamo: string; readonly nextIndex: number } | undefined => {
  const compound = input.slice(index, index + 2);
  const compoundJamo = FINAL_KEY_TO_JAMO[compound];
  const nextAfterCompound = input[index + 2] ?? "";
  if (
    compoundJamo !== undefined &&
    MEDIAL_KEY_TO_JAMO[nextAfterCompound] === undefined
  ) {
    return { jamo: compoundJamo, nextIndex: index + 2 };
  }

  const singleKey = input[index] ?? "";
  const singleJamo = FINAL_KEY_TO_JAMO[singleKey];
  const nextAfterSingle = input[index + 1] ?? "";
  if (
    singleJamo === undefined ||
    MEDIAL_KEY_TO_JAMO[nextAfterSingle] !== undefined
  ) {
    return undefined;
  }

  return { jamo: singleJamo, nextIndex: index + 1 };
};

const composeHangul = (
  initial: string,
  medial: string,
  final = "",
): string | undefined => {
  const initialIndex = INITIAL_JAMO.indexOf(initial);
  const medialIndex = MEDIAL_JAMO.indexOf(medial);
  const finalIndex = FINAL_JAMO.indexOf(final);
  if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) {
    return undefined;
  }

  return String.fromCharCode(
    HANGUL_BASE_CODE +
      initialIndex * HANGUL_SYLLABLE_SPAN +
      medialIndex * HANGUL_FINAL_COUNT +
      finalIndex,
  );
};

export const convertEnglishKeysToHangul = (input: string): string => {
  let output = "";
  let index = 0;

  while (index < input.length) {
    const initial = INITIAL_KEY_TO_JAMO[input[index] ?? ""];
    if (initial !== undefined) {
      const medial = readMedial(input, index + 1);
      if (medial !== undefined) {
        const final = readFinal(input, medial.nextIndex);
        const syllable = composeHangul(initial, medial.jamo, final?.jamo ?? "");
        if (syllable !== undefined) {
          output += syllable;
          index = final?.nextIndex ?? medial.nextIndex;
          continue;
        }
      }

      output += initial;
      index += 1;
      continue;
    }

    const medial = readMedial(input, index);
    if (medial !== undefined) {
      output += medial.jamo;
      index = medial.nextIndex;
      continue;
    }

    output += input[index] ?? "";
    index += 1;
  }

  return output;
};

export const convertHangulToEnglishKeys = (input: string): string => {
  let output = "";

  for (const char of input) {
    const charCode = char.charCodeAt(0);
    if (charCode >= HANGUL_BASE_CODE && charCode <= HANGUL_LAST_CODE) {
      const offset = charCode - HANGUL_BASE_CODE;
      const initial = INITIAL_JAMO[Math.floor(offset / HANGUL_SYLLABLE_SPAN)];
      const medial =
        MEDIAL_JAMO[
          Math.floor((offset % HANGUL_SYLLABLE_SPAN) / HANGUL_FINAL_COUNT)
        ];
      const final = FINAL_JAMO[offset % HANGUL_FINAL_COUNT];
      output += `${JAMO_TO_KEY[initial ?? ""] ?? ""}${JAMO_TO_KEY[medial ?? ""] ?? ""}${JAMO_TO_KEY[final ?? ""] ?? ""}`;
      continue;
    }

    output += JAMO_TO_KEY[char] ?? char;
  }

  return output;
};

const countHangulSyllables = (input: string): number =>
  Array.from(input).filter((char) => {
    const charCode = char.charCodeAt(0);
    return charCode >= HANGUL_BASE_CODE && charCode <= HANGUL_LAST_CODE;
  }).length;

export type KoreanKeyboardInputSourceTarget = "english" | "korean";

export const getKoreanKeyboardInputSourceTarget = (
  input: string,
): KoreanKeyboardInputSourceTarget | undefined => {
  if (input.length === 0) {
    return undefined;
  }

  if (isAsciiWord(input) && input.length >= 3) {
    const converted = convertEnglishKeysToHangul(input);
    if (converted !== input && countHangulSyllables(converted) >= 2) {
      return "korean";
    }
  }

  if (Array.from(input).some(isKoreanWordChar)) {
    const converted = convertHangulToEnglishKeys(input);
    if (
      converted !== input &&
      isAsciiWord(converted) &&
      COMMON_TERMINAL_TOKENS.has(converted.toLowerCase())
    ) {
      return "english";
    }
  }

  return undefined;
};

export const createKoreanKeyboardInputSourceDetector = (): ((
  data: string,
) => KoreanKeyboardInputSourceTarget | undefined) => {
  let wordBuffer = "";

  return (data: string): KoreanKeyboardInputSourceTarget | undefined => {
    if (data.length !== 1) {
      wordBuffer = "";
      return undefined;
    }

    if (isWordChar(data)) {
      wordBuffer += data;
      return undefined;
    }

    if (isBackspace(data)) {
      wordBuffer = wordBuffer.slice(0, -1);
      return undefined;
    }

    if (isDelimiter(data)) {
      const target = getKoreanKeyboardInputSourceTarget(wordBuffer);
      wordBuffer = "";
      return target;
    }

    wordBuffer = "";
    return undefined;
  };
};
