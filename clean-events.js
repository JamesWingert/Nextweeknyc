const fs = require('fs');

// Load both files
const filmMuseum = JSON.parse(fs.readFileSync('/root/Nextweeknyc/public/data/film_museum_events.json', 'utf8'));
const general = JSON.parse(fs.readFileSync('/root/Nextweeknyc/public/data/events.json', 'utf8'));

// Deduplicate by title + venue
function dedupe(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = (e.title + '|' + e.venue).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Filter out junk events
function filterJunk(events) {
  const junkPatterns = [
    /note:/i, /podcast/i, /baseball cap/i, /calendar/i, /membership/i,
    /featured/i, /previous month/i, /next month/i, /mar\s+\d+/i,
    /tickets$/i, /donation/i, /sponsored/i, /pdf$/i, /client-uploads/i,
    /jan-mar/i, /winter 2026/i, /printer friendly/i, /series page/i,
    /past exhibitions/i, /arts of /i, /from the collection/i
  ];
  
  return events.filter(e => {
    const title = e.title || '';
    return !junkPatterns.some(p => p.test(title));
  });
}

const cleanFilmMuseum = dedupe(filterJunk(filmMuseum));
const cleanGeneral = dedupe(filterJunk(general));

console.log(`Film/Museum: ${filmMuseum.length} -> ${cleanFilmMuseum.length}`);
console.log(`General: ${general.length} -> ${cleanGeneral.length}`);

fs.writeFileSync('/root/Nextweeknyc/public/data/film_museum_events.json', JSON.stringify(cleanFilmMuseum, null, 2));
fs.writeFileSync('/root/Nextweeknyc/public/data/events.json', JSON.stringify(cleanGeneral, null, 2));

console.log('Files cleaned and saved!');
console.log(`Total events: ${cleanFilmMuseum.length + cleanGeneral.length}`);
