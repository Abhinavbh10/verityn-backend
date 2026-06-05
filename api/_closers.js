// api/_closers.js — Curated daily closer lines.
//
// 80 lines, hand-written. Each works as a stand-alone closer in italic serif.
// Mix of: gentle advice, dry observation, Berlin-life truths, mild encouragement,
// occasional warmth. Avoid: cheerful, fake-deep, or anything that reads like
// a fortune cookie. The tone is "wise friend who's been here a while."
//
// Length cap: under 100 characters. Anything longer doesn't render well in the
// italic-serif 20px display.
//
// generateExtras picks one at random per send, avoiding recently used.
// 80 entries / 1 per day = 2.5-month rotation before repeat.

var CLOSERS = [
  "Until tomorrow — keep your Anmeldung up to date.",
  "That's the day. Make a Termin if you've been putting one off.",
  "Read more, worry less.",
  "Drink water. Berlin's tap is excellent.",
  "Eat the cake. It's Friday somewhere.",
  "Check your Briefkasten. The Finanzamt rarely emails.",
  "If you see a Späti, thank it quietly.",
  "Carry coins. The Spätis still prefer them.",
  "Update your CV before you need to.",
  "Take the long way home through Tiergarten.",
  "Email your landlord back. They're waiting.",
  "Renew your Aufenthaltstitel before the printer panics.",
  "Don't trust the BVG app. Always leave 5 minutes early.",
  "Carry an umbrella you don't mind losing.",
  "Smile at the Hausmeister.",
  "Sundays are for nothing. That's the point.",
  "Sleep is a Wohngeld application strategy.",
  "Touch grass at Tempelhofer Feld.",
  "Try the bakery you walk past every day.",
  "Save 10% of every paycheck. The Sparkasse will notice eventually.",
  "Your future self wants you to file the Steuererklärung.",
  "If the U-Bahn smells, it's working.",
  "Sit in a park. Don't bring your phone.",
  "Be kind to bus drivers. They've seen things.",
  "Take the long view. Berlin rewards patience.",
  "Get a library card. The ZLB is free and warm.",
  "Try to use 'doch' correctly today.",
  "If you see a Currywurst stand, look at it like a tourist would.",
  "The bakeries close earlier than you think. Plan accordingly.",
  "Don't argue with a Beamter. Just nod.",
  "Make eye contact with one person on the U-Bahn today.",
  "Walk past the McFit, not into it.",
  "If you're cold, find an Altbau café. They overheat on principle.",
  "Don't reply at midnight. Reply at 9am.",
  "Get the WG cleaning rota into a shared spreadsheet.",
  "Pay your GEZ bill. They will find you.",
  "Cancel one subscription you forgot you had.",
  "Walk somewhere new in your Kiez today.",
  "Berlin is grey on purpose. Wear color anyway.",
  "Be early to your Bürgeramt Termin. Be very early.",
  "Drink your coffee outside, even today.",
  "Take a photo of your Stromzähler reading. Trust me.",
  "The Mietspiegel is your friend. Read it once a year.",
  "Have a backup plan for the U7. There's always work on the U7.",
  "If you're new here, ask for help. Berliners pretend they don't, but they do.",
  "Try the soup at the Greek place. You know which one.",
  "Bring shoes you can stand in for 4 hours.",
  "Tomorrow won't be easier just because it's tomorrow.",
  "Forgive the bakery if they're out of Schrippe by 11.",
  "Some days, the only goal is to do the laundry.",
  "Politely correct your German. People will respect it.",
  "Don't drop bottles in bins. Leave them next to bins.",
  "If a stranger waves, wave back. It's probably a neighbor.",
  "Keep a small umbrella in your bag. Always.",
  "Read one article today that doesn't help your career.",
  "Berlin is more forgiving than it looks.",
  "The S-Bahn doesn't care about your meeting. Plan accordingly.",
  "Tell someone you appreciate them. In any language.",
  "Pay the cyclist who knocks on your driver's-side window. Politely.",
  "Replace a lightbulb you've been ignoring.",
  "Keep your phone charger out of the bedroom. Try, anyway.",
  "Eat something green today. The Currywurst can wait.",
  "Don't argue with a German queue. Just join it correctly.",
  "Open a window for ten minutes. Even in winter. Especially in winter.",
  "Lüften isn't a suggestion. It's a moral position.",
  "Buy stamps in person. The conversation is free.",
  "Move your body. Just enough to remember you have one.",
  "Berlin doesn't reward speed. Slow down.",
  "Visit one museum on the first Sunday of the month. It's free.",
  "Sit at the front of the BVG bus, just once.",
  "Bring your own bag. Forever and always.",
  "Mid-week is a good time to text an old friend.",
  "Compliment a stranger's dog. Berlin runs on dogs.",
  "If you have a Pfand-collecting habit, you've integrated.",
  "Cycle through Volkspark Friedrichshain at dusk, if you can.",
  "If the Hauptbahnhof clocks all match, something's wrong.",
  "Berlin is a long conversation. Stay in it.",
  "Take the train to Potsdam this weekend. It's closer than you think.",
  "Compliment your colleague's haircut. It's still socially safe here.",
  "Berlin will outlast all your moods. Yours and the city's.",
];

function getRandomCloser(excludeClosers) {
  excludeClosers = excludeClosers || [];
  var excluded = {};
  excludeClosers.forEach(function(c) { excluded[c] = true; });
  var pool = CLOSERS.filter(function(c) { return !excluded[c]; });
  if (pool.length === 0) pool = CLOSERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { getRandomCloser: getRandomCloser, CLOSERS: CLOSERS };
