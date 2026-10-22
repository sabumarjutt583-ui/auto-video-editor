/** Words and signs the detection looks for, per language. Letters are matched case-insensitively where the script has case. */

export const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTHS_UR = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];
export const DAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Numbers with a scale word after them: `3.5 million`, `20 لاکھ`, `5억`, `3万`. */
export const SCALES: ReadonlyArray<readonly [string, number]> = [
  ["trillion", 1e12], ["billion", 1e9], ["million", 1e6], ["thousand", 1e3], ["hundred", 100],
  ["tn", 1e12], ["bn", 1e9], ["mn", 1e6],
  ["ارب", 1e9], ["کروڑ", 1e7], ["لاکھ", 1e5], ["ہزار", 1e3], ["ملین", 1e6], ["بلین", 1e9],
  ["조", 1e12], ["억", 1e8], ["만", 1e4], ["천", 1e3], ["백", 100],
  ["兆", 1e12], ["億", 1e8], ["万", 1e4], ["千", 1e3], ["百", 100],
];

/** Currency signs and words: [text, code]. */
export const CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["¥", "JPY"], ["₩", "KRW"], ["₹", "INR"], ["₨", "PKR"]];
export const CURRENCY_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["dollars", "USD"], ["dollar", "USD"], ["usd", "USD"], ["euros", "EUR"], ["euro", "EUR"], ["eur", "EUR"], ["pounds", "GBP"], ["gbp", "GBP"],
  ["rupees", "PKR"], ["rupee", "PKR"], ["pkr", "PKR"], ["inr", "INR"], ["yen", "JPY"], ["won", "KRW"], ["yuan", "CNY"],
  ["روپے", "PKR"], ["روپیہ", "PKR"], ["ڈالر", "USD"], ["یورو", "EUR"], ["پاؤنڈ", "GBP"], ["ریال", "SAR"], ["درہم", "AED"],
  ["달러", "USD"], ["유로", "EUR"], ["엔", "JPY"], ["위안", "CNY"], ["원", "KRW"],
  ["ドル", "USD"], ["ユーロ", "EUR"], ["ポンド", "GBP"], ["円", "JPY"], ["元", "CNY"],
];

export const PERCENT_WORDS = ["percent", "per cent", "pct", "فیصد", "퍼센트", "프로", "パーセント", "パーセンテージ", "%", "％", "٪"];

/** Words that make a four-digit number a year (before it), and the signs after it. */
export const YEAR_BEFORE = ["in", "since", "by", "from", "until", "till", "during", "before", "after", "year", "of", "circa", "around", "سال", "年", "년"];
export const YEAR_AFTER = ["年", "년", "میں", "ء", "s", "'s", "’s"];

export const TITLES_LATIN = ["dr", "mr", "mrs", "ms", "prof", "professor", "president", "prime minister", "king", "queen", "prince", "princess", "sir", "general", "captain", "senator", "minister", "judge", "sheikh", "imam", "pope", "emperor", "sultan"];
export const TITLES_UR = ["ڈاکٹر", "پروفیسر", "صدر", "وزیراعظم", "وزیر اعظم", "جناب", "محترم", "محترمہ", "شیخ", "امام", "بادشاہ", "سلطان", "جنرل", "قائداعظم", "علامہ"];
export const TITLES_KO_AFTER = ["박사", "교수", "대통령", "총리", "장관", "씨", "선생님", "회장", "감독", "의원", "왕", "장군"];
export const TITLES_JA_AFTER = ["さん", "氏", "博士", "教授", "首相", "大統領", "先生", "選手", "監督", "社長", "王", "将軍"];

/** Words that start a sentence and look like a name when capitalised. */
export const NOT_NAMES = new Set(["the", "a", "an", "in", "on", "at", "this", "that", "these", "those", "it", "he", "she", "we", "they", "and", "but", "if", "when", "while", "after", "before", "then", "now", "today", "so", "as", "for", "with", "by", "from", "to", "of", "one", "his", "her", "their", "our", "my", "your", "what", "why", "how", "who", "where", "there", "here", "also", "however", "meanwhile", "later", "earlier", "next", "first", "second", "third", "finally", "some", "many", "most", "every", "each", "no", "not", "yes", "once", "since", "because", "although", "though", "despite", "during", "until", "according", "imagine", "let", "see", "look", "think", "remember", "welcome"]);

export const COMPARISON_PATTERNS: readonly RegExp[] = [
  /\b(?:vs\.?|versus)\b/giu,
  /\bcompared (?:to|with)\b/giu,
  /\b(?:more|less|fewer|greater|bigger|smaller|larger|higher|lower|faster|slower|older|younger|better|worse|cheaper|longer|shorter) than\b/giu,
  /\b(?:twice|three times|four times|ten times|double|triple|half) (?:as|the)\b/giu,
  /(?:کے مقابلے میں|کے مقابلے|سے زیادہ|سے کم|کی نسبت|بمقابلہ)/gu,
  /(?:에 비해|와 비교|과 비교|보다 (?:많|적|크|작|높|낮|빠르|느리)|대비)/gu,
  /(?:に比べて|と比べて|に対して|より(?:多|少|大き|小さ|高|低|速|遅)|対)/gu,
];

export const LIST_PATTERNS: readonly RegExp[] = [
  /\b(?:top|best|worst)\s+(?:\d+|three|four|five|six|seven|eight|nine|ten)\b/giu,
  /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:reasons|ways|steps|tips|things|facts|rules|types|kinds|signs|ideas|secrets|lessons|mistakes|stages)\b/giu,
  /\bstep\s+(?:one|1)\b/giu,
  /(?:\d+|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس)\s+(?:وجوہات|طریقے|اقدامات|باتیں|چیزیں|اصول|اقسام|نکات)/gu,
  /(?:\d+|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*가지/gu,
  /(?:\d+|二|三|四|五|六|七|八|九|十)つの/gu,
  /(?:\d+|[一二三四五六七八九十])(?:つ目|番目)/gu,
];

/** Words that, when two or more are spoken in one scene, mean the narrator is counting through items. */
export const ORDINALS: readonly (readonly string[])[] = [
  ["first", "firstly", "second", "secondly", "third", "thirdly", "fourth", "finally", "lastly", "next"],
  ["پہلا", "پہلی", "پہلے", "دوسرا", "دوسری", "دوسرے", "تیسرا", "تیسری", "تیسرے", "چوتھا", "آخر"],
  ["첫째", "둘째", "셋째", "넷째", "첫", "번째", "마지막으로", "먼저"],
  ["まず", "次に", "最後に", "第一", "第二", "第三", "一つ目", "二つ目", "三つ目", "最初に", "そして"],
];
