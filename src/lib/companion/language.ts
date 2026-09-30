/**
 * Language detection for Hindi (Devanagari), Romanized Hindi/Hinglish and English.
 * Goes beyond a keyword list: it combines a function-word lexicon, Hindi
 * morphology (verb/case endings), and character-shape heuristics.
 */

export type DetectedLanguage = "hi" | "hinglish" | "en";
export type PreferredLanguage = "auto" | "hinglish" | "hi" | "en";

export type LanguageDetection = {
  language: DetectedLanguage;
  devanagariRatio: number;
  hindiTokenRatio: number;
  confidence: number;
  matched: string[];
  tokens: number;
};

// High-signal Romanized Hindi function words, pronouns, postpositions, verbs.
const HINDI_LEXICON = new Set<string>(
  `main mai mein me hum ham tum tu tumhe tumhein tumhara tumhari tumhare aap aapka aapki aapke
   mera meri mere hamara hamari hamare uska uski uske iska iski iske unka unki unke
   hai hain ho hu hun hoon tha thi the thay honge hoga hogi hoge raha rahi rahe rha rhi rhe
   kar karo karna karta karti karte karunga karungi karenge kiya kiye ki kya kyu kyun kyon
   nahi nahin nai na mat mt bilkul haan han ha ji jee accha acha achha theek thik sahi
   ka ke ki ko se par pe mein tak liye lie wala wali wale bhi hi to toh
   aur ya lekin magar kyunki agar phir fir abhi ab kal aaj raat din subah shaam
   bahut bohot bhut thoda thodi zyada jyada kam sab sabhi kuch kuchh koi kisi kisne
   yaar bhai dost pyaar pyar dil jaan zindagi khush khushi udaas dukh gussa
   baat bat batao bata bolo bol suno sun samajh samjho dekho dekh chal chalo aao aa jao ja
   mujhe mujhko tujhe usko unko hame hamein kisko yeh ye woh wo vah jo jab tab kaise kaisa kaisi
   kahan kaha kab kitna kitni kitne kaun kon matlab pata chahiye chahta chahti sakta sakti sakte
   laga lagi lage lagta lagti mil mila milta jaana jana aana ana khana peena sona uthna
   thak thaka thaki miss yaad bore pareshan tension khyal khayal dhyan`
    .split(/\s+/)
    .filter(Boolean),
);

const ENGLISH_STOPWORDS = new Set<string>(
  `the a an is are was were be been being of to in on for with and or but if then than that this
   these those i you he she it we they my your his her its our their me him them do does did done
   have has had will would can could should shall may might must about after before because while
   what when where which who whom how why not no yes please thanks thank sorry hello hi hey`
    .split(/\s+/)
    .filter(Boolean),
);

// Hindi morphology: common endings that rarely appear in English words.
const HINDI_SUFFIXES = [
  "onka", "onke", "onki", "ontha", "iye", "iyega", "unga", "ungi", "enge", "oge", "ogi",
  "taa", "tha", "thi", "raha", "rahi", "rahe", "wala", "wali", "wale", "kar", "gaya", "gayi",
];

const DEVANAGARI = /[\u0900-\u097F]/g;

export function detectLanguage(rawText: string): LanguageDetection {
  const text = (rawText ?? "").trim();
  if (!text) {
    return { language: "en", devanagariRatio: 0, hindiTokenRatio: 0, confidence: 0, matched: [], tokens: 0 };
  }

  const letters = text.replace(/[^\p{L}]/gu, "");
  const devanagariCount = (text.match(DEVANAGARI) ?? []).length;
  const devanagariRatio = letters.length ? devanagariCount / letters.length : 0;

  if (devanagariRatio > 0.15) {
    const latinLetters = (text.match(/[a-z]/gi) ?? []).length;
    const mixed = latinLetters / Math.max(letters.length, 1) > 0.25;
    return {
      language: mixed ? "hinglish" : "hi",
      devanagariRatio,
      hindiTokenRatio: 1,
      confidence: 0.95,
      matched: ["devanagari"],
      tokens: 0,
    };
  }

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return { language: "en", devanagariRatio, hindiTokenRatio: 0, confidence: 0.2, matched: [], tokens: 0 };
  }

  const matched: string[] = [];
  let hindiScore = 0;
  let englishScore = 0;

  for (const token of tokens) {
    if (HINDI_LEXICON.has(token)) {
      hindiScore += 1;
      matched.push(token);
      continue;
    }
    if (ENGLISH_STOPWORDS.has(token)) {
      englishScore += 1;
      continue;
    }
    if (token.length >= 4 && HINDI_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
      hindiScore += 0.7;
      matched.push(token);
      continue;
    }
    // Romanized Hindi rarely uses these letter clusters.
    if (/(?:aa|ee|oo|kh|gh|ch|jh|th|dh|ph|bh|sh)/.test(token) && !ENGLISH_STOPWORDS.has(token)) {
      hindiScore += 0.15;
    }
  }

  const hindiTokenRatio = hindiScore / tokens.length;
  const englishRatio = englishScore / tokens.length;

  // Short messages: a single strong Hindi marker is enough ("kaise ho?").
  const strongMarkers = matched.length;
  const isHinglish =
    hindiTokenRatio >= 0.22 ||
    (tokens.length <= 6 && strongMarkers >= 1 && hindiTokenRatio > englishRatio) ||
    (hindiScore >= 2 && hindiScore >= englishScore);

  const confidence = Math.max(0.3, Math.min(0.98, Math.abs(hindiTokenRatio - englishRatio) + 0.35));

  return {
    language: isHinglish ? "hinglish" : "en",
    devanagariRatio,
    hindiTokenRatio: Number(hindiTokenRatio.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    matched: matched.slice(0, 8),
    tokens: tokens.length,
  };
}

const EXPLICIT_ENGLISH =
  /\b(in english|reply in english|answer in english|speak english|english me(in)?|english mein|switch to english)\b/i;
const EXPLICIT_HINDI =
  /\b(in hindi|hindi me(in)?|hindi mein|reply in hindi|hindi bolo|hinglish me(in)?|hinglish mein|speak hindi)\b/i;

/** Resolve the reply language from the user's setting plus this message. */
export function resolveReplyLanguage(
  message: string,
  preference: PreferredLanguage,
): { language: DetectedLanguage; reason: string; detection: LanguageDetection } {
  const detection = detectLanguage(message);

  if (EXPLICIT_ENGLISH.test(message)) {
    return { language: "en", reason: "user explicitly asked for English", detection };
  }
  if (EXPLICIT_HINDI.test(message)) {
    return { language: "hinglish", reason: "user explicitly asked for Hindi/Hinglish", detection };
  }
  if (preference === "en") return { language: "en", reason: "setting: English only", detection };
  if (preference === "hi") return { language: "hi", reason: "setting: Hindi only", detection };
  if (preference === "hinglish" && detection.language === "en" && detection.tokens > 0) {
    // Default preference is Hinglish: only switch to English when the message
    // is clearly English with no Hindi signals at all.
    return detection.hindiTokenRatio > 0
      ? { language: "hinglish", reason: "mixed signals, defaulting to Hinglish", detection }
      : { language: "en", reason: "clearly English message", detection };
  }
  if (preference === "hinglish") {
    return { language: detection.language === "hi" ? "hi" : "hinglish", reason: "setting: Hinglish default", detection };
  }
  return { language: detection.language, reason: "auto-detected from message", detection };
}

export function languageLabel(language: DetectedLanguage): string {
  return language === "hi" ? "हिंदी" : language === "hinglish" ? "Hinglish" : "English";
}

export function speechLocale(language: DetectedLanguage): string {
  return language === "en" ? "en-IN" : "hi-IN";
}
