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
  // Navigation / calendar chrome
  /^(january|february|march|april|may|june|july|august|september|october|november|december)/i,
  /january.*february|february.*march|march.*april/i,  // concatenated month names
  /^(sun|mon|tue|wed|thu|fri|sat)\b/i,
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

  // UI elements / social
  /^(follow us|subscribe|sign up|log ?in|register|newsletter|share|menu|search|close|back|home)$/i,
  /^(skip to|jump to|go to)/i,
  /^(copyright|©|\d{4}\s*(©|all rights))/i,
  /^(privacy|terms|disclaimer)/i,
  /^(powered by|built with)/i,

  // Generic non-event labels
  /^(featured|trending|popular|recommended|editor.?s? picks?)$/i,
  /^(buy tickets?|get tickets?|tickets?|rsvp|sold out)$/i,
  /^(free|paid|donation)$/i,
  /^(more info|learn more|read more|details|info)$/i,
  /^(image|photo|video|gallery|slideshow)/i,
  /^(advertisement|sponsored|ad)$/i,

  // Pure dates or times
  /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/,
  /^\d{1,2}:\d{2}\s*(am|pm)?$/i,
  /^\d{4}-\d{2}-\d{2}$/,
];

function isJunkTitle(title) {
  if (!title) return true;
  if (title.length < 4 || title.length > 120) return true;

  // Mostly non-alphabetic (less than 40% letters)
  const letters = (title.match(/[a-zA-Z]/g) || []).length;
  if (letters / title.length < 0.4) return true;

  // Check against junk patterns
  for (const pat of JUNK_PATTERNS) {
    if (pat.test(title)) return true;
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

  const title = (raw.title || raw.name || '').trim();
  const venue = (raw.venue || raw.location || '').trim();
  const date = (raw.date || '').trim();
  const category = (raw.category || raw.type || 'General').trim();
  const sourceUrl = (raw.sourceUrl || raw.url || raw.link || '').trim();
  const id = (raw.id || '').trim() || `${slugify(venue)}-${slugify(title)}-${index}`;
  const time = (raw.time || '').trim() || undefined;
  const description = (raw.description || '').trim() || undefined;
  const price = (raw.price || '').trim() || undefined;

  if (!title) errors.push(`[${index}] missing title`);
  if (isJunkTitle(title)) errors.push(`[${index}] junk title: "${title.slice(0, 60)}"`);
  if (!date) errors.push(`[${index}] missing date`);
  if (date && !isValidDate(date)) errors.push(`[${index}] invalid date format: "${date}"`);

  if (errors.length > 0) return { valid: false, errors };

  const event = { id, title, venue, date, category, sourceUrl };
  if (time) event.time = time;
  if (description) event.description = description;
  if (price) event.price = price;

  return { valid: true, event };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.title.toLowerCase().trim()}||${(e.venue || '').toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const validated = [];
  const allErrors = [];

  items.forEach((item, i) => {
    const result = validateEvent(item, i);
    if (result.valid) {
      validated.push(result.event);
    } else {
      allErrors.push(...result.errors);
    }
  });

  // Deduplicate
  const deduped = dedupeEvents(validated);
  const dupeCount = validated.length - deduped.length;

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
