/** 75.4 -> "1:15", with `decimals` 1 -> "1:15.4". Never negative. */
export function formatClock(seconds: number, decimals = 0): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const factor = 10 ** decimals;
  const rounded = Math.floor(safe * factor) / factor;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded - minutes * 60;
  const text = decimals > 0 ? rest.toFixed(decimals).padStart(decimals + 3, "0") : String(Math.floor(rest)).padStart(2, "0");
  return `${minutes}:${text}`;
}
