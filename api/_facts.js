// api/_facts.js — Curated "Did You Know?" fact list per region.
//
// Replaces Claude-generated facts which had a hallucination problem
// (177-anchored facts repeating, invented numbers like 13,000 NYC subway
// tunnel miles, etc.). All facts here are sourced from verifiable references
// and cross-checked for accuracy.
//
// generateExtras in newsletter.js reads from this file and picks one fact
// at random per send. Claude is no longer asked to generate Did You Know.
//
// To rotate facts: just add new entries. With ~30 facts per region and 1
// pick per send, subscribers see a 30-day rotation.
//
// Sources used in compilation:
// - berlinpoche.de/en/berlin-fun-facts (50 sourced facts)
// - enjoytravel.com (Delhi facts)
// - holidify.com, factphilia.com (Delhi cross-reference)
// - completeera.com (Delhi population statistics)
// - widely-documented NYC reference data
//
// EVERY fact in this file should be checkable against an authoritative
// source. If you're not sure, REMOVE it — better fewer facts than wrong ones.

var FACTS = {

  eu: [
    "960 — the bridges in Berlin, more than Venice and Amsterdam combined.",
    "175 — the museums in Berlin, including the currywurst museum, the cannabis museum, and a museum dedicated to forgotten objects.",
    "44 — the percentage of Berlin covered by water, forest, and parks, making it the greenest major city in Germany.",
    "4,000 — the population per square kilometer in Berlin, one-fifth of Paris despite being eight times larger in area.",
    "20,000 — the animals at Berlin Zoo, with 1,400 species — the most of any zoo in the world.",
    "100 — the liters of beer the average Berliner drinks per year. Wine clocks in at 20.",
    "1,600 — the kebab shops in Berlin, more than in Istanbul where the dish was supposedly invented.",
    "70 million — the currywursts Berliners eat per year, in a city of 3.6 million people.",
    "40 — the percentage of Berlin's structures that are underground. Bunkers, tunnels, sewers, secret cellars.",
    "12 — the times \"Waldstraße\" appears as a separate street name in Berlin. Lindenstraße appears 10 times.",
    "1.3 — the kilometers of the East Side Gallery, the world's largest open-air mural exhibition along a former section of the Wall.",
    "38.4 — the highest temperature ever recorded in Berlin in degrees Celsius, on June 30, 2019.",
    "7 — the working vineyards inside Berlin city limits, producing fewer than 2,000 bottles a year combined.",
    "200 — the days per year the Berlin S-Bahn runs late, on average. The Tokyo Shinkansen averages a 6-second delay.",
    "26,000 — the euros per night for the Royal Suite at Hotel Adlon, a 185-square-meter apartment opposite the Brandenburg Gate.",
    "50 — the hours Berghain stays open continuously over New Year's Eve, with no break.",
    "35 — the millions of euros Berlin spends each year erasing graffiti from its streets.",
    "1 in 4 — the share of Berliners who are actually from Berlin. The other three-quarters come from somewhere else.",
    "185 — the nationalities living in Berlin, with around 500,000 foreign residents.",
    "8.7 — the times Berlin's public transport circles the Earth, every single day.",
    "114.7 — the height in meters of the Müggelberge, Berlin's tallest natural elevation. Most things are flatter than that.",
    "156 — the kilometers of the Berlin Wall that once cut through and around the city.",
    "423.5 — the kilograms of the world's largest kebab, made in Berlin in October 2017.",
    "4 — the people who can fit inside Teledisko, the world's smallest disco. It's a converted phone booth.",
    "13,169 — the anonymous graves in Berlin's cemeteries.",
    "1990 — the year Berlin became Germany's capital again, after a contentious Bundestag vote following reunification.",
    "10 — the percentage of Berliners who are vegetarian or vegan, one of the highest rates in Europe.",
    "400 — the years \"Zur Letzten Instanz\" has been operating, Berlin's oldest restaurant, still serving food today.",
    "1 in 2 — the share of Berliners who live alone. That ranks Berlin only 20th among German cities for singles.",
    "br'lo — the ancient Slavic word for swamp, the actual origin of the name Berlin. Not the German word for bear, despite the city symbol."
  ],

  us: [
    "472 — the stations in the NYC subway system, the most of any rapid transit network in the world.",
    "800 — the languages spoken in NYC, more than anywhere else on Earth.",
    "26 — the bridges connecting Manhattan to the rest of NYC, including the Brooklyn Bridge from 1883.",
    "1664 — the year New Amsterdam was renamed New York after the British took over from the Dutch.",
    "1,700 — the parks and public open spaces in NYC, covering 14% of the city's total area.",
    "8.3 — the millions of residents in NYC, plus another 1.5 million who commute in daily for work.",
    "200 — the museums in NYC, including the Met which holds over 2 million works of art.",
    "1898 — the year the five boroughs consolidated into one city. Before that they were separate municipalities.",
    "1,776 — the height in feet of One World Trade Center, a deliberate reference to the year of independence.",
    "13,000 — the licensed yellow taxis in NYC, plus 80,000+ for-hire vehicles like Uber and Lyft.",
    "25 — the times per year, on average, the Empire State Building gets struck by lightning.",
    "1857 — the year Central Park began construction, before the surrounding neighborhoods even existed.",
    "1904 — the year the NYC subway opened, beating most European capitals to underground transit.",
    "320 — the kilometers of waterfront in NYC, more than London, Tokyo, or Hong Kong.",
    "4 — the languages other than English required on NYC ballots: Spanish, Chinese, Korean, and Bengali.",
    "1990 — the year NYC's homicide count peaked at 2,245, compared to under 400 in recent years.",
    "27 — the average minutes of a NYC commute, longer than any other major US city.",
    "100 — the years between the Statue of Liberty's 1886 dedication and its 1986 restoration centennial.",
    "24 — the floors of the Flatiron Building, considered NYC's first true skyscraper when built in 1902.",
    "1898 — the year the Bronx Zoo opened, now the largest metropolitan zoo in the United States.",
    "1626 — the year Manhattan was reportedly purchased from the Lenape tribe for goods worth about $24, a deal historians now consider a misunderstanding rather than a sale.",
    "11 — the languages of broadcast on the New York City subway PA system during major events.",
    "1853 — the year the first New York World's Fair was proposed. Two were eventually held: 1939 and 1964.",
    "1973 — the year the original World Trade Center towers opened. They were the world's tallest buildings for one year.",
    "5 — the boroughs of NYC: Manhattan, Brooklyn, Queens, the Bronx, and Staten Island.",
    "20,000 — the buildings that catch fire in NYC every year, keeping the FDNY one of the world's busiest fire departments.",
    "150 — the kilometers of the Hudson River, which separates Manhattan from New Jersey.",
    "843 — the acres of Central Park, larger than the entire principality of Monaco.",
    "1879 — the year Madison Square Garden first opened. The current building, the fourth to bear the name, opened in 1968.",
    "2,500 — the chess matches typically played in Washington Square Park on a single sunny weekend afternoon."
  ],

  india: [
    "11 — the times Delhi has been built, destroyed, and rebuilt by different empires across thousands of years.",
    "60,000 — the historical and cultural monuments in Delhi, more than any other Indian city.",
    "73 — the height in meters of Qutub Minar, the tallest brick minaret in the world, built starting in 1192.",
    "1656 — the year Jama Masjid was completed under Mughal Emperor Shah Jahan, still one of India's largest mosques.",
    "14 — the city gates Delhi once had, built between the 8th and 20th centuries. Only five still stand.",
    "17th century — when Khari Baoli in Old Delhi was founded. It's still Asia's largest wholesale spice market today.",
    "80 — the acres covered by Azadpur Mandi, Asia's largest wholesale market for fruits and vegetables.",
    "2 — Delhi's rank among bird-rich capital cities in the world, after Nairobi.",
    "20 — the percentage of Delhi's area covered by green space, despite being one of the world's most densely populated cities.",
    "33 — the millions of people in the wider Delhi metropolitan area, the second-most-populous urban area on Earth after Tokyo.",
    "11,320 — the residents per square kilometer in Delhi, making it one of the most densely populated capital regions in the world.",
    "70 — the percentage of Delhi residents born outside the city, drawn in over decades of migration for work.",
    "1911 — the year the British announced the capital would shift from Calcutta to Delhi. New Delhi was inaugurated 20 years later.",
    "1 — the Baha'i temple in all of Asia, the lotus-shaped one in Delhi, open to people of any religion.",
    "48.8 — the highest temperature ever recorded in Delhi in degrees Celsius.",
    "11 — the political zones Delhi is divided into, which together contain 95 police stations.",
    "1,400 — the daily megaliters of water Delhi consumes. Demand routinely outpaces supply in summer.",
    "2002 — the year the first Delhi Metro line opened. The network has since grown to nearly 400 kilometers across multiple lines.",
    "CNG — the fuel that has powered every Delhi public bus and auto-rickshaw since 2002, introduced specifically to fight air pollution.",
    "1992 — the year the Sulabh International Museum of Toilets opened in Delhi. It tracks 4,500 years of sanitation history.",
    "2010 — the year Delhi hosted the Commonwealth Games, the most expensive Commonwealth Games ever held to this day.",
    "1638 — the year construction began on the Red Fort, Shah Jahan's main residence after he moved the Mughal capital from Agra to Delhi.",
    "Indraprastha — the legendary name for a city that stood where Delhi now is, mentioned in the Mahabharata thousands of years ago.",
    "1986 — the year the Lotus Temple opened. It has won dozens of international architecture awards since.",
    "22 — the languages officially recognized by India's constitution. On any Delhi Metro coach you'll hear at least 6 of them.",
    "84,000 — the Indian soldiers who died in World War I that India Gate was built to commemorate, modeled in part on the Arc de Triomphe.",
    "16 — the lakhs of buyers Khari Baoli spice market sees on a typical day. That's 1.6 million people through one market.",
    "1739 — the year Nadir Shah of Persia sacked Delhi and looted the Peacock Throne, taking it back to Iran where it was eventually broken up.",
    "9.3 — the millions of vehicles registered in Delhi as of recent estimates, the highest number of any city in India.",
    "5 — the surviving city gates of historical Delhi: Kashmiri Gate, Delhi Gate, Ajmeri Gate, Lahori Gate, and Turkman Gate.",
    "1857 — the year the Mughal Empire formally ended at the Red Fort, with the British exiling Bahadur Shah Zafar to Burma."
  ],

  // Generic fallback for asia/global subscribers — broadly true, not city-specific
  global: [
    "195 — the United Nations member states in 2026, plus 2 observer states (Vatican City and Palestine).",
    "7,000 — the languages spoken on Earth today. About 40% are endangered, with fewer than 1,000 speakers each.",
    "8 — the billions of people who reached the planet in 2022. The number 9 billion is projected around 2037.",
    "70 — the percentage of Earth covered by ocean, only about 5% of which has been mapped in detail.",
    "1969 — the year ARPANET sent its first message between two universities. The internet began as the word \"LO\" — the system crashed before \"LOGIN\" finished sending.",
    "1888 — the year Kodak introduced the slogan \"You press the button, we do the rest.\" The world hasn't slowed down on photos since.",
    "12 — the people who have walked on the Moon, all between 1969 and 1972.",
    "300 — the rough number of dialects of Mandarin Chinese, the world's most-spoken language by native speakers.",
    "1953 — the year DNA's structure was published. Rosalind Franklin's data was central to the discovery, though Watson and Crick won the Nobel.",
    "5 — the official languages of the United Nations: English, French, Spanish, Russian, Arabic, and Chinese.",
    "1928 — the year penicillin was accidentally discovered by Alexander Fleming. His messy lab bench changed medicine.",
    "240,000 — the kilometers between Earth and the Moon, roughly. You could fit every other planet in the solar system in that gap.",
    "1971 — the year email was invented. The @ symbol was chosen because it wasn't used in anyone's name.",
    "108 — the elements on the periodic table that occur naturally on Earth. The rest are synthetic.",
    "2 — the languages spoken by more than 1 billion people each: English (with second-language speakers) and Mandarin Chinese."
  ]
};

// Region aliases — asia and global use the same generic pool
FACTS.asia = FACTS.global;

function getRandomFact(region) {
    var pool = FACTS[region] || FACTS.global;
    if (!pool || pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { FACTS: FACTS, getRandomFact: getRandomFact };
