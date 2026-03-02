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
 * Usage:
 *   node scripts/validate-events.js <input.json> <output.json>
 *
 * Exits 0 on success, 1 on failure (output file untouched on failure).
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
  if (!date) errors.push(`[${index}] missing date`);
  if (date && !isValidDate(date)) errors.push(`[${index}] invalid date format: "${date}"`);

  if (errors.length > 0) return { valid: false, errors };

  const event = { id, title, venue, date, category, sourceUrl };
  if (time) event.time = time;
  if (description) event.description = description;
  if (price) event.price = price;

  return { valid: true, event };
}

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

  if (allErrors.length > 0) {
    console.warn(`Warnings (${allErrors.length} invalid entries skipped):`);
    allErrors.forEach(e => console.warn('  ' + e));
  }

  if (validated.length === 0) {
    console.error('Zero valid events after validation — refusing to overwrite output.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(validated, null, 2) + '\n');
  console.log(`Wrote ${validated.length} events to ${outputPath} (${allErrors.length} skipped)`);
}

run();
