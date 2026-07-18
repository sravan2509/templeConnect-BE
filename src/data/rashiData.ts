export interface Rashi {
  id: number;
  name: string;
  englishName: string;
  startDeg: number;
  endDeg: number;
  rulingPlanet: string;
  element: string;
  quality: string;
  deities: string[];
}

export const RASHIS: Rashi[] = [
  { id: 1, name: "Mesha", englishName: "Aries", startDeg: 0, endDeg: 30, rulingPlanet: "Mars", element: "Fire", quality: "Cardinal", deities: ["Hanuman", "Kartikeya", "Surya"] },
  { id: 2, name: "Vrishabha", englishName: "Taurus", startDeg: 30, endDeg: 60, rulingPlanet: "Venus", element: "Earth", quality: "Fixed", deities: ["Lakshmi", "Saraswati", "Krishna"] },
  { id: 3, name: "Mithuna", englishName: "Gemini", startDeg: 60, endDeg: 90, rulingPlanet: "Mercury", element: "Air", quality: "Mutable", deities: ["Vishnu", "Ganesha"] },
  { id: 4, name: "Karka", englishName: "Cancer", startDeg: 90, endDeg: 120, rulingPlanet: "Moon", element: "Water", quality: "Cardinal", deities: ["Shiva", "Krishna", "Durga"] },
  { id: 5, name: "Simha", englishName: "Leo", startDeg: 120, endDeg: 150, rulingPlanet: "Sun", element: "Fire", quality: "Fixed", deities: ["Shiva", "Surya"] },
  { id: 6, name: "Kanya", englishName: "Virgo", startDeg: 150, endDeg: 180, rulingPlanet: "Mercury", element: "Earth", quality: "Mutable", deities: ["Durga", "Saraswati", "Ganesha"] },
  { id: 7, name: "Tula", englishName: "Libra", startDeg: 180, endDeg: 210, rulingPlanet: "Venus", element: "Air", quality: "Cardinal", deities: ["Lakshmi", "Krishna"] },
  { id: 8, name: "Vrishchika", englishName: "Scorpio", startDeg: 210, endDeg: 240, rulingPlanet: "Mars", element: "Water", quality: "Fixed", deities: ["Hanuman", "Ganesha", "Shiva"] },
  { id: 9, name: "Dhanu", englishName: "Sagittarius", startDeg: 240, endDeg: 270, rulingPlanet: "Jupiter", element: "Fire", quality: "Mutable", deities: ["Vishnu", "Hanuman"] },
  { id: 10, name: "Makara", englishName: "Capricorn", startDeg: 270, endDeg: 300, rulingPlanet: "Saturn", element: "Earth", quality: "Cardinal", deities: ["Hanuman", "Shiva"] },
  { id: 11, name: "Kumbha", englishName: "Aquarius", startDeg: 300, endDeg: 330, rulingPlanet: "Saturn", element: "Air", quality: "Fixed", deities: ["Hanuman", "Ganesha", "Shiva"] },
  { id: 12, name: "Meena", englishName: "Pisces", startDeg: 330, endDeg: 360, rulingPlanet: "Jupiter", element: "Water", quality: "Mutable", deities: ["Vishnu", "Durga"] },
];
