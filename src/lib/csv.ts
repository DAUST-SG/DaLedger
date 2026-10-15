/** One CSV cell: quoted when it holds a comma, quote or line break (RFC 4180). */
function cell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells → CSV text with a header line, CRLF line ends and a BOM so Excel reads UTF-8. */
export function toCSV(header: string[], rows: (string | number | undefined | null)[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Save text as a file in the browser. */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
