/**
 * The programmatic page catalog: one row per page BODH's site should have. Content is
 * drafted by the SEO agent; Panchang pages are filled from the Panchang engine each day.
 */
import { CITIES, NAKSHATRAS, RASHIS } from "./panchang";

export type Template = "planet_house" | "nakshatra" | "yoga" | "lagna" | "panchang_city" | "blog";

export const TEMPLATE_LABELS: Record<Template, string> = {
  planet_house: "Planets in houses",
  nakshatra: "Nakshatras",
  yoga: "Yogas",
  lagna: "Lagnas",
  panchang_city: "City Panchang",
  blog: "Blogs",
};

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
  for (const p of PLANETS) {
    for (let h = 1; h <= 12; h++) {
      pages.push({
        template: "planet_house",
        slug: `${slugify(p.name)}-in-${ordinal(h)}-house`,
        title: `${p.name} (${p.sanskrit}) in the ${ordinal(h)} house`,
        keyword: `${p.name.toLowerCase()} in ${ordinal(h)} house`,
        params: { planet: p.name, sanskrit: p.sanskrit, house: h, priority: p.weight * HOUSE_WEIGHT[h]! },
      });
    }
  }
  NAKSHATRAS.forEach((n, i) =>
    pages.push({ template: "nakshatra", slug: `${slugify(n)}-nakshatra`, title: `${n} Nakshatra`, keyword: `${n.toLowerCase()} nakshatra`, params: { nakshatra: n, number: i + 1, priority: POPULAR_NAKSHATRAS.has(n) ? 80 : 50 } }),
  );
  RASHIS.forEach((r, i) =>
    pages.push({
      template: "lagna",
      slug: `${slugify(r)}-lagna`,
      title: `${r} Lagna (${WESTERN_SIGNS[i]} ascendant)`,
      keyword: `${WESTERN_SIGNS[i]!.toLowerCase()} ascendant`,
      params: { rashi: r, sign: WESTERN_SIGNS[i], number: i + 1, priority: 60 },
    }),
  );
  for (const y of YOGA_LIST) {
    pages.push({ template: "yoga", slug: slugify(y.name), title: y.name, keyword: y.name.toLowerCase(), params: { yoga: y.name, rule: y.rule, priority: POPULAR_YOGAS.has(y.name) ? 85 : 45 } });
  }
  for (const c of CITIES) {
    pages.push({ template: "panchang_city", slug: `panchang-${c.slug}`, title: `Today's Panchang in ${c.name}`, keyword: `panchang today ${c.name.toLowerCase()}`, params: { city: c.slug, priority: 40 } });
  }
  return pages;
}
