/**
 * The page catalog: one row per page bodhlok.com should have, for Bodhlok's audience of
 * practising astrologers, students, teachers and institutes. Comparison and software pages
 * answer "which software"; module guides show a technique on the desk; the learner topics
 * (placements, nakshatras, yogas, lagnas) are study guides, never horoscopes. Content is
 * drafted by the SEO agent. City Panchang pages were retired: a consumer search.
 */
import { NAKSHATRAS, RASHIS } from "./panchang";

export type Template = "compare" | "guide" | "planet_house" | "nakshatra" | "yoga" | "lagna" | "panchang_city" | "blog";

export const TEMPLATE_LABELS: Record<Template, string> = {
  compare: "Software comparisons",
  guide: "Module guides",
  planet_house: "Placements (study guides)",
  nakshatra: "Nakshatras (study guides)",
  yoga: "Yogas (study guides)",
  lagna: "Lagnas (study guides)",
  panchang_city: "City Panchang (retired)",
  blog: "Blogs",
};

/** Software and comparison pages: what astrologers and AI assistants ask when choosing a tool. */
export const COMPARE_PAGES: { slug: string; title: string; keyword: string; angle: string }[] = [
  { slug: "best-vedic-astrology-software-for-professional-astrologers", title: "Best Vedic astrology software for professional astrologers (2026)", keyword: "vedic astrology software", angle: "An honest field guide: JHora, Parashara's Light, LeoStar, Kala, Shri Jyoti Star, AstroSage, and where a browser-based desk fits" },
  { slug: "bodhlok-vs-jagannatha-hora", title: "Bodhlok vs Jagannatha Hora: browser desk or Windows classic", keyword: "jagannatha hora alternative", angle: "JHora is free, deep and Windows-only; Bodhlok runs in any browser with client notes and an AI consult" },
  { slug: "jagannatha-hora-for-mac-and-browser", title: "Jagannatha Hora on a Mac: what the alternatives are", keyword: "jagannatha hora for mac", angle: "Mac and tablet users can't run JHora; the browser options and what each gives up" },
  { slug: "bodhlok-vs-parasharas-light", title: "Bodhlok vs Parashara's Light", keyword: "parashara's light software", angle: "The research classic against a desk built for consultations" },
  { slug: "bodhlok-vs-leostar", title: "Bodhlok vs LeoStar", keyword: "leostar astrology software", angle: "Reports and printing against an online desk with context" },
  { slug: "bodhlok-vs-astrosage-for-professionals", title: "AstroSage vs Bodhlok for a working astrologer", keyword: "astrosage for astrologers", angle: "A consumer kundli site against a professional desk: what each is for" },
  { slug: "kp-astrology-software-online", title: "KP astrology software online: 249 sub-lords, ruling planets and horary in the browser", keyword: "kp astrology software", angle: "What KP practitioners need and how the desk shows it" },
  { slug: "vedic-astrology-software-in-hindi", title: "Vedic astrology software with Hindi: charts, dashas and an AI consult in Hindi", keyword: "astrology software in hindi", angle: "Interfaces and explanations in Hindi, for practitioners who consult in Hindi" },
  { slug: "astrology-software-for-institutes-and-teachers", title: "Astrology software for institutes and teachers: one desk for the whole class", keyword: "astrology software for institutes", angle: "Seats, roles, shared sample charts, teaching from one screen" },
  { slug: "client-chart-management-for-astrologers", title: "Client charts, notes and consultation history in one place", keyword: "astrology client management software", angle: "Running a practice, not just casting charts" },
  { slug: "online-vs-desktop-astrology-software", title: "Online vs desktop astrology software: what changes for a practitioner", keyword: "online astrology software", angle: "Updates, access from anywhere, privacy, and what desktop still does better" },
  { slug: "bhrigu-nandi-nadi-software", title: "Bhrigu Nandi Nadi software: the calculations and views BNN practitioners need", keyword: "bhrigu nandi nadi software", angle: "A specialist module most software lacks" },
  { slug: "how-bodhlok-ai-works", title: "How Bodhlok's AI works: calculation, rules, context, then language", keyword: "ai astrology software", angle: "The four layers from the launch film; the LLM never invents astrology" },
];

/** Module and technique guides, each shown on the desk with a sample chart. */
export const GUIDE_PAGES: { slug: string; title: string; keyword: string; module: string }[] = [
  { slug: "ashtakavarga-on-the-desk", title: "Reading Ashtakavarga: bindus, SAV and transits on a sample chart", keyword: "ashtakavarga calculator", module: "Ashtakavarga" },
  { slug: "kp-sub-lords-and-horary-by-number", title: "KP sub-lords and horary by number: a working method", keyword: "kp horary astrology", module: "KP" },
  { slug: "jaimini-chara-karakas-and-chara-dasha", title: "Jaimini chara karakas, arudha padas and Chara dasha, step by step", keyword: "jaimini astrology chara dasha", module: "Jaimini" },
  { slug: "vimshottari-dasha-to-the-pratyantar", title: "Vimshottari dasha to the pratyantar: timing an event on a sample chart", keyword: "vimshottari dasha calculator", module: "Dashas" },
  { slug: "yogini-and-ashtottari-dasha", title: "Yogini and Ashtottari dashas: when to use them beside Vimshottari", keyword: "yogini dasha", module: "Dashas" },
  { slug: "shadbala-and-graha-bala", title: "Shadbala and graha bala: judging planetary strength before you judge the chart", keyword: "shadbala calculator", module: "Strengths" },
  { slug: "bhava-chalit-and-house-cusps", title: "Bhava Chalit: when a planet changes house and why it matters", keyword: "bhava chalit chart", module: "D1" },
  { slug: "shodashavarga-divisional-charts", title: "The Shodashavarga: which divisional chart answers which question", keyword: "divisional charts vedic astrology", module: "Divisional charts" },
  { slug: "navamsha-d9-in-consultation", title: "Reading the Navamsha (D9) beside D1 in a consultation", keyword: "navamsa chart", module: "Divisional charts" },
  { slug: "dashamsha-d10-for-career-questions", title: "Dashamsha (D10) for career questions: the walkthrough", keyword: "d10 chart career", module: "Divisional charts" },
  { slug: "prashna-chart-method", title: "Prashna: answering a question from the chart of the moment", keyword: "prashna kundli", module: "Prashna" },
  { slug: "muhurta-workflow-on-the-desk", title: "Muhurta on the desk: from requirement to candidate dates", keyword: "muhurta calculator", module: "Muhurta" },
  { slug: "marriage-muhurta-tarabala-chandrabala-gurubala", title: "Marriage muhurta: Tarabala, Chandrabala, Gurubala and Graha Maitri for two charts", keyword: "marriage muhurat calculator", module: "Muhurta" },
  { slug: "varshaphala-annual-chart", title: "Varshaphala: reading the annual chart", keyword: "varshaphala", module: "Varshaphala" },
  { slug: "bhrigu-nandi-nadi-basics", title: "Bhrigu Nandi Nadi: reading planetary connections without houses", keyword: "bhrigu nandi nadi", module: "BNN" },
  { slug: "panch-pakshi-in-practice", title: "Panch Pakshi in practice: the bird, the activity, the hour", keyword: "panch pakshi", module: "Panch Pakshi" },
  { slug: "kundli-matching-for-practitioners", title: "Kundli matching beyond the 36 gunas: what a practitioner checks", keyword: "kundli matching", module: "Matching" },
  { slug: "sudarshan-chakra-reading", title: "Sudarshan Chakra: reading from lagna, Moon and Sun together", keyword: "sudarshan chakra", module: "D1" },
  { slug: "gochar-transit-workflow", title: "Transits (gochar) in a consultation: Shani, Guru, Rahu-Ketu on the desk", keyword: "gochar analysis", module: "Transits" },
  { slug: "career-question-walkthrough", title: "A career question, start to finish: question, charts, dasha, strength, rules, context, answer", keyword: "career astrology analysis", module: "Consult" },
  { slug: "client-notes-and-consultation-history", title: "Client notes and consultation history: picking up where the last reading ended", keyword: "astrologer consultation notes", module: "Practice" },
  { slug: "ai-consult-in-hindi-and-english", title: "The AI consult: what it reads, what it says, and what stays with you", keyword: "ai astrology consultation", module: "Consult" },
];

export interface CatalogPage {
  template: Template;
  slug: string;
  title: string;
  keyword: string;
  params: Record<string, unknown>;
}

/** weight: how much people search for the planet, used to order pages until real volumes arrive. */
export const PLANETS = [
  { name: "Sun", sanskrit: "Surya", weight: 5 },
  { name: "Moon", sanskrit: "Chandra", weight: 7 },
  { name: "Mars", sanskrit: "Mangal", weight: 7 },
  { name: "Mercury", sanskrit: "Budh", weight: 4 },
  { name: "Jupiter", sanskrit: "Guru", weight: 8 },
  { name: "Venus", sanskrit: "Shukra", weight: 7 },
  { name: "Saturn", sanskrit: "Shani", weight: 10 },
  { name: "Rahu", sanskrit: "Rahu", weight: 9 },
  { name: "Ketu", sanskrit: "Ketu", weight: 8 },
];
/** Houses people ask about most: marriage, self, career, children, home, wealth. */
const HOUSE_WEIGHT = [0, 9, 6, 4, 6, 7, 4, 10, 6, 6, 9, 5, 6];
const POPULAR_NAKSHATRAS = new Set(["Rohini", "Ashwini", "Pushya", "Mula", "Ashlesha", "Magha", "Revati", "Swati", "Chitra", "Hasta", "Shravana", "Krittika"]);
const POPULAR_YOGAS = new Set(["Mangal Dosha", "Raja Yoga", "Gajakesari Yoga", "Kala Sarpa Yoga", "Dhana Yoga", "Viparita Raja Yoga", "Neecha Bhanga Raja Yoga", "Budhaditya Yoga", "Guru Chandala Yoga"]);
const AUDIENCE = "Study guide for astrologers and serious students: how to read it in a chart, never a prediction for the reader. CTA: try it on a sample chart in the free desk.";

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const WESTERN_SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

/** Classical yogas people search for, with the condition the page explains. */
export const YOGA_LIST: { name: string; rule: string }[] = [
  { name: "Gajakesari Yoga", rule: "Jupiter in a kendra (1st, 4th, 7th or 10th) from the Moon" },
  { name: "Budhaditya Yoga", rule: "Sun and Mercury together in one sign" },
  { name: "Ruchaka Yoga", rule: "Mars in its own sign or exalted, in a kendra from the lagna" },
  { name: "Bhadra Yoga", rule: "Mercury in its own sign or exalted, in a kendra from the lagna" },
  { name: "Hamsa Yoga", rule: "Jupiter in its own sign or exalted, in a kendra from the lagna" },
  { name: "Malavya Yoga", rule: "Venus in its own sign or exalted, in a kendra from the lagna" },
  { name: "Shasha Yoga", rule: "Saturn in its own sign or exalted, in a kendra from the lagna" },
  { name: "Chandra Mangala Yoga", rule: "Moon and Mars together, or in mutual aspect" },
  { name: "Adhi Yoga", rule: "Benefics in the 6th, 7th and 8th from the Moon" },
  { name: "Sunapha Yoga", rule: "A planet other than the Sun in the 2nd from the Moon" },
  { name: "Anapha Yoga", rule: "A planet other than the Sun in the 12th from the Moon" },
  { name: "Durudhara Yoga", rule: "Planets other than the Sun on both sides of the Moon" },
  { name: "Kemadruma Yoga", rule: "No planets in the 2nd or 12th from the Moon" },
  { name: "Vesi Yoga", rule: "A planet other than the Moon in the 2nd from the Sun" },
  { name: "Vasi Yoga", rule: "A planet other than the Moon in the 12th from the Sun" },
  { name: "Ubhayachari Yoga", rule: "Planets other than the Moon on both sides of the Sun" },
  { name: "Amala Yoga", rule: "A natural benefic in the 10th from the lagna or the Moon" },
  { name: "Saraswati Yoga", rule: "Jupiter, Venus and Mercury in kendras, trikonas or the 2nd, with Jupiter strong" },
  { name: "Lakshmi Yoga", rule: "A strong 9th lord in a kendra or trikona, with a strong lagna lord" },
  { name: "Dhana Yoga", rule: "Links between the lords of the 1st, 2nd, 5th, 9th and 11th houses" },
  { name: "Raja Yoga", rule: "Links between the lords of kendras and trikonas" },
  { name: "Viparita Raja Yoga", rule: "Lords of the 6th, 8th and 12th placed in each other's houses" },
  { name: "Neecha Bhanga Raja Yoga", rule: "A debilitated planet whose debilitation is cancelled" },
  { name: "Parivartana Yoga", rule: "Two planets in each other's signs" },
  { name: "Kala Sarpa Yoga", rule: "All seven planets between Rahu and Ketu (a later, debated combination)" },
  { name: "Mangal Dosha", rule: "Mars in the 1st, 2nd, 4th, 7th, 8th or 12th house" },
  { name: "Guru Chandala Yoga", rule: "Jupiter conjunct Rahu" },
  { name: "Shakata Yoga", rule: "The Moon in the 6th, 8th or 12th from Jupiter" },
];

export function pageCatalog(): CatalogPage[] {
  const pages: CatalogPage[] = [];
  for (const c of COMPARE_PAGES) {
    pages.push({ template: "compare", slug: c.slug, title: c.title, keyword: c.keyword, params: { angle: c.angle, priority: 100 } });
  }
  for (const g of GUIDE_PAGES) {
    pages.push({ template: "guide", slug: g.slug, title: g.title, keyword: g.keyword, params: { module: g.module, priority: 90, audience: AUDIENCE } });
  }
  for (const p of PLANETS) {
    for (let h = 1; h <= 12; h++) {
      pages.push({
        template: "planet_house",
        slug: `${slugify(p.name)}-in-${ordinal(h)}-house`,
        title: `${p.name} (${p.sanskrit}) in the ${ordinal(h)} house: how to read it in a chart`,
        keyword: `${p.name.toLowerCase()} in ${ordinal(h)} house`,
        params: { planet: p.name, sanskrit: p.sanskrit, house: h, priority: Math.round((p.weight * HOUSE_WEIGHT[h]!) / 2), audience: AUDIENCE },
      });
    }
  }
  NAKSHATRAS.forEach((n, i) =>
    pages.push({ template: "nakshatra", slug: `${slugify(n)}-nakshatra`, title: `${n} nakshatra: reading it in a chart`, keyword: `${n.toLowerCase()} nakshatra`, params: { nakshatra: n, number: i + 1, priority: POPULAR_NAKSHATRAS.has(n) ? 45 : 30, audience: AUDIENCE } }),
  );
  RASHIS.forEach((r, i) =>
    pages.push({
      template: "lagna",
      slug: `${slugify(r)}-lagna`,
      title: `${r} lagna (${WESTERN_SIGNS[i]} ascendant): house lords, strengths and what to check first`,
      keyword: `${WESTERN_SIGNS[i]!.toLowerCase()} ascendant vedic`,
      params: { rashi: r, sign: WESTERN_SIGNS[i], number: i + 1, priority: 40, audience: AUDIENCE },
    }),
  );
  for (const y of YOGA_LIST) {
    pages.push({ template: "yoga", slug: slugify(y.name), title: `${y.name}: the rule, how to spot it, and what weakens it`, keyword: y.name.toLowerCase(), params: { yoga: y.name, rule: y.rule, priority: POPULAR_YOGAS.has(y.name) ? 50 : 25, audience: AUDIENCE } });
  }
  return pages;
}
