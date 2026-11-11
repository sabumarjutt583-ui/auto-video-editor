/** Display labels only; provider identifiers remain unchanged. */
export function localeLabel(code: string): string {
  try {
    const locale = new Intl.Locale(code);
    const language = new Intl.DisplayNames(["en"], { type: "language" }).of(locale.language) ?? locale.language;
    const region = locale.region ? new Intl.DisplayNames(["en"], { type: "region" }).of(locale.region) : "";
    return `${language}${region ? ` (${region})` : ""}`;
  } catch { return code; }
}

export function microsoftVoiceLabel(name: string, locale = "", _gender = ""): string {
  const short = locale && name.startsWith(`${locale}-`) ? name.slice(locale.length + 1) : name.replace(/^[a-z]{2,3}(?:-[A-Za-z]{2,4}){1,2}-/, "");
  return short.replace(/Neural$/, "").replace(/Multilingual$/, " (Multilingual)");
}
