export interface Nakshatra {
  id: number;
  name: string;
  startDeg: number;
  endDeg: number;
  presidingDeity: string;
  rulingPlanet: string;
  templeDeity: string;
  qualities: string;
}

export const NAKSHATRAS: Nakshatra[] = [
  { id: 1, name: "Ashwini", startDeg: 0, endDeg: 13.3333, presidingDeity: "Ashwini Kumaras", rulingPlanet: "Ketu", templeDeity: "Hanuman", qualities: "Swift, healing, pioneering" },
  { id: 2, name: "Bharani", startDeg: 13.3333, endDeg: 26.6667, presidingDeity: "Yama", rulingPlanet: "Venus", templeDeity: "Shiva", qualities: "Restraint, transformation, duty" },
  { id: 3, name: "Krittika", startDeg: 26.6667, endDeg: 40.0, presidingDeity: "Agni", rulingPlanet: "Sun", templeDeity: "Kartikeya", qualities: "Fiery, purifying, determined" },
  { id: 4, name: "Rohini", startDeg: 40.0, endDeg: 53.3333, presidingDeity: "Brahma", rulingPlanet: "Moon", templeDeity: "Krishna", qualities: "Creative, fertile, beautiful" },
  { id: 5, name: "Mrigashirsha", startDeg: 53.3333, endDeg: 66.6667, presidingDeity: "Soma", rulingPlanet: "Mars", templeDeity: "Shiva", qualities: "Searching, curious, gentle" },
  { id: 6, name: "Ardra", startDeg: 66.6667, endDeg: 80.0, presidingDeity: "Rudra", rulingPlanet: "Rahu", templeDeity: "Shiva", qualities: "Fierce, transformative, stormy" },
  { id: 7, name: "Punarvasu", startDeg: 80.0, endDeg: 93.3333, presidingDeity: "Aditi", rulingPlanet: "Jupiter", templeDeity: "Vishnu", qualities: "Renewing, nurturing, expansive" },
  { id: 8, name: "Pushya", startDeg: 93.3333, endDeg: 106.6667, presidingDeity: "Brihaspati", rulingPlanet: "Saturn", templeDeity: "Ganesha", qualities: "Auspicious, nourishing, spiritual" },
  { id: 9, name: "Ashlesha", startDeg: 106.6667, endDeg: 120.0, presidingDeity: "Nagas (Serpent Deities)", rulingPlanet: "Mercury", templeDeity: "Vishnu", qualities: "Mystical, intense, cunning" },
  { id: 10, name: "Magha", startDeg: 120.0, endDeg: 133.3333, presidingDeity: "Pitrs (Ancestors)", rulingPlanet: "Ketu", templeDeity: "Shiva", qualities: "Regal, authoritative, ancestral" },
  { id: 11, name: "Purva Phalguni", startDeg: 133.3333, endDeg: 146.6667, presidingDeity: "Bhaga", rulingPlanet: "Venus", templeDeity: "Lakshmi", qualities: "Pleasurable, creative, fortunate" },
  { id: 12, name: "Uttara Phalguni", startDeg: 146.6667, endDeg: 160.0, presidingDeity: "Aryaman", rulingPlanet: "Sun", templeDeity: "Surya", qualities: "Helpful, patronising, reliable" },
  { id: 13, name: "Hasta", startDeg: 160.0, endDeg: 173.3333, presidingDeity: "Savitr (Surya)", rulingPlanet: "Moon", templeDeity: "Vishnu", qualities: "Skilled, dexterous, creative" },
  { id: 14, name: "Chitra", startDeg: 173.3333, endDeg: 186.6667, presidingDeity: "Vishwakarma", rulingPlanet: "Mars", templeDeity: "Vishnu", qualities: "Artistic, brilliant, architectual" },
  { id: 15, name: "Swati", startDeg: 186.6667, endDeg: 200.0, presidingDeity: "Vayu", rulingPlanet: "Rahu", templeDeity: "Hanuman", qualities: "Independent, flexible, restless" },
  { id: 16, name: "Vishakha", startDeg: 200.0, endDeg: 213.3333, presidingDeity: "Indra-Agni", rulingPlanet: "Jupiter", templeDeity: "Kartikeya", qualities: "Goal-oriented, powerful, determined" },
  { id: 17, name: "Anuradha", startDeg: 213.3333, endDeg: 226.6667, presidingDeity: "Mitra", rulingPlanet: "Saturn", templeDeity: "Vishnu", qualities: "Devoted, friendly, exploratory" },
  { id: 18, name: "Jyeshtha", startDeg: 226.6667, endDeg: 240.0, presidingDeity: "Indra", rulingPlanet: "Mercury", templeDeity: "Shiva", qualities: "Senior, protective, courageous" },
  { id: 19, name: "Mula", startDeg: 240.0, endDeg: 253.3333, presidingDeity: "Nirriti", rulingPlanet: "Ketu", templeDeity: "Ganesha", qualities: "Rooting, investigative, destructive-creative" },
  { id: 20, name: "Purva Ashadha", startDeg: 253.3333, endDeg: 266.6667, presidingDeity: "Apah (Water Deity)", rulingPlanet: "Venus", templeDeity: "Lakshmi", qualities: "Invincible, purifying, energising" },
  { id: 21, name: "Uttara Ashadha", startDeg: 266.6667, endDeg: 280.0, presidingDeity: "Vishwadevas", rulingPlanet: "Sun", templeDeity: "Vishnu", qualities: "Universal, enduring, righteous" },
  { id: 22, name: "Shravana", startDeg: 280.0, endDeg: 293.3333, presidingDeity: "Vishnu", rulingPlanet: "Moon", templeDeity: "Vishnu", qualities: "Listening, learning, connected" },
  { id: 23, name: "Dhanishtha", startDeg: 293.3333, endDeg: 306.6667, presidingDeity: "Vasus", rulingPlanet: "Mars", templeDeity: "Hanuman", qualities: "Wealthy, musical, generous" },
  { id: 24, name: "Shatabhishak", startDeg: 306.6667, endDeg: 320.0, presidingDeity: "Varuna", rulingPlanet: "Rahu", templeDeity: "Shiva", qualities: "Healing, secretive, philosophical" },
  { id: 25, name: "Purva Bhadrapada", startDeg: 320.0, endDeg: 333.3333, presidingDeity: "Aja Ekapada", rulingPlanet: "Jupiter", templeDeity: "Shiva", qualities: "Passionate, fiery, transformative" },
  { id: 26, name: "Uttara Bhadrapada", startDeg: 333.3333, endDeg: 346.6667, presidingDeity: "Ahir Budhanya", rulingPlanet: "Saturn", templeDeity: "Vishnu", qualities: "Deep, wise, restrained" },
  { id: 27, name: "Revati", startDeg: 346.6667, endDeg: 360.0, presidingDeity: "Pushan", rulingPlanet: "Mercury", templeDeity: "Vishnu", qualities: "Nourishing, protective, travel" },
];
