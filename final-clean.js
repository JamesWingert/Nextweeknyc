const fs = require('fs');

const events = JSON.parse(fs.readFileSync('/root/Nextweeknyc/public/data/events.json', 'utf8'));

// Clean up venues - remove entries where venue is doNYC but there's a specific venue version
const venueMap = new Map();
events.forEach(e => {
  const key = e.title.toLowerCase().trim();
  const existing = venueMap.get(key);
  if (!existing || (e.venue !== 'doNYC' && existing.venue === 'doNYC')) {
    venueMap.set(key, e);
  }
});

// Filter out garbage venues and clean titles
const validVenues = ['doNYC', 'The Skint', 'Secret NYC', 'Brooklyn Magazine', 'Time Out NY'];
const cleaned = Array.from(venueMap.values()).filter(e => {
  const venue = e.venue || '';
  // Keep if venue is short (real venue) or in valid list
  return venue.length < 40 || validVenues.includes(venue);
}).map(e => ({
  ...e,
  // Clean up newlines in titles
  title: e.title.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
}));

// Sort by venue
const sorted = cleaned.sort((a, b) => (a.venue || '').localeCompare(b.venue || ''));

console.log(`Cleaned: ${events.length} -> ${sorted.length} events`);

// Show breakdown
const byVenue = {};
sorted.forEach(e => {
  const v = e.venue || 'Unknown';
  byVenue[v] = (byVenue[v] || 0) + 1;
});
console.log('\nBy venue:', byVenue);

fs.writeFileSync('/root/Nextweeknyc/public/data/events.json', JSON.stringify(sorted, null, 2));
console.log('\nSaved!');
