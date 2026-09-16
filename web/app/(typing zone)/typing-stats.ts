export type TypingSample = {
  seconds: number;
  grossWpm: number;
  errorRate: number;
};

export function measureTyping(text: string, passage: string, seconds: number): TypingSample {
  const errors = text.split("").filter((character, index) => character !== passage[index]).length;

  return {
    seconds,
    // Five characters count as one word. Rates are cumulative since the start.
    grossWpm: seconds > 0 ? (text.length / 5) / (seconds / 60) : 0,
    errorRate: text.length > 0 ? (errors / text.length) * 100 : 0,
  };
}
