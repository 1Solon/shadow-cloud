export const fieldLabel =
  "text-xs uppercase tracking-[0.16em] text-terminal-300/70";
export const fieldValue = "text-sm font-medium text-terminal-300";
export const barLabel =
  "flex items-center whitespace-nowrap px-2 text-xs uppercase tracking-[0.16em] text-terminal-300/60";
export const segment = "flex items-center whitespace-nowrap px-2 py-1";
export const segmentLines = "divide-terminal-400/20 border-terminal-400/20";
export const tableHead = `border-y border-terminal-400/20 ${fieldLabel}`;
export const tableCell =
  "px-3 py-2.5 align-top font-medium first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export const tableHeaderCell =
  "px-3 py-2 text-left font-normal first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export const tableRow =
  "border-b border-terminal-400/20 text-terminal-300 last:border-b-0";
export const tableCurrentRow =
  "border-l-2 border-l-terminal-400 bg-terminal-400/10";

export function padNumber(value: number) {
  return String(value).padStart(2, "0");
}
