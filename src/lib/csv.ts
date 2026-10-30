/**
 * One CSV cell: quoted when it holds a comma, quote or line break (RFC 4180).
 * Text starting with = + - @ or a tab/CR gets a leading ' so a spreadsheet shows
 * it instead of running it as a formula (reasons can come from the shop/DaBus).
 */
function cell(value: string | number | undefined | null): string {
  let s = value === undefined || value === null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells → CSV text with a header line, CRLF line ends and a BOM so Excel reads UTF-8. */
export function toCSV(header: string[], rows: (string | number | undefined | null)[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Save text as a file in the browser. The link is attached for the click
 * (Firefox ignores a detached one) and the URL is freed only after the
 * download has started (Safari reads it asynchronously).
 */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
