const DEITY_SEARCH_KEYWORDS: Record<string, string[]> = {
  Shiva: ["Shiva", "Shiv", "Siva", "Mahadev", "Mahadeva", "Shankar", "Shanker", "Nataraja", "Lingam", "Linga", "Iswara", "Ishwara", "Eswara", "Rudra", "Kailasanathar", "Sundareswarar", "Meenakshi", "Ramalingam", "Someswara", "Bhimeswara", "Ramalingeswara", "Mallikarjuna", "Visweswara", "Viswanath", "Mukteswara", "Agastheswara", "Kapoteteswara", "Sangameswara", "Veerabhadra", "Veerabadhra", "Sivalayam", "Shivalayam"],
  Vishnu: ["Vishnu", "Venkateswara", "Venkateshwara", "Balaji", "Perumal", "Narayana", "Narayanan", "Ranganatha", "Ranganathar", "Srinivasa", "Padmanabha", "Jagannath", "Thirumal", "Varadaraja", "Keshava", "Madhava", "Govinda", "Ramabhadra", "Satyanarayana", "Narasimha", "Lakshmi Narasimha", "Varaha", "Vamana", "Tirupati", "Bhavanarayana", "Chennakesava", "Venugopala", "Appanna", "Appana"],
  Hanuman: ["Hanuman", "Anjaneya", "Anjaneyar", "Maruti", "Bajrangbali", "Bajrang", "Sankat Mochan", "Hanumanji"],
  Ganesha: ["Ganesha", "Ganesh", "Ganapati", "Ganapathy", "Vinayaka", "Vinayagar", "Pillaiyar", "Siddhivinayak", "Vighneshwara", "Ganapathi", "Ganapati"],
  Krishna: ["Krishna", "Krishn", "Gopal", "Govind", "Govinda", "Radha Krishna", "Dwarkadhish", "Giridhari", "Parthasarathy", "Guruvayoorappan", "Guruvayur", "ISCON", "ISKCON"],
  Lakshmi: ["Lakshmi", "Laxmi", "Mahalakshmi", "Mahalaxmi", "Padmavathi", "Ashtalakshmi", "Adhilakshmi", "Adhilakhsmi"],
  Durga: ["Durga", "Devi", "Parvati", "Amman", "Amma", "Ambika", "Kali", "Chamundi", "Chamundeswari", "Shakti", "Bhagavathi", "Mariamman", "Kaali", "Mavullama", "Mavullamma", "Poleramma", "Nookambika"],
  Kartikeya: ["Kartikeya", "Karthikeya", "Murugan", "Murugar", "Subramanya", "Subramanyeshwara", "Subrahmanyeshwara", "Subramaniam", "Subramanian", "Shanmuga", "Skanda", "Kumara", "Senthil", "Velayudham"],
  Surya: ["Surya", "Suryanarayana", "Sun Temple", "Aditya", "Arka"],
  Saraswati: ["Saraswati", "Saraswathi", "Sarasvati", "Sharada"],
  Rama: ["Rama", "Ram", "Sita Ram", "Sitaram", "Ramar", "Kodandarama", "Raghunath"],
  SaiBaba: ["Sai", "Saibaba", "Sai Baba", "Shirdi"],
};

export function getSearchKeywords(deity: string): string[] {
  return DEITY_SEARCH_KEYWORDS[deity] || [deity];
}

export { DEITY_SEARCH_KEYWORDS };
