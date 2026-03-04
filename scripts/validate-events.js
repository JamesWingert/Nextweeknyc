#!/usr/bin/env node
/**
 * Validates and normalizes scraped event data before writing to public/data/.
 *
 * Enforces the canonical schema:
 *   { id, title, venue, date, time?, category, sourceUrl, description?, price? }
 *
 * Handles common scraper variations:
 *   - url/link/sourceUrl → sourceUrl
 *   - name/title → title
 *   - location/venue → venue
 *   - type/category → category
 *   - Accepts array or { weekOf, events: [...] } wrapper
 *   - Auto-generates id if missing
 *
 * Junk filtering:
 *   - Rejects titles too short (<4) or too long (>120)
 *   - Rejects navigation text, browser warnings, UI chrome, generic labels
 *   - Rejects titles that are mostly non-alphabetic
 *   - Deduplicates by title+venue (case-insensitive)
 *
 * Usage:
 *   node scripts/validate-events.js <input.json> <output.json>
 */

const fs = require('fs');
const path = require('path');

const VALID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_RANGE_RE = /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/;

function isValidDate(d) {
  return VALID_DATE_RE.test(d) || VALID_RANGE_RE.test(d);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ---------------------------------------------------------------------------
// Junk detection
// ---------------------------------------------------------------------------

const JUNK_PATTERNS = [
  // Navigation / calendar chrome — only bare month names or "Month YYYY" (not event titles starting with month)
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?$/i,
  /january.*february|february.*march|march.*april/i,
  /^(sun|mon|tue|wed|thu|fri|sat)(day)?,?\s+\d/i,
  /^(previous|next)\s+(month|week|page)/i,
  /^(load more|show more|see all|view all|view more)/i,
  /^(upcoming events?|events?|agenda|calendar|schedule)$/i,

  // Browser / security warnings
  /security verification/i,
  /update.*browser/i,
  /unable to access/i,
  /enable javascript/i,
  /cookies? (policy|settings|preferences)/i,
  /accept (all )?cookies/i,
  /captcha/i,
  /cloudflare/i,
  /just a moment/i,
  /checking (your|if the site)/i,
  /access denied/i,
  /403 forbidden/i,
  /404 not found/i,
  /page not found/i,

  // UI elements / social / site nav
  /^(follow us|subscribe|sign up|log ?in|register|newsletter|share|menu|search|close|back|home)$/i,
  /^(skip to|jump to|go to)/i,
  /^(copyright|©|\d{4}\s*(©|all rights))/i,
  /^(privacy|terms|disclaimer)/i,
  /^(powered by|built with)/i,
  /^(translate|accessibility|contact us|for business|jobs at|facilities|programs|permits|get involved)/i,
  /^(translate this|get email|email updates)/i,
  /^(site navigation|what.?s playing|editorial|industry resources|more from|playbill editorial)/i,
  /^(fisher takeover|community program|community resource|get involved)s?$/i,

  // Generic non-event labels
  /^(featured|trending|popular|recommended|editor.?s? picks?)$/i,
  /^(buy tickets?|get tickets?|tickets?|rsvp|sold out)$/i,
  /^(free|paid|donation)$/i,
  /^(more info|learn more|read more|details|info)$/i,
  /^(image|photo|video|slideshow)$/i,
  /^(advertisement|sponsored|ad)$/i,
  /\(SPONSORED\)/i,

  // Pure dates or times (including "Month DD at HH:MM" format)
  /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/,
  /^\d{1,2}:\d{2}\s*(am|pm)?$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^until\s/i,
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s+(at|@)\s+\d{1,2}[:.]\d{2}/i,
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i,

  // Spam / ads / online courses / MLM / non-events
  /\bPMP\b.*application/i,
  /\bcertification\b.*\bexam\b/i,
  /\bcoaching\b.*\bPMBOK\b/i,
  /\bfree mp3\b/i,
  /\bLLC\b/i,
  /\bmerch(andise)?\s*submission/i,
  /\bMORE PERFORMANCES?\b/i,
  /\bSiriusXM\b/i,
  /\bstation[- ]?finder\b/i,
  /\bSaturday Matinee Broadcast/i,
  /\bgroup travel advisor/i,
  /\bholistic healing\b/i,
  /\bgemstone jewelry\b/i,
  /\bcrystals,?\s*gemstone/i,
  /\bwellness!+$/i,
  /\bPWL ReWind\b/i,

  // Numbered list items from Eventbrite category headers
  /^\d+\.\s+(january|february|march|april|may|june|july|august|september|october|november|december|brooklyn|queens|manhattan|job fairs?|valentines?)/i,
];

// Clickbait / listicle / article headline patterns (not actual events)
const ARTICLE_PATTERNS = [
  /^(the\s+)?\d+\s+(best|things|events|ways|reasons|places|spots|insane|amazing)/i,
  /\b(just (2|two|three|\d+) hours? from)\b/i,
  /\bis (just |right )?around the corner\b/i,
  /\bwas just named\b/i,
  /\bhas officially (shut|closed|opened)\b/i,
  /\bis closing at the end\b/i,
  /\bis the new it-restaurant\b/i,
  /\beveryone.*is trying to get into\b/i,
  /\byou can get paid\b/i,
  /\binsane (pictures|photos|amount)/i,
  /\bunder a travel ban\b/i,
  /\bhere is what that (actually )?means\b/i,
  /\bthe best things to do in NYC this\b/i,
  /\bnew and upcoming broadway shows\b/i,
  /\bheaded to NYC in \d{4}\b/i,
  /\bnamed the no\.\s*\d/i,
  /\bthe country.?s largest\b/i,
  /\bhave a meal at this\b/i,
];

// Imperative "suggestion" titles — not real event names
const IMPERATIVE_PATTERNS = [
  /^[\u201c\u201d\u2018\u2019"'`]?(catch a |check out|head to|hit the|warm up|visit |stop by|join the|sing |see a |get tickets|celebrate|embark|laugh-out-loud|headline|secure your|satisfy|step into|grocery shop)/i,
];

// Single generic words/phrases that aren't event names
const SINGLE_WORD_JUNK = new Set([
  'dell', 'translate', 'accessibility', 'programs', 'permits',
  'facilities', 'jobs', 'contact', 'home', 'menu', 'search',
  'sidebar', 'filter', 'adults', 'seniors', 'children',
  'multigenerational', 'education', 'location', 'artists',
  'explore', 'genre', 'date',
]);

// Short phrases that are site chrome, not event names
const SHORT_JUNK_PHRASES = [
  /^(now playing|coming soon|special events|current exhibitions?)$/i,
  /^(concerts? & tickets?|support us|about us|explore)$/i,
  /^(narrow your choices|edit your filters?|clear selections?)$/i,
  /^(event type|ticket price|filter categories|cookie list)$/i,
  /^(search .{2,10}|class registration|members save)$/i,
  /^(do not sell|manage consent|personal data)$/i,
  /^(events? & exhibitions?|calendar view|show filters?)$/i,
  /^(language center|performance series)$/i,
  /^(prepare to visit|limited-time|exhibitions? on view)$/i,
  /^(upcoming exhibitions?|past exhibitions?)$/i,
  /^(last chance|program to include)$/i,
  /^(why have i been blocked|what can i do to resolve)/i,
  /^(verification successful|waiting for)/i,
  /^(all exhibitions? are free)/i,
  /^(unfortunately.*outdated browser)/i,
  /^\d+\s*(year|month)s?$/i,
  /^<\s*\d/,  // "< 1 Year"
  /^(baroque|clarinet|instrument)\b.*\(\d+\)$/i,  // "Baroque / Early Music (13)"
  /^[a-z \/]+\(\d+\)$/i,  // "Carnegie Hall Presents (265)"
  /^no events were found/i,
  /^(narrow|edit) your\b/i,
  /^(instrument|visitor information)$/i,
  /^(sensory-friendly performance)$/i,
  /^(limited-time discounted admission)$/i,
  /^(class registration|lincoln center moments)\b/i,
  /^spring \d{4}[a-z]/i,  // "Spring 2026APr 21 - May 31"
  /^ongoing$/i,  // Only bare "Ongoing" text, not titles containing it
  /^introduction by\b/i,  // "Introduction by Cinema Tehran founder..."
  /beginner.*trial lesson/i,
  /do not sell or share/i,
  /manage consent/i,

  // Scraper artifacts from film sites
  /^(all films|film details|tickets and more info|now playing|short programs? now playing)$/i,
  /^live-action,?\s+animated/i,
  /^(buy|get) tickets?\b/i,
  /^opens?\s+(fri|mon|tue|wed|thu|sat|sun)\w*\s/i,  // "Opens Fri Mar 6"
  /\blast \d+ days?\b/i,  // "Ghost Elephants Last 4 Days"
  /\b(open captioning)\s*$/i,  // Duplicate "(Open Captioning)" variants — keep the base title
  /^(view showtimes?|see showtimes?|all showtimes?|full schedule)$/i,
  /^(now showing|currently showing|on screen)$/i,
];

function isJunkTitle(title) {
  if (!title) return true;
  const t = title.trim();
  if (t.length < 4 || t.length > 200) return true;

  // Single word junk — only reject if the ENTIRE title is a single junk word
  const words = t.split(/\s+/);
  if (words.length === 1 && SINGLE_WORD_JUNK.has(t.toLowerCase())) return true;

  // Mostly non-alphabetic (less than 40% letters)
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  if (letters / t.length < 0.4) return true;

  // Contains newlines after cleaning (shouldn't happen, but safety check)
  // Note: newlines are cleaned in validateEvent before this is called

  // Check against junk patterns
  for (const pat of JUNK_PATTERNS) {
    if (pat.test(t)) return true;
  }

  // Check short junk phrases (site chrome)
  for (const pat of SHORT_JUNK_PHRASES) {
    if (pat.test(t)) return true;
  }

  // Check article/clickbait patterns
  for (const pat of ARTICLE_PATTERNS) {
    if (pat.test(t)) return true;
  }

  // Check imperative suggestion patterns
  for (const pat of IMPERATIVE_PATTERNS) {
    if (pat.test(t)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEvent(raw, index) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: [`[${index}] not an object`] };
  }

  const title = (raw.title || raw.name || '').replace(/\s*\n\s*/g, ' ').trim();
  const venue = (raw.venue || raw.location || '').replace(/\s*\n\s*/g, ' ').trim();
  const date = (raw.date || '').trim();
  const category = (raw.category || raw.type || 'General').trim();
  const sourceUrl = (raw.sourceUrl || raw.url || raw.link || '').trim();
  const id = (raw.id || '').trim() || `${slugify(venue)}-${slugify(title)}-${index}`;
  const time = (raw.time || '').trim() || undefined;
  const description = (raw.description || '').trim() || undefined;
  const price = (raw.price || '').trim() || undefined;

  if (!title) errors.push(`[${index}] missing title`);
  if (isJunkTitle(title)) errors.push(`[${index}] junk title: "${title.slice(0, 60)}"`);
  // Reject events from dropped/non-venue sources
  const JUNK_VENUES = ['time out ny', 'time out'];
  if (JUNK_VENUES.includes(venue.toLowerCase())) errors.push(`[${index}] junk venue: "${venue}"`);
  // Reject Met Opera radio broadcast links (station-finder page, not actual performances)
  if (/station-finder|\/radio\//i.test(sourceUrl)) errors.push(`[${index}] radio broadcast link: "${sourceUrl.slice(0, 80)}"`);
  // Allow events with null/empty dates — they won't show on specific calendar days
  // but are still valid (e.g. ongoing exhibitions, events with unparseable dates)
  if (date && !isValidDate(date)) errors.push(`[${index}] invalid date format: "${date}"`);

  // Normalize same-day ranges ("2026-03-03 to 2026-03-03") into single dates
  let normalizedDate = date;
  if (VALID_RANGE_RE.test(date)) {
    const [s, e] = date.split(' to ');
    if (s === e) normalizedDate = s;
  }

  if (errors.length > 0) return { valid: false, errors };

  const event = { id, title, venue, date: normalizedDate, category, sourceUrl };
  if (time) event.time = time;
  if (description) event.description = description;
  if (price) event.price = price;

  return { valid: true, event };
}

// ---------------------------------------------------------------------------
// Deduplication — by normalized title, keep the entry with the best venue
// ---------------------------------------------------------------------------

function normalizeTitle(t) {
  return t.toLowerCase()
    .replace(/\s*\(open captioning\)\s*/i, '')
    .replace(/\s*last \d+ days?\s*/i, '')
    .replace(/\s*opens?\s+(fri|mon|tue|wed|thu|sat|sun)\w*\s+.*/i, '')
    .trim();
}

function dedupeEvents(events) {
  const byKey = new Map();
  for (const e of events) {
    // Dedup by normalized title + date — same film on different days is NOT a dupe
    const titleKey = normalizeTitle(e.title);
    const key = `${titleKey}|${e.date || ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, e);
    } else {
      // Prefer the one with a more specific venue (not the scraper source name)
      const genericVenues = new Set(['donyc', 'the skint', 'time out ny', 'secret nyc', 'brooklyn magazine', 'eventbrite', 'nyc parks', 'broadway']);
      const existingGeneric = genericVenues.has((existing.venue || '').toLowerCase());
      const newGeneric = genericVenues.has((e.venue || '').toLowerCase());
      if (existingGeneric && !newGeneric) {
        byKey.set(key, e);
      }
      // Prefer the one with a date if the other doesn't have one
      if (!existing.date && e.date) {
        byKey.set(key, e);
      }
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  const [inputPath, outputPath] = process.argv.slice(2);

  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/validate-events.js <input.json> <output.json>');
    process.exit(1);
  }

  let rawData;
  try {
    rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${inputPath}: ${e.message}`);
    process.exit(1);
  }

  // Accept array or { events: [...] } or { weekOf, events: [...] }
  const items = Array.isArray(rawData) ? rawData : (rawData.events || []);

  if (!Array.isArray(items) || items.length === 0) {
    console.error('No events found in input — refusing to overwrite output.');
    process.exit(1);
  }

  // Track per-source stats
  const sourceStats = {};
  function getStat(venue) {
    const key = venue || '(no venue)';
    if (!sourceStats[key]) sourceStats[key] = { input: 0, valid: 0, junk: 0, deduped: 0 };
    return sourceStats[key];
  }

  const validated = [];
  const allErrors = [];

  items.forEach((item, i) => {
    const venue = (item.venue || item.location || '').replace(/\s*\n\s*/g, ' ').trim();
    const stat = getStat(venue);
    stat.input++;
    const result = validateEvent(item, i);
    if (result.valid) {
      validated.push(result.event);
      stat.valid++;
    } else {
      stat.junk++;
      allErrors.push(...result.errors);
    }
  });

  // Deduplicate
  const deduped = dedupeEvents(validated);
  const dupeCount = validated.length - deduped.length;

  // Count deduped events per source
  const dedupedVenueCounts = {};
  for (const e of deduped) {
    const key = e.venue || '(no venue)';
    dedupedVenueCounts[key] = (dedupedVenueCounts[key] || 0) + 1;
  }
  for (const key of Object.keys(sourceStats)) {
    sourceStats[key].deduped = sourceStats[key].valid - (dedupedVenueCounts[key] || 0);
  }

  // Print per-source breakdown
  console.error('\n' + '='.repeat(75));
  console.error('VALIDATION REPORT');
  console.error('='.repeat(75));
  console.error('Source/Venue'.padEnd(30) + 'Input'.padEnd(8) + 'Junk'.padEnd(8) + 'Dupes'.padEnd(8) + 'Final');
  console.error('-'.repeat(75));
  const sorted = Object.entries(sourceStats).sort((a, b) => b[1].input - a[1].input);
  for (const [venue, s] of sorted) {
    const final = (dedupedVenueCounts[venue] || 0);
    const flag = s.junk > 0 || s.deduped > 5 ? ' ⚠' : '';
    console.error(
      venue.slice(0, 29).padEnd(30) +
      String(s.input).padEnd(8) +
      String(s.junk).padEnd(8) +
      String(s.deduped).padEnd(8) +
      String(final) + flag
    );
  }
  console.error('-'.repeat(75));
  console.error(
    'TOTAL'.padEnd(30) +
    String(items.length).padEnd(8) +
    String(allErrors.length).padEnd(8) +
    String(dupeCount).padEnd(8) +
    String(deduped.length)
  );
  console.error('='.repeat(75) + '\n');

  if (allErrors.length > 0) {
    console.warn(`Warnings (${allErrors.length} invalid/junk entries skipped):`);
    allErrors.slice(0, 30).forEach(e => console.warn('  ' + e));
    if (allErrors.length > 30) console.warn(`  ... and ${allErrors.length - 30} more`);
  }

  if (deduped.length === 0) {
    console.error('Zero valid events after validation — refusing to overwrite output.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2) + '\n');
  console.log(`Wrote ${deduped.length} events to ${outputPath} (${allErrors.length} junk skipped, ${dupeCount} dupes removed)`);
}

run();
