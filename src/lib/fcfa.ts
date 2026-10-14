/** 253650 → "253 650 FCFA" (brief §2 rule 6). Negative values keep their sign. */
export function formatFCFA(amount: number): string {
  const digits = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${amount < 0 ? "−" : ""}${digits} FCFA`;
}

/** "253 650" → 253650. Returns null unless the text is a whole, positive amount. */
export function parseFCFA(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Group digits while typing: "253650" → "253 650". */
export function groupDigits(text: string): string {
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
