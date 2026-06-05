// api/_holidays.js — German federal + Berlin state public holidays.
//
// 2026 + 2027 covered. By June 2027, this file needs the 2028 dates added.
//
// Berlin observes: federal holidays + International Women's Day (Berlin-specific
// since 2019). Berlin does NOT observe Fronleichnam, Allerheiligen,
// Reformationstag (those are observed in southern/Catholic states or
// other Länder).
//
// generateExtras calls getNextHoliday(today) to find the next upcoming
// holiday. The countdown strip in buildEmailHTML renders only if a holiday
// is within 14 days. Past that, the section hides — feels weird to count
// down 60 days.

var HOLIDAYS = [
  // 2026
  { date: '2026-01-01', name: 'Neujahr',                 nameEn: 'New Year\'s Day' },
  { date: '2026-03-08', name: 'Internationaler Frauentag', nameEn: 'International Women\'s Day' },
  { date: '2026-04-03', name: 'Karfreitag',               nameEn: 'Good Friday' },
  { date: '2026-04-06', name: 'Ostermontag',              nameEn: 'Easter Monday' },
  { date: '2026-05-01', name: 'Tag der Arbeit',           nameEn: 'Labour Day' },
  { date: '2026-05-14', name: 'Christi Himmelfahrt',      nameEn: 'Ascension Day' },
  { date: '2026-05-25', name: 'Pfingstmontag',            nameEn: 'Whit Monday' },
  { date: '2026-10-03', name: 'Tag der Deutschen Einheit', nameEn: 'German Unity Day' },
  { date: '2026-12-25', name: '1. Weihnachtstag',         nameEn: 'Christmas Day' },
  { date: '2026-12-26', name: '2. Weihnachtstag',         nameEn: 'Boxing Day' },

  // 2027
  { date: '2027-01-01', name: 'Neujahr',                  nameEn: 'New Year\'s Day' },
  { date: '2027-03-08', name: 'Internationaler Frauentag', nameEn: 'International Women\'s Day' },
  { date: '2027-03-26', name: 'Karfreitag',               nameEn: 'Good Friday' },
  { date: '2027-03-29', name: 'Ostermontag',              nameEn: 'Easter Monday' },
  { date: '2027-05-01', name: 'Tag der Arbeit',           nameEn: 'Labour Day' },
  { date: '2027-05-06', name: 'Christi Himmelfahrt',      nameEn: 'Ascension Day' },
  { date: '2027-05-17', name: 'Pfingstmontag',            nameEn: 'Whit Monday' },
  { date: '2027-10-03', name: 'Tag der Deutschen Einheit', nameEn: 'German Unity Day' },
  { date: '2027-12-25', name: '1. Weihnachtstag',         nameEn: 'Christmas Day' },
  { date: '2027-12-26', name: '2. Weihnachtstag',         nameEn: 'Boxing Day' },

  // 2028 (Easter early — add minimum so January 2028 has a future holiday)
  { date: '2028-01-01', name: 'Neujahr',                  nameEn: 'New Year\'s Day' },
];

// Get the next upcoming holiday from today's date. Returns null if none
// within range. The countdown only renders when daysUntil <= maxDays (default 14).
function getNextHoliday(today, maxDays) {
  if (!today) today = new Date();
  if (typeof maxDays !== 'number') maxDays = 14;

  // Normalize 'today' to YYYY-MM-DD in Berlin local. Using ISO-string truncation
  // is safe because Berlin's offset means UTC midnight always lands on the same
  // calendar day as Berlin morning hours when we run (5am UTC = 7am Berlin).
  var todayStr = today.toISOString().slice(0, 10);

  for (var i = 0; i < HOLIDAYS.length; i++) {
    var h = HOLIDAYS[i];
    if (h.date < todayStr) continue;
    var d1 = new Date(h.date + 'T00:00:00Z');
    var d0 = new Date(todayStr + 'T00:00:00Z');
    var daysUntil = Math.round((d1 - d0) / 86400000);
    if (daysUntil < 0) continue;
    if (daysUntil > maxDays) return null;
    var dateObj = new Date(h.date + 'T00:00:00Z');
    var dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    var dayMonth = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    var dateLabel = 'shops closed ' + dayName + ' ' + dayMonth;
    return {
      name: h.name,
      nameEn: h.nameEn,
      daysUntil: daysUntil,
      dateLabel: dateLabel,
    };
  }
  return null;
}

module.exports = { getNextHoliday: getNextHoliday, HOLIDAYS: HOLIDAYS };
