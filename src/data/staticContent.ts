// Built-in content shown until admins add their own (knowledge base) and
// rashi-based guidance used by the astrology endpoints.

export const knowledgeBaseArticles = [
  {
    id: "kb-1", category: "cultural", title: "Why We Ring the Temple Bell",
    summary: "The significance of the ghanti before darshan.",
    content: "Devotees ring the temple bell (ghanti) on entering the sanctum. Its sound is said to announce the devotee's arrival to the deity, drive away distracting thoughts and focus the mind for darshan. The resonant tone of the metal alloy is traditionally associated with the sacred syllable Om.",
  },
  {
    id: "kb-2", category: "kids", title: "The Story of Hanuman",
    summary: "A short story for children about devotion and strength.",
    content: "As a child, Hanuman saw the rising Sun and, thinking it was a ripe fruit, leapt into the sky to catch it! The gods were astonished by his strength. Later in life Hanuman used his great strength not for himself but in loyal service of Lord Rama — teaching us that true strength is in humility and devotion.",
  },
  {
    id: "kb-3", category: "etiquette", title: "How to Perform Namaskar Correctly",
    summary: "Step-by-step guide to greeting deities respectfully.",
    content: "Join your palms together in front of your chest, fingers pointing upward. Gently bow your head towards your hands while facing the deity. Many devotees close their eyes briefly and offer a short prayer. Avoid greeting with one hand or while holding footwear or bags.",
  },
  {
    id: "kb-4", category: "cultural", title: "Meaning of Prasad",
    summary: "Why offerings are shared after puja.",
    content: "Prasad is food first offered to the deity and then distributed to devotees as a blessing. It is received with the right hand (or both hands), never refused, and shared with others — symbolising that grace is meant to be shared.",
  },
  {
    id: "kb-5", category: "kids", title: "Ganesha and the Moon",
    summary: "A classic tale about humility.",
    content: "After a grand feast on his birthday, Lord Ganesha was riding home on his mouse when he slipped and fell. The Moon laughed at him. Ganesha cursed the Moon to lose its glow, but forgave it when the Moon apologised — which is why the Moon waxes and wanes. The story reminds us never to mock others.",
  },
  {
    id: "kb-6", category: "etiquette", title: "Temple Dress Code Explained",
    summary: "What to wear (and avoid) when visiting a temple.",
    content: "Wear modest, clean clothing that covers shoulders and knees — traditional wear such as a saree, salwar, dhoti or kurta is preferred at many temples. Remove footwear before entering, avoid leather items, and check the specific temple's rules, as some have strict dress codes.",
  },
];

export const forecastByRashi: Record<string, string> = {
  Mesha: "High energy and initiative — a good time to start new ventures, but watch for impatience.",
  Vrishabha: "A stable and grounded period ahead — favorable for financial decisions and long-term commitments.",
  Mithuna: "Communication flourishes — good for learning, writing, and reconnecting with friends.",
  Karka: "Emotional and family matters take center stage — nurture close relationships.",
  Simha: "Confidence and recognition grow — a good period for leadership and visibility.",
  Kanya: "Focus sharpens on health and daily routines — small disciplined changes pay off.",
  Tula: "Balance and partnerships are favored — good time for collaboration and diplomacy.",
  Vrishchika: "Transformation and deep focus — good for research, introspection, and resolving old matters.",
  Dhanu: "Optimism and travel are favored — a good time for higher learning or pilgrimage.",
  Makara: "Discipline and career matters are highlighted — steady effort brings recognition.",
  Kumbha: "Innovation and community connections grow — good for group efforts and new ideas.",
  Meena: "Intuition and spirituality are heightened — a favorable time for rituals and reflection.",
};

const recommendationsByRashi: Record<string, string[]> = {
  Mesha: ["Recite the Hanuman Chalisa on Tuesdays", "Offer red flowers to Lord Kartikeya", "Fast or eat simply on Tuesdays"],
  Vrishabha: ["Perform Lakshmi Puja on Fridays", "Chant the Vishnu Sahasranama", "Offer white flowers and sweets on Fridays"],
  Mithuna: ["Offer durva grass to Lord Ganesha on Wednesdays", "Chant 'Om Namo Narayanaya'", "Donate green vegetables or books"],
  Karka: ["Offer water and milk to the Shiva Lingam on Mondays", "Chant the Shiva Panchakshari mantra", "Light a ghee lamp in the evening"],
  Simha: ["Offer water to the rising Sun (Surya Arghya)", "Recite the Aditya Hridayam on Sundays", "Visit a Shiva temple on Sundays"],
  Kanya: ["Worship Lord Ganesha on Wednesdays", "Recite the Durga Saptashati verses", "Feed cows or donate to education"],
  Tula: ["Perform Lakshmi Puja on Fridays", "Recite the Shri Suktam", "Offer white sweets at a Krishna temple"],
  Vrishchika: ["Recite the Hanuman Chalisa on Tuesdays", "Offer red flowers at a Hanuman temple", "Chant the Shiva Panchakshari mantra"],
  Dhanu: ["Worship Lord Vishnu on Thursdays", "Offer yellow flowers and turmeric", "Donate to teachers or students"],
  Makara: ["Light a sesame-oil lamp on Saturdays", "Recite the Hanuman Chalisa", "Help the elderly or labourers"],
  Kumbha: ["Light a sesame-oil lamp on Saturdays", "Offer bilva leaves to Lord Shiva", "Serve in community activities"],
  Meena: ["Worship Lord Vishnu on Thursdays", "Recite the Vishnu Sahasranama", "Offer yellow sweets at a Vishnu temple"],
};

const defaultRecommendations = ["Visit a nearby temple this week", "Light a diya during morning prayers", "Practice gratitude journaling"];

export function getRecommendationsFor(rashi: string | null): string[] {
  return (rashi ? recommendationsByRashi[rashi] : undefined) ?? defaultRecommendations;
}
