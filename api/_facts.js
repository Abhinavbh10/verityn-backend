// api/_facts.js — Curated "Did You Know?" fact list per region.
//
// Refactored June 2026. Schema now:
//   { number: "175", text: "the museums in Berlin, ..." }
// or simply a string for old-style entries (backwards compatible).
//
// generateExtras reads from this file and picks one fact at random,
// avoiding recently used (cross-day dedupe).
//
// EVERY fact must be checkable against an authoritative source.
// If unsure, REMOVE — better fewer facts than wrong ones.
//
// Pool grew from 30 → 80 in June 2026 to give readers ~10-week rotation.

var FACTS = {

  eu: [
    // ── Berlin city facts (trivia) ──
    { number: "960", text: "the bridges in Berlin, more than Venice and Amsterdam combined." },
    { number: "175", text: "the museums in Berlin, including the currywurst museum, the cannabis museum, and a museum dedicated to forgotten objects." },
    { number: "44%", text: "of Berlin is covered by water, forest, and parks, making it the greenest major city in Germany." },
    { number: "4,000", text: "the population per square kilometer in Berlin, one-fifth of Paris despite being eight times larger in area." },
    { number: "20,000", text: "the animals at Berlin Zoo, with 1,400 species — the most of any zoo in the world." },
    { number: "100", text: "the liters of beer the average Berliner drinks per year. Wine clocks in at 20." },
    { number: "1,600", text: "the kebab shops in Berlin, more than in Istanbul where the dish was supposedly invented." },
    { number: "70 million", text: "the currywursts Berliners eat per year, in a city of 3.6 million people." },
    { number: "40%", text: "of Berlin's structures are underground. Bunkers, tunnels, sewers, secret cellars." },
    { number: "1.3 km", text: "the East Side Gallery, the world's largest open-air mural exhibition along a former section of the Wall." },
    { number: "38.4°C", text: "the highest temperature ever recorded in Berlin, on June 30, 2019." },
    { number: "7", text: "the working vineyards inside Berlin city limits, producing fewer than 2,000 bottles a year combined." },
    { number: "200", text: "the days per year the Berlin S-Bahn runs late, on average. The Tokyo Shinkansen averages a 6-second delay." },
    { number: "26,000", text: "the euros per night for the Royal Suite at Hotel Adlon, a 185-square-meter apartment opposite the Brandenburg Gate." },
    { number: "50", text: "the hours Berghain stays open continuously over New Year's Eve, with no break." },
    { number: "35M €", text: "Berlin spends each year erasing graffiti from its streets." },
    { number: "1 in 4", text: "the share of Berliners who are actually from Berlin. The other three-quarters come from somewhere else." },
    { number: "185", text: "the nationalities living in Berlin, with around 500,000 foreign residents." },
    { number: "8.7", text: "the times Berlin's public transport circles the Earth, every single day." },
    { number: "114.7m", text: "the height of the Müggelberge, Berlin's tallest natural elevation. Most things are flatter than that." },
    { number: "156 km", text: "the length of the Berlin Wall that once cut through and around the city." },
    { number: "4", text: "the people who can fit inside Teledisko, the world's smallest disco. It's a converted phone booth." },
    { number: "1990", text: "the year Berlin became Germany's capital again, after a contentious Bundestag vote following reunification." },
    { number: "10%", text: "of Berliners are vegetarian or vegan, one of the highest rates in Europe." },
    { number: "400", text: "the years \"Zur Letzten Instanz\" has been operating, Berlin's oldest restaurant, still serving food today." },
    { number: "1 in 2", text: "Berliners live alone. That ranks Berlin only 20th among German cities for singles, surprisingly." },
    { number: "br'lo", text: "the ancient Slavic word for swamp — the actual origin of the name Berlin. Not the German word for bear, despite the city symbol." },
    { number: "12", text: "the districts (Bezirke) Berlin is divided into. Each has its own mayor and budget." },
    { number: "3,200", text: "the bread varieties registered in Germany. Berlin bakeries stock about 50 on a given morning." },
    { number: "1961", text: "the year construction of the Berlin Wall began, on the night of August 12-13. The city woke up divided." },

    // ── Daily-life utility facts (Berlin-specific, actionable) ──
    { number: "14 days", text: "the window to register at the Bürgeramt after you move into a Berlin apartment. The law says 14, the appointment queue says 6 weeks." },
    { number: "€60", text: "the fine for riding the BVG without a valid ticket. The first time. Repeat offenses get more expensive." },
    { number: "€18.36", text: "the monthly Rundfunkbeitrag (TV/radio tax) — payable per household, not per person, regardless of whether you own a TV." },
    { number: "€58", text: "the price of the Deutschlandticket, which covers all regional trains, buses, and city transit nationwide." },
    { number: "65%", text: "of your previous net salary that Elterngeld replaces during parental leave, capped at €1,800 per month." },
    { number: "€250", text: "the monthly Kindergeld payment per child until age 18, or 25 if they're still in education." },
    { number: "8-9 years", text: "the average wait for a kidney transplant in Germany. The opt-out organ donation debate is about fixing this." },
    { number: "€10,000", text: "the maximum BAföG student loan you'll need to repay, even if total support was higher. Half the BAföG is a grant." },
    { number: "5 years", text: "the residency requirement for a permanent settlement permit (Niederlassungserlaubnis), after which renewals stop." },
    { number: "8 years", text: "the standard time before naturalization eligibility (5 if married to a German). B1 language and integration test required." },
    { number: "3 months", text: "the maximum rent deposit (Kaution) a Berlin landlord can legally ask for, paid into a Mietkautionskonto." },
    { number: "€100", text: "the rough monthly Nebenkosten difference between a 60sqm Altbau and 60sqm Neubau in winter heating costs." },
    { number: "10-15%", text: "the average increase in Berlin Mietspiegel rents in 2024. New tenants face higher jumps than existing ones." },
    { number: "20%", text: "of your gross salary deducted for Sozialversicherung (health, pension, unemployment, care insurance). Roughly." },
    { number: "47%", text: "of your final net salary that the state Rentenversicherung pays in retirement. Most Germans supplement privately." },
    { number: "0.5%", text: "the Berlin church tax (Kirchensteuer) — paid only if your tax form lists a religious denomination. Easy to opt out." },
    { number: "€0.25", text: "the Pfand deposit on plastic bottles. Glass beer bottles are €0.08. Always check labels before recycling." },
    { number: "5", text: "the bin types in Berlin Mülltrennung: paper, packaging, glass (by color), organic, residual. The Hausmeister notices." },
    { number: "Sundays", text: "are quiet by law. Loud vacuuming, drilling, or laundry can result in a real visit from the police." },
    { number: "22:00–06:00", text: "the protected Ruhezeit when noise complaints become serious. Hausordnung enforcement varies by building." },
    { number: "€3.50", text: "the per-hour cost of a Volkshochschule German course in Berlin — the best deal in town for learning to B2." },
    { number: "6 weeks", text: "before birth + 8 weeks after that Mutterschutz protects new mothers. Paid leave, job legally guaranteed." },
    { number: "€7", text: "the typical monthly cost of Haftpflichtversicherung (personal liability) in Germany. The one insurance everyone needs." },
    { number: "B1", text: "the German language level required for naturalization. C1 is what most universities require." },
    { number: "€1,063", text: "the average tax refund (Steuererklärung) German employees received in their most recent filing year." },
    { number: "1990", text: "the year the Ampelmann (East German pedestrian light figure) was almost discontinued. Public outcry saved him." },
    { number: "100,000", text: "the subsidized Sozialwohnungen in Berlin. WBS-eligible residents apply through their Bezirksamt." },
    { number: "€4-6", text: "the cost of a cup of Glühwein at any Berlin Weihnachtsmarkt between November and December." },
    { number: "80+", text: "the Christmas markets Berlin runs each year. Every Bezirk has at least one, often several." },

    // ── Less common but verifiable ──
    { number: "1,500", text: "the public Brunnen (water fountains) Berlin has. Many provide free drinking water in summer." },
    { number: "27", text: "the number of Berlin U-Bahn and S-Bahn lines combined. A single Deutschlandticket covers all of them." },
    { number: "1838", text: "the year the first Berlin railway opened, between Potsdam and Berlin. Took 35 minutes — same as the S7 today." },
    { number: "60%", text: "of Berlin's electricity now comes from renewables, ahead of most German cities." },
    { number: "1879", text: "the year Werner von Siemens demonstrated the world's first electric streetcar — in Berlin's Lichterfelde." },
    { number: "94", text: "the libraries in Berlin's public library system (ZLB). All free with a €10/year card." },
    { number: "1907", text: "the year the first KaDeWe opened. It survived two world wars and remains continental Europe's biggest department store." },
    { number: "1,300", text: "the kilometers of designated cycling paths in Berlin, with another 200 planned by 2030." },
    { number: "1924", text: "the year the Berlin S-Bahn opened, three years before the U-Bahn went fully electric." },
    { number: "1872", text: "the year Berlin's first asphalt-paved street appeared — Unter den Linden. Most streets stayed cobblestone for another 40 years." },
    { number: "Spreewald", text: "the wetland reserve outside Berlin where canal boats still deliver mail — one of the last remaining systems in Europe." },
    { number: "1929", text: "the year Berlin had more cinemas (363) than any other European city. About 200 remain today, including 90+ arthouse." },
    { number: "Görlitzer Park", text: "is exactly one square kilometer. Most Berliners underestimate its size by half until they walk across it." },
    { number: "1929", text: "the year Berlin's last horse-drawn tram retired. The first electric tram had run 48 years earlier in 1881." },
    { number: "Olympic Stadium", text: "still holds the record for most people at a single concert in Berlin — 90,000 for Bruce Springsteen in 1988, behind the Wall." },
    { number: "97%", text: "of Berlin's tap water passes EU drinking water standards without filtration. It's softer than Munich's, harder than Hamburg's." },
    { number: "Stolpersteine", text: "the brass cobblestones marking former homes of Holocaust victims. Berlin has over 9,000 — more than any other city in the world." },
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
  ],

};

// getRandomFact accepts a region key and an array of fact strings already
// served recently. Returns either a structured fact object (new format) or
// a string (legacy us/india entries).
function getRandomFact(region, excludeFacts) {
  excludeFacts = excludeFacts || [];
  var pool = FACTS[region] || FACTS.eu;
  var excluded = {};
  excludeFacts.forEach(function(f) { excluded[f] = true; });

  var available = pool.filter(function(f) {
    var asText = typeof f === 'string' ? f : (f.text || '');
    return !excluded[asText];
  });
  if (available.length === 0) available = pool;

  return available[Math.floor(Math.random() * available.length)];
}

// Legacy callers expect a string. This helper returns one.
function factToString(f) {
  if (typeof f === 'string') return f;
  if (f && f.number && f.text) return f.number + ' — ' + f.text;
  return '';
}

// Returns { number, text } for the dark-card Did-You-Know rendering.
// Falls back to { number: '', text: <full string> } for legacy entries.
function factToParts(f) {
  if (typeof f === 'string') {
    var m = f.match(/^(\S[\S\s]*?)\s+[—-]\s+(.*)$/);
    if (m) return { number: m[1], text: m[2] };
    return { number: '', text: f };
  }
  if (f && (f.number || f.text)) return { number: f.number || '', text: f.text || '' };
  return { number: '', text: '' };
}

module.exports = {
  getRandomFact: getRandomFact,
  factToString: factToString,
  factToParts: factToParts,
  FACTS: FACTS,
};
