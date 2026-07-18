import { getSearchKeywords } from "../data/deityTempleKeywords";

export interface DeityRecommendation {
  primaryDeity: string;
  nakshatraDeity: string;
  rashiDeities: string[];
  description: string;
  searchKeywords: string[];
}

export function getDeityRecommendation(
  nakshatra: { name: string; presidingDeity: string; templeDeity: string },
  rashi: { name: string; englishName: string; deities: string[] }
): DeityRecommendation {
  const primaryDeity = nakshatra.templeDeity;

  const rashiDeities = (rashi.deities || []).filter((d) => d !== primaryDeity);
  const searchKeywords = getSearchKeywords(primaryDeity);

  const description = [
    `Based on your birth star (Nakshatra) "${nakshatra.name}" and zodiac sign (Rashi) "${rashi.name}" (${rashi.englishName}):`,
    ``,
    `• Your Nakshatra's presiding deity is ${nakshatra.presidingDeity}.`,
    `• The recommended god for temple worship is Lord ${primaryDeity}.`,
    `• Visiting a ${primaryDeity} temple is considered highly auspicious for people born under ${nakshatra.name} Nakshatra.`,
    ...(rashiDeities.length > 0
      ? [``, `Additionally, based on your ${rashi.name} Rashi, you may also worship: ${rashiDeities.join(", ")}.`]
      : []),
  ].join("\n");

  return { primaryDeity, nakshatraDeity: nakshatra.presidingDeity, rashiDeities, description, searchKeywords };
}
