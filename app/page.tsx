'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Event, Category, EventsData } from '@/lib/types';
import type { RawEvent } from '@/lib/types';
import { format, isBefore, startOfDay, addDays, startOfMonth, endOfMonth, getDay, addMonths, subMonths, isSameMonth, isWithinInterval, isSameDay, isWeekend } from 'date-fns';

// --- Date helpers ---

function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDateRange(date: string): boolean {
  return date.includes(' to ');
}

function parseDateRange(date: string): { start: Date; end: Date } | null {
  if (!isDateRange(date)) return null;
  const [s, e] = date.split(' to ').map(d => d.trim());
  return { start: toDate(s), end: toDate(e) };
}

function getDateLabel(date: string): string {
  if (!isDateRange(date)) return format(toDate(date), 'EEEE, MMMM d');
  const range = parseDateRange(date);
  if (!range) return date;
  if (range.start.getMonth() === range.end.getMonth()) {
    return `${format(range.start, 'MMM d')} – ${format(range.end, 'd')}`;
  }
  return `${format(range.start, 'MMM d')} – ${format(range.end, 'MMM d')}`;
}

function isEventFuture(eventDate: string | null, today: Date): boolean {
  if (!eventDate) return true;
  if (isDateRange(eventDate)) {
    const range = parseDateRange(eventDate);
    if (!range) return false;
    return !isBefore(range.end, today);
  }
  return !isBefore(toDate(eventDate), today);
}

/** Check if an event falls on a specific day (single-date or within range) */
function eventOnDay(event: Event, dayStr: string): boolean {
  if (!event.date) return false;
  if (isDateRange(event.date)) {
    const range = parseDateRange(event.date);
    if (!range) return false;
    const day = toDate(dayStr);
    return isWithinInterval(day, { start: range.start, end: range.end });
  }
  return event.date === dayStr;
}

// --- Showtime detection ---

const SHOWTIME_VENUES = new Set([
  'ifc center', 'metrograph', 'film forum', 'angelika film center', 'bam',
]);

const SPECIAL_EVENT_KEYWORDS = /\b(q\s*&?\s*a|panel|introduction by|intro by|premiere|opening night|special screening|live (score|music|accompaniment)|marathon|festival|retrospective|in person|discussion|conversation|filmmaker|director|cast)\b/i;

/** Returns true if this Film event is a regular showtime (not a special event) */
function isShowtime(event: Event): boolean {
  if (event.category !== 'Film') return false;
  if (!SHOWTIME_VENUES.has(event.venue.toLowerCase())) return false;
  // Check title and description for special event keywords
  const text = `${event.title} ${event.description || ''}`;
  if (SPECIAL_EVENT_KEYWORDS.test(text)) return false;
  return true;
}

/** Returns true if this event is a long-running exhibition / "on view" item */
function isOnView(event: Event): boolean {
  // No date → on view
  if (!event.date) return true;
  // Date range > 14 days → on view
  if (isDateRange(event.date)) {
    const range = parseDateRange(event.date);
    if (range) {
      const days = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 14) return true;
    }
  }
  return false;
}

// --- Category config ---

const categoryConfig: { key: Category; label: string; bg: string; text: string; dot: string }[] = [
  { key: 'Art', label: 'Art & Museums', bg: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' },
  { key: 'Ballet', label: 'Ballet', bg: '#fce7f3', text: '#be185d', dot: '#ec4899' },
  { key: 'Cars & Coffee', label: 'Cars & Coffee', bg: '#cffafe', text: '#155e75', dot: '#06b6d4' },
  { key: 'Chinatown/Flushing/LIC', label: 'Chinatown/Flushing', bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  { key: 'Classical Music', label: 'Classical', bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
  { key: 'Comedy', label: 'Comedy', bg: '#fef9c3', text: '#713f12', dot: '#facc15' },
  { key: 'Dance', label: 'Dance', bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  { key: 'Family', label: 'Family', bg: '#fce7f3', text: '#9d174d', dot: '#f472b6' },
  { key: 'Film', label: 'Film', bg: '#fde8e8', text: '#b91c1c', dot: '#ef4444' },
  { key: 'Food/Drink', label: 'Food & Drink', bg: '#ffedd5', text: '#c2410c', dot: '#f97316' },
  { key: 'Jazz', label: 'Jazz', bg: '#e0e7ff', text: '#3730a3', dot: '#6366f1' },
  { key: 'Shopping/Markets', label: 'Markets', bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
  { key: 'Opera', label: 'Opera', bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  { key: 'Outdoor/Parks', label: 'Outdoor', bg: '#d1fae5', text: '#14532d', dot: '#22c55e' },
  { key: 'Music/Performing Arts', label: 'Performing Arts', bg: '#fce7f3', text: '#9d174d', dot: '#f472b6' },
  { key: 'Talk', label: 'Talks', bg: '#f3e8ff', text: '#7e22ce', dot: '#a855f7' },
  { key: 'Theater', label: 'Theater', bg: '#fef3c7', text: '#78350f', dot: '#d97706' },
  { key: 'Other', label: 'Other', bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af' },
];

const categoryAliases: Record<string, Category> = {
  'art': 'Art', 'arts': 'Art', 'museums/art': 'Art', 'museum exhibition': 'Art',
  'museum': 'Art', 'exhibition': 'Art', 'gallery': 'Art',
  'classical': 'Classical Music', 'classical music': 'Classical Music',
  'orchestra': 'Classical Music', 'symphony': 'Classical Music', 'chamber music': 'Classical Music',
  'ballet': 'Ballet', 'american ballet theatre': 'Ballet', 'opera': 'Opera', 'dance': 'Dance',
  'comedy': 'Comedy', 'standup': 'Comedy', 'stand-up': 'Comedy', 'improv': 'Comedy',
  'jazz': 'Jazz', 'theater': 'Theater', 'theatre': 'Theater',
  'musical': 'Theater', 'broadway': 'Theater', 'off-broadway': 'Theater',
  'music': 'Music/Performing Arts', 'concert': 'Music/Performing Arts',
  'concerts': 'Music/Performing Arts', 'live music': 'Music/Performing Arts',
  'performing arts': 'Music/Performing Arts',
  'outdoor': 'Outdoor/Parks', 'parks': 'Outdoor/Parks', 'fitness': 'Outdoor/Parks',
  'workshop': 'Talk', 'lecture': 'Talk', 'reading': 'Talk', 'storytelling': 'Talk',
  'general': 'Other', 'attraction': 'Other', 'circus': 'Other',
  'sports': 'Other', 'party': 'Other', 'gallery experience': 'Art',
};

function getCategoryStyle(category: Category) {
  return categoryConfig.find(c => c.key === category) || categoryConfig[categoryConfig.length - 1];
}

function normalizeCategory(raw: string): Category {
  const alias = categoryAliases[raw.toLowerCase()];
  if (alias) return alias;
  const match = categoryConfig.find(c => c.key.toLowerCase() === raw.toLowerCase());
  return match ? match.key : 'Other';
}

// --- Borough inference ---

type Borough = 'Manhattan' | 'Brooklyn' | 'Queens' | 'Bronx' | 'Other';

const MANHATTAN_VENUES = new Set([
  '92ny', 'angelika film center', 'astor place theatre', 'beacon theatre',
  'blue note jazz club', 'bowery palace', 'broadway', 'cafe wha?', 'carnegie hall',
  'caveat', 'city winery', 'club cumming', 'film forum', 'groove', 'guggenheim',
  'hard rock hotel & casino', 'ifc center', 'ihop', 'iridium jazz club',
  'irving plaza', 'japan society', 'joe\'s pub', 'le poisson rouge', 'lincoln center',
  'madison square garden', 'marquee new york', 'mercury lounge', 'metrograph',
  'metropolitan opera', 'neue galerie', 'new museum', 'new york city ballet',
  'new york philharmonic', 'night club 101', 'nublu 151', 'pianos',
  'racket', 'sid gold\'s request room', 'smalls jazz club', 'sofar sounds - secret location',
  'sony hall', 'strand bookstore', 'terra blues', 'terminal 5',
  'the bowery ballroom', 'the cooper union', 'the frick collection',
  'the gramercy theatre', 'the joyce theater', 'the met', 'the shed',
  'the slipper room', 'the stand', 'the stone pony', 'webster hall',
  'whitney museum', 'american ballet theatre',
  // Additional Manhattan venues
  'arlene\'s grocery', 'new york comedy club east village',
  'new york comedy club upper west side', 'new york comedy club',
  'stephen a. schwarzman auditorium', 'onsite: stephen a. schwarzman auditorium',
  'library gallery', 'west gallery', 'dining room',
  'ronald s. lauder exhibition galleries', 'sleepwalk',
  'the skint', 'secret nyc', 'joe\'s pub',
]);

const BROOKLYN_VENUES = new Set([
  'bam', 'baby\'s all right', 'barclays center', 'brooklyn bowl', 'brooklyn paper',
  'brooklyn paramount', 'brooklyn steel', 'c\'mon everybody', 'elsewhere',
  'elsewhere the hall', 'good judy', 'good room', 'knockdown center',
  'littlefield', 'music hall of williamsburg', 'public records',
  'rough trade nyc', 'the bell house', 'the sultan room', 'tv eye',
  'union pool', 'warsaw', 'xanadu',
  // Additional Brooklyn venues
  '3 dollar bill', 'alphaville',
]);

const QUEENS_VENUES = new Set([
  'its in queens', 'museum of the moving image', 'pregones theater',
]);

const BRONX_VENUES = new Set([
  'daryl\'s house',
]);

function inferBorough(venue: string): Borough {
  const v = venue.toLowerCase().trim();
  if (MANHATTAN_VENUES.has(v)) return 'Manhattan';
  if (BROOKLYN_VENUES.has(v)) return 'Brooklyn';
  if (QUEENS_VENUES.has(v)) return 'Queens';
  if (BRONX_VENUES.has(v)) return 'Bronx';
  // NYC Parks venues and others with borough in the name
  if (v.includes('manhattan') || v.includes('central park') || v.includes('high line')) return 'Manhattan';
  if (v.includes('brooklyn')) return 'Brooklyn';
  if (v.includes('queens') || v.includes('elmhurst') || v.includes('flushing') || v.includes('astoria') || v.includes('lic')) return 'Queens';
  if (v.includes('bronx')) return 'Bronx';
  if (v.includes('staten island')) return 'Other';
  return 'Other';
}

const boroughConfig: { key: Borough; label: string; emoji: string }[] = [
  { key: 'Manhattan', label: 'Manhattan', emoji: '🏙️' },
  { key: 'Brooklyn', label: 'Brooklyn', emoji: '🌉' },
  { key: 'Queens', label: 'Queens', emoji: '👑' },
  { key: 'Bronx', label: 'Bronx', emoji: '🏟️' },
];

// --- Main component ---

export default function Home() {
  const [eventsData, setEventsData] = useState<EventsData>({ weekOf: '', events: [] });
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [viewMode, setViewMode] = useState<'calendar' | 'category' | 'showtimes' | 'onview'>('calendar');
  const [loading, setLoading] = useState(true);
  const [today] = useState(() => startOfDay(new Date()));
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(() => {
    const t = startOfDay(new Date());
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'today' | 'weekend'>('all');
  const [selectedBoroughs, setSelectedBoroughs] = useState<Borough[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Dark mode effect
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('nwnyc-dark') : null;
    if (saved === 'true') setDarkMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('nwnyc-dark', String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    Promise.all([
      fetch('/data/events.json').then(r => r.json()).catch(() => []),
      fetch('/data/film_museum_events.json').then(r => r.json()).catch(() => [])
    ]).then(([raw1, raw2]) => {
      const arr1: RawEvent[] = Array.isArray(raw1) ? raw1 : (raw1.events || []);
      const arr2: RawEvent[] = Array.isArray(raw2) ? raw2 : (raw2.events || []);

      // Try to get lastUpdated from either file
      const ts = (raw1 as any)?.lastUpdated || (raw2 as any)?.lastUpdated || null;
      if (ts) setLastUpdated(ts);

      const allRaw = [...arr1, ...arr2];

      // Dedup on title|venue — prefer the entry that has a date
      const bestByKey = new Map<string, RawEvent>();
      for (const e of allRaw) {
        const title = (e.title || e.name || '').trim().toLowerCase();
        const venue = (e.venue || e.location || '').trim().toLowerCase();
        const key = `${title}|${venue}`;
        const existing = bestByKey.get(key);
        if (!existing) {
          bestByKey.set(key, e);
        } else {
          // Prefer the one with a date; if both have dates, prefer the more specific one
          const existingHasDate = !!existing.date;
          const newHasDate = !!e.date;
          if (!existingHasDate && newHasDate) {
            bestByKey.set(key, e);
          }
        }
      }
      const unique = Array.from(bestByKey.values());

      const processed: Event[] = unique
        .map((e, i) => ({
          id: e.id || `evt-${i}`,
          title: (e.title || e.name || '').trim(),
          venue: (e.venue || e.location || '').trim(),
          date: e.date || null,
          category: normalizeCategory(e.category || e.type || 'Other'),
          sourceUrl: (e.sourceUrl || e.url || e.link || '').trim(),
          ...(e.time ? { time: e.time } : {}),
          ...(e.description ? { description: e.description } : {}),
          ...(e.price ? { price: e.price } : {}),
        }))
        .filter(e => isEventFuture(e.date, today));

      setEventsData({ weekOf: toStr(today), events: processed });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [today]);

  const presentCategories = Array.from(new Set(eventsData.events.map(e => e.category)));
  const visibleCategoryConfig = categoryConfig.filter(c => presentCategories.includes(c.key));
  const deduped = visibleCategoryConfig.filter((c, i, arr) =>
    arr.findIndex(x => x.label === c.label) === i
  );

  // Search filter
  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return eventsData.events;
    const q = searchQuery.toLowerCase().trim();
    return eventsData.events.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.venue.toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  }, [eventsData.events, searchQuery]);

  // Quick filter (today / this weekend)
  const quickFiltered = useMemo(() => {
    if (quickFilter === 'all') return searchFiltered;
    if (quickFilter === 'today') {
      const todayStr = toStr(today);
      return searchFiltered.filter(e => eventOnDay(e, todayStr));
    }
    // weekend: Friday through Sunday
    const fri = addDays(today, ((5 - today.getDay()) + 7) % 7);
    const sat = addDays(fri, 1);
    const sun = addDays(fri, 2);
    const days = [toStr(fri), toStr(sat), toStr(sun)];
    return searchFiltered.filter(e => days.some(d => eventOnDay(e, d)));
  }, [searchFiltered, quickFilter, today]);

  const filteredEvents = useMemo(() => {
    let result = quickFiltered;
    if (selectedCategories.length > 0) {
      result = result.filter(e => selectedCategories.includes(e.category));
    }
    if (selectedBoroughs.length > 0) {
      result = result.filter(e => selectedBoroughs.includes(inferBorough(e.venue)));
    }
    return result;
  }, [quickFiltered, selectedCategories, selectedBoroughs]);

  // Split showtimes and on-view from calendar events
  const showtimeEvents = filteredEvents.filter(isShowtime);
  const onViewEvents = filteredEvents.filter(e => !isShowtime(e) && isOnView(e));
  const calendarEvents = filteredEvents.filter(e => !isShowtime(e) && !isOnView(e));

  // Tab counts (from full data, not filtered)
  const allShowtimes = eventsData.events.filter(isShowtime);
  const allOnView = eventsData.events.filter(e => !isShowtime(e) && isOnView(e));
  const allCalendar = eventsData.events.filter(e => !isShowtime(e) && !isOnView(e));

  const tabs: { mode: 'calendar' | 'showtimes' | 'onview' | 'category'; label: string; icon: string; count: number }[] = [
    { mode: 'calendar', label: 'Calendar', icon: '\uD83D\uDCC5', count: allCalendar.length },
    { mode: 'showtimes', label: 'Showtimes', icon: '\uD83C\uDFAC', count: allShowtimes.length },
    { mode: 'onview', label: 'Ongoing', icon: '\uD83C\uDFA8', count: allOnView.length },
    { mode: 'category', label: 'Category', icon: '\uD83D\uDCC2', count: allCalendar.length },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text-muted)' }}>
        <p style={{ fontSize: '1.1rem' }}>Loading events...</p>
      </div>
    );
  }

  return (
    <>
    <main className="main-content" style={{ minHeight: '100vh', padding: '2rem 1.5rem', maxWidth: '72rem', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        {/* Top row: title + dark mode toggle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' as const }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 300, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: 0, lineHeight: 1.1 }}>
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>next week</span>
              {' '}
              <span style={{
                fontWeight: 800, letterSpacing: '-0.01em',
                background: 'linear-gradient(135deg, #e07a5f, #d4543a)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>NYC</span>
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.125rem', fontStyle: 'italic', letterSpacing: '0.01em', margin: 0 }}>
              curated film, art, music, theater & more for the city
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: '#e07a5f',
              background: 'linear-gradient(135deg, #fde8e8, #fef3c7)',
              padding: '0.3rem 0.875rem', borderRadius: '999px',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button
              className="dark-toggle"
              onClick={() => setDarkMode(d => !d)}
              aria-label="Toggle dark mode"
            >
              {darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
            </button>
          </div>
        </div>

        {/* Stats + inline search */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginTop: '0.625rem', flexWrap: 'wrap' as const }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>
            {allCalendar.length} event{allCalendar.length !== 1 ? 's' : ''}
            {allShowtimes.length > 0 && ` \u00B7 ${allShowtimes.length} showtime${allShowtimes.length !== 1 ? 's' : ''}`}
            {allOnView.length > 0 && ` \u00B7 ${allOnView.length} ongoing`}
          </p>
          <div style={{ position: 'relative', minWidth: '180px', maxWidth: '260px', flex: '0 1 260px' }}>
            <span style={{ position: 'absolute', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              {'\uD83D\uDD0D'}
            </span>
            <input
              className="search-input"
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', padding: '0.4rem 0.625rem 0.4rem 1.875rem',
                borderRadius: '0.5rem', fontSize: '0.8125rem',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem',
                  color: 'var(--text-muted)', padding: '0.125rem',
                }}
                aria-label="Clear search"
              >
                {'\u2715'}
              </button>
            )}
          </div>
        </div>

        {/* Quick filters: Clear all moved to borough row */}

        {/* Desktop tab bar */}
        <div className="desktop-tabs" style={{ display: 'inline-flex', background: 'var(--bg-tab)', borderRadius: '0.5rem', padding: '3px', marginTop: '0.75rem' }}>
          {tabs.map(({ mode, label, icon, count }) => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setSelectedCategories([]); }}
              style={{
                padding: '0.4rem 0.875rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 500,
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
                background: viewMode === mode ? 'var(--bg-card)' : 'transparent',
                color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {icon} {label}
              <span style={{
                fontSize: '0.6875rem', fontWeight: 700,
                background: viewMode === mode ? 'var(--accent-light)' : 'var(--border-light)',
                color: viewMode === mode ? 'var(--accent)' : 'var(--text-muted)',
                padding: '0.05rem 0.4rem', borderRadius: '999px', minWidth: '1.5rem', textAlign: 'center',
              }}>
                {count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Borough filter — sits between tabs and category pills, visible on all tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem', marginBottom: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light)', alignItems: 'center' }}>
        {boroughConfig.map(({ key, label, emoji }) => {
          const isActive = selectedBoroughs.includes(key);
          return (
            <button
              key={key}
              onClick={() => {
                setSelectedBoroughs(prev =>
                  isActive ? prev.filter(b => b !== key) : [...prev, key]
                );
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.375rem 0.75rem', borderRadius: '999px', fontSize: '0.8125rem', fontWeight: 500,
                border: isActive ? '1.5px solid #e07a5f' : '1.5px solid var(--border)',
                background: isActive ? '#fde8e8' : 'var(--bg-card)',
                color: isActive ? '#b91c1c' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: '0.75rem' }}>{emoji}</span>
              {label}
            </button>
          );
        })}
        {/* Inline clear all — only visible when filters are active */}
        {(searchQuery || selectedCategories.length > 0 || selectedBoroughs.length > 0) && (
          <button
            onClick={() => { setSearchQuery(''); setSelectedCategories([]); setSelectedBoroughs([]); }}
            style={{
              padding: '0.3rem 0.625rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600,
              border: '1.5px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-muted)', cursor: 'pointer', marginLeft: '0.25rem',
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Category filters (hidden on Showtimes / On View) */}
      {viewMode !== 'showtimes' && viewMode !== 'onview' && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem', marginBottom: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light)' }}>
          {deduped.map(({ key, label, bg, text, dot }) => {
            const matchingKeys = categoryConfig.filter(c => c.label === label).map(c => c.key);
            const isActive = matchingKeys.some(k => selectedCategories.includes(k));
            return (
              <button
                key={key}
                onClick={() => {
                  setSelectedCategories(prev => {
                    if (isActive) return prev.filter(c => !matchingKeys.includes(c));
                    return [...prev, ...matchingKeys.filter(k => !prev.includes(k))];
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                  padding: '0.375rem 0.75rem', borderRadius: '999px', fontSize: '0.8125rem', fontWeight: 500,
                  border: isActive ? `1.5px solid ${dot}` : '1.5px solid var(--border)',
                  background: isActive ? bg : 'var(--bg-card)', color: isActive ? text : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? dot : '#d1d1d1' }} />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {viewMode === 'category' ? (
        <EventList events={calendarEvents} />
      ) : viewMode === 'showtimes' ? (
        <ShowtimesView events={showtimeEvents} currentMonth={currentMonth} today={today} />
      ) : viewMode === 'onview' ? (
        <OnViewTab events={onViewEvents} today={today} />
      ) : (
        <MonthCalendar
          events={calendarEvents}
          currentMonth={currentMonth}
          onMonthChange={setCurrentMonth}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          today={today}
        />
      )}

      {/* Footer */}
      <footer style={{
        marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)',
        textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem',
      }}>
        <p style={{ margin: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon-16x16.png" alt="" width={14} height={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.25rem', borderRadius: '2px' }} />
          Next Week NYC
        </p>
        {lastUpdated && (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem' }}>
            Last updated: {format(new Date(lastUpdated), 'MMM d, yyyy h:mm a')}
          </p>
        )}
        {!lastUpdated && (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem' }}>
            Data refreshed Mon & Thu
          </p>
        )}
      </footer>

      <ScrollToTop />
    </main>

    {/* Mobile bottom nav */}
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {tabs.map(({ mode, label, icon, count }) => (
        <button
          key={mode}
          className={viewMode === mode ? 'active' : ''}
          onClick={() => { setViewMode(mode); setSelectedCategories([]); }}
          aria-label={label}
        >
          <span className="nav-icon">{icon}</span>
          <span className="nav-badge">{count}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
    </>
  );
}

// --- Scroll to top button ---

function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      className="scroll-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      style={{
        position: 'fixed', bottom: '2rem', right: '1.5rem', zIndex: 50,
        width: '44px', height: '44px', borderRadius: '50%',
        background: 'var(--text-primary)', color: 'var(--bg)', border: 'none',
        cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = '#e07a5f';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = 'var(--text-primary)';
        e.currentTarget.style.transform = 'none';
      }}
    >
      ↑
    </button>
  );
}

// --- Shared UI ---

function CategoryTag({ category }: { category: Category }) {
  const style = getCategoryStyle(category);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      fontSize: '0.6875rem', fontWeight: 600, padding: '0.2rem 0.5rem',
      borderRadius: '999px', background: style.bg, color: style.text,
      letterSpacing: '0.01em', textTransform: 'uppercase',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: style.dot }} />
      {style.label}
    </span>
  );
}

function DateBadge({ date }: { date: string | null }) {
  if (!date || !isDateRange(date)) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      fontSize: '0.6875rem', fontWeight: 500, padding: '0.15rem 0.5rem',
      borderRadius: '999px', background: '#e0e7ff', color: '#3730a3',
    }}>
      📅 {getDateLabel(date)}
    </span>
  );
}

function EventCard({ event, showDate }: { event: Event; showDate?: boolean }) {
  return (
    <a
      href={event.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block', padding: '1rem 1.25rem', background: 'var(--bg-card)',
        borderRadius: '0.75rem', border: '1px solid var(--border)',
        textDecoration: 'none', color: 'inherit', transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.borderColor = 'var(--text-muted)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' as const }}>
            <CategoryTag category={event.category} />
            {showDate && <DateBadge date={event.date} />}
            {event.time && event.time !== 'TBA' && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{event.time}</span>
            )}
          </div>
          <h4 style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {event.title}
          </h4>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>{event.venue}</p>
        </div>
        {event.price && event.price !== 'TBA' && (
          <span style={{
            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
            background: 'var(--border-light)', padding: '0.25rem 0.625rem',
            borderRadius: '0.375rem', whiteSpace: 'nowrap',
          }}>
            {event.price}
          </span>
        )}
      </div>
      {event.description && (
        <p style={{
          fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {event.description}
        </p>
      )}
    </a>
  );
}

// --- Empty state ---

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '0.75rem', opacity: 0.6 }}>{icon}</div>
      <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{title}</p>
      <p style={{ fontSize: '0.875rem', margin: 0 }}>{subtitle}</p>
    </div>
  );
}

// --- Category (List) View ---

function EventList({ events }: { events: Event[] }) {
  const singleDay = events.filter(e => e.date && !isDateRange(e.date));
  const multiDay = events.filter(e => e.date && isDateRange(e.date));
  const noDate = events.filter(e => !e.date);

  const grouped = singleDay.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = {};
    if (!acc[event.category][event.date!]) acc[event.category][event.date!] = [];
    acc[event.category][event.date!].push(event);
    return acc;
  }, {} as Record<string, Record<string, Event[]>>);

  const multiGrouped = multiDay.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = [];
    acc[event.category].push(event);
    return acc;
  }, {} as Record<string, Event[]>);

  const noDateGrouped = noDate.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = [];
    acc[event.category].push(event);
    return acc;
  }, {} as Record<string, Event[]>);

  const allCategories = Array.from(new Set([
    ...Object.keys(grouped),
    ...Object.keys(multiGrouped),
    ...Object.keys(noDateGrouped),
  ])).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '2.5rem' }}>
      {allCategories.map(category => {
        const style = getCategoryStyle(category as Category);
        const singleEntries = grouped[category]
          ? Object.entries(grouped[category]).sort(([a], [b]) => a.localeCompare(b))
          : [];
        const multiEntries = multiGrouped[category] || [];
        const noDateEntries = noDateGrouped[category] || [];
        const totalCount = singleEntries.reduce((n, [, evts]) => n + evts.length, 0) + multiEntries.length + noDateEntries.length;

        return (
          <section key={category}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--border-light)',
            }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: style.dot }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                {style.label}
              </h2>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                ({totalCount})
              </span>
            </div>

            {multiEntries.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}>
                  <span style={{ fontSize: '0.875rem' }}>🗓</span> Multiple Days
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
                  {multiEntries.map(event => (
                    <EventCard key={event.id} event={event} showDate />
                  ))}
                </div>
              </div>
            )}

            {noDateEntries.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}>
                  <span style={{ fontSize: '0.875rem' }}>📌</span> Ongoing / Date TBD
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
                  {noDateEntries.map(event => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            )}

            {singleEntries.map(([date, dayEvents]) => (
              <div key={date} style={{ marginBottom: '1.25rem' }}>
                <h3 style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                }}>
                  {format(toDate(date), 'EEEE, MMMM d')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
                  {dayEvents.map(event => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {events.length === 0 && (
        <EmptyState
          icon={'\uD83C\uDFAD'}
          title="Nothing here yet"
          subtitle="Try adjusting your filters or check back later"
        />
      )}
    </div>
  );
}

// --- Monthly Calendar View ---

function MonthCalendar({
  events, currentMonth, onMonthChange, selectedDay, onSelectDay, today,
}: {
  events: Event[];
  currentMonth: Date;
  onMonthChange: (d: Date) => void;
  selectedDay: string | null;
  onSelectDay: (d: string | null) => void;
  today: Date;
}) {
  const todayStr = toStr(today);
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Build calendar grid: pad start to Sunday, pad end to Saturday
  const startDow = getDay(monthStart); // 0=Sun
  const calendarStart = addDays(monthStart, -startDow);
  const endDow = getDay(monthEnd);
  const calendarEnd = addDays(monthEnd, 6 - endDow);

  const calendarDays: Date[] = [];
  let cursor = calendarStart;
  while (cursor <= calendarEnd) {
    calendarDays.push(cursor);
    cursor = addDays(cursor, 1);
  }

  // Pre-compute event counts per day for the visible calendar
  const eventCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    const catDotMap: Record<string, Set<string>> = {};
    for (const day of calendarDays) {
      const ds = toStr(day);
      let count = 0;
      const cats = new Set<string>();
      for (const ev of events) {
        if (eventOnDay(ev, ds)) {
          count++;
          cats.add(ev.category);
        }
      }
      map[ds] = count;
      catDotMap[ds] = cats;
    }
    return { counts: map, cats: catDotMap };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, toStr(monthStart)]);

  // Events for the selected day
  const selectedDayEvents = selectedDay
    ? events.filter(ev => eventOnDay(ev, selectedDay)).sort((a, b) => {
        const catOrder = categoryConfig.findIndex(c => c.key === a.category) - categoryConfig.findIndex(c => c.key === b.category);
        if (catOrder !== 0) return catOrder;
        return a.title.localeCompare(b.title);
      })
    : [];

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      {/* Month navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '1rem', padding: '0.5rem 0',
      }}>
        <button
          onClick={() => { onMonthChange(subMonths(currentMonth, 1)); onSelectDay(null); }}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '0.5rem',
            padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem',
            color: 'var(--text-secondary)', fontWeight: 500, transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--border-light)'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
        >
          ← {format(subMonths(currentMonth, 1), 'MMM')}
        </button>
        <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <button
          onClick={() => { onMonthChange(addMonths(currentMonth, 1)); onSelectDay(null); }}
          style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '0.5rem',
            padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem',
            color: 'var(--text-secondary)', fontWeight: 500, transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--border-light)'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
        >
          {format(addMonths(currentMonth, 1), 'MMM')} →
        </button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', marginBottom: '1px' }}>
        {DOW_LABELS.map(d => (
          <div key={d} style={{
            textAlign: 'center', padding: '0.5rem', fontSize: '0.75rem',
            fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '0.05em', background: 'var(--border-light)', borderRadius: d === 'Sun' ? '0.5rem 0 0 0' : d === 'Sat' ? '0 0.5rem 0 0' : '0',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px',
        background: 'var(--border)', borderRadius: '0 0 0.75rem 0.75rem', overflow: 'hidden',
      }}>
        {calendarDays.map(day => {
          const ds = toStr(day);
          const inMonth = isSameMonth(day, currentMonth);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDay;
          const count = eventCountMap.counts[ds] || 0;
          const dayCats = eventCountMap.cats[ds] || new Set();
          const isPast = isBefore(day, today);

          // Get up to 4 category dots
          const dotColors: string[] = [];
          Array.from(dayCats).forEach(cat => {
            const s = getCategoryStyle(cat as Category);
            if (dotColors.length < 4) dotColors.push(s.dot);
          });

          return (
            <button
              key={ds}
              onClick={() => count > 0 ? onSelectDay(isSelected ? null : ds) : undefined}
              style={{
                background: isSelected ? 'var(--bg-card-hover)' : isToday ? 'var(--bg-card-hover)' : inMonth ? 'var(--bg-card)' : 'var(--bg)',
                border: 'none',
                borderBottom: isSelected ? '3px solid #e07a5f' : '3px solid transparent',
                padding: '0.5rem 0.375rem',
                minHeight: '80px',
                cursor: count > 0 ? 'pointer' : 'default',
                opacity: inMonth ? 1 : 0.4,
                transition: 'all 0.1s ease',
                display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <span style={{
                fontSize: '0.9375rem', fontWeight: isToday ? 700 : 500,
                color: isToday ? '#fff' : isPast && inMonth ? 'var(--text-muted)' : inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isToday ? '#e07a5f' : 'transparent',
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>
                {format(day, 'd')}
              </span>

              {count > 0 && (
                <span style={{
                  fontSize: '0.6875rem', fontWeight: 600,
                  color: isSelected ? '#e07a5f' : 'var(--text-secondary)',
                  lineHeight: 1,
                }}>
                  {count}
                </span>
              )}

              {dotColors.length > 0 && (
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' as const, justifyContent: 'center' }}>
                  {dotColors.map((color, i) => (
                    <span key={i} style={{
                      width: '5px', height: '5px', borderRadius: '50%', background: color,
                    }} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected day detail panel */}
      {selectedDay && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--border-light)',
          }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {format(toDate(selectedDay), 'EEEE, MMMM d')}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                {selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => onSelectDay(null)}
                style={{
                  background: 'var(--border-light)', border: 'none', borderRadius: '0.375rem',
                  padding: '0.25rem 0.625rem', cursor: 'pointer', fontSize: '0.75rem',
                  color: 'var(--text-muted)', fontWeight: 500,
                }}
              >
                ✕ Close
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
            {selectedDayEvents.map(event => (
              <EventCard key={event.id} event={event} showDate={isDateRange(event.date || '')} />
            ))}
            {selectedDayEvents.length === 0 && (
              <EmptyState icon={'\uD83D\uDCC5'} title="No events on this day" subtitle="Select another day or browse the calendar" />
            )}
          </div>
        </div>
      )}

      {/* Ongoing / no-date events */}
      <OngoingEvents events={events} />

      <style>{`
        @media (max-width: 640px) {
          div[style*="grid-template-columns: repeat(7"] {
            font-size: 0.8125rem;
          }
        }
      `}</style>
    </div>
  );
}

// --- Showtimes View ---

const VENUE_COLORS: Record<string, { accent: string; bg: string; text: string; border: string; dot: string }> = {
  'metrograph':          { accent: '#7c3aed', bg: '#f5f3ff', text: '#5b21b6', border: '#c4b5fd', dot: '#8b5cf6' },
  'ifc center':          { accent: '#0891b2', bg: '#ecfeff', text: '#155e75', border: '#a5f3fc', dot: '#06b6d4' },
  'film forum':          { accent: '#0d9488', bg: '#f0fdfa', text: '#115e59', border: '#99f6e4', dot: '#14b8a6' },
  'angelika film center':{ accent: '#be185d', bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8', dot: '#ec4899' },
  'bam':                 { accent: '#9d174d', bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8', dot: '#ec4899' },
};
const DEFAULT_VENUE_COLOR = { accent: '#6b7280', bg: '#f9fafb', text: '#374151', border: '#d1d5db', dot: '#9ca3af' };

function getVenueColor(venue: string) {
  return VENUE_COLORS[venue.toLowerCase()] || DEFAULT_VENUE_COLOR;
}

const NOW_PLAYING_COLLAPSED = 8;

function NowPlayingGrid({ films, vc }: { films: Event[]; vc: { accent: string; bg: string; text: string; border: string; dot: string } }) {
  const [expanded, setExpanded] = useState(false);
  const showToggle = films.length > NOW_PLAYING_COLLAPSED;
  const visible = expanded ? films : films.slice(0, NOW_PLAYING_COLLAPSED);

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '0.375rem',
      }}>
        {visible.map(film => (
          <a
            key={film.id}
            href={film.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block', textDecoration: 'none', color: 'var(--text-primary)',
              padding: '0.375rem 0.625rem', borderRadius: '0.375rem',
              background: 'var(--bg-card)', border: `1px solid ${vc.border}`,
              borderLeft: `3px solid ${vc.accent}`,
              transition: 'all 0.15s ease',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.borderColor = vc.accent;
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
              e.currentTarget.style.borderColor = vc.border;
              e.currentTarget.style.borderLeftColor = vc.accent;
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = 'none';
            }}
            title={film.title}
          >
            <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{film.title}</span>
          </a>
        ))}
      </div>
      {showToggle && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'block', margin: '0.5rem auto 0', padding: '0.25rem 0.75rem',
            borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600,
            border: `1px solid ${vc.border}`, background: 'var(--bg-card)', color: vc.accent,
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          {expanded ? '▲ Show less' : `▼ Show all ${films.length} films`}
        </button>
      )}
    </div>
  );
}

function ShowtimesView({ events, currentMonth, today }: { events: Event[]; currentMonth: Date; today: Date }) {
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);

  const venues = Array.from(new Set(events.map(e => e.venue))).sort();
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const filteredByMonth = events.filter(e => {
    if (!e.date) return false;
    if (isDateRange(e.date)) {
      const range = parseDateRange(e.date);
      if (!range) return false;
      return range.end >= monthStart && range.start <= monthEnd;
    }
    const d = toDate(e.date);
    return d >= monthStart && d <= monthEnd;
  });

  // Group: venue → date → films
  const grouped: Record<string, Record<string, Event[]>> = {};
  for (const e of filteredByMonth) {
    if (!e.date) continue;
    const v = e.venue;
    if (!grouped[v]) grouped[v] = {};
    // For range dates, use the start date as the grouping key
    const dateKey = isDateRange(e.date) ? e.date.split(' to ')[0] : e.date;
    if (!grouped[v][dateKey]) grouped[v][dateKey] = [];
    grouped[v][dateKey].push(e);
  }

  const todayStr = toStr(today);
  const activeVenues = selectedVenue ? [selectedVenue] : venues;

  // Collect "today" films across all active venues
  const todayFilms = activeVenues.flatMap(v => (grouped[v]?.[todayStr] || []))
    .sort((a, b) => a.venue.localeCompare(b.venue) || a.title.localeCompare(b.title));

  return (
    <div>
      {/* Venue filter pills */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
          {venues.map(v => {
            const vc = getVenueColor(v);
            const isActive = selectedVenue === v;
            const count = grouped[v] ? Object.values(grouped[v]).reduce((n, arr) => n + arr.length, 0) : 0;
            return (
              <button
                key={v}
                onClick={() => setSelectedVenue(isActive ? null : v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                  padding: '0.4rem 0.875rem', borderRadius: '999px', fontSize: '0.8125rem', fontWeight: 500,
                  border: `1.5px solid ${isActive ? vc.accent : 'var(--border)'}`,
                  background: isActive ? vc.bg : 'var(--bg-card)',
                  color: isActive ? vc.text : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? vc.dot : '#d1d1d1' }} />
                {v}
                <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Today's screenings highlight */}
      {todayFilms.length > 0 && !selectedVenue && (
        <div style={{
          marginBottom: '2rem', padding: '1.25rem', borderRadius: '0.75rem',
          background: 'linear-gradient(135deg, #fffbf5 0%, #fef3ec 100%)',
          border: '1px solid #fde8d8',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
          }}>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#e07a5f',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              ● Playing Today
            </span>
            <span style={{ fontSize: '0.75rem', color: '#c4956e' }}>
              {format(today, 'EEEE, MMMM d')}
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '0.5rem',
          }}>
            {todayFilms.map(film => {
              const vc = getVenueColor(film.venue);
              return (
                <a
                  key={film.id}
                  href={film.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', flexDirection: 'column' as const,
                    padding: '0.625rem 0.875rem',
                    borderRadius: '0.5rem', fontSize: '0.8125rem',
                    textDecoration: 'none', color: 'var(--text-primary)',
                    background: 'var(--bg-card)', border: `1px solid ${vc.border}`,
                    borderLeft: `3px solid ${vc.accent}`,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = vc.bg;
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title={film.title}
                >
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {film.title}
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: vc.text, marginTop: '0.25rem', fontWeight: 500 }}>
                    {film.venue}
                    {film.time && film.time !== 'TBA' && ` · ${film.time}`}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Venue sections */}
      {activeVenues.map(venue => {
        const venueDates = grouped[venue];
        if (!venueDates) return null;
        const sortedDates = Object.keys(venueDates).sort();
        const vc = getVenueColor(venue);
        const venueTotal = Object.values(venueDates).reduce((n, arr) => n + arr.length, 0);

        // "Now Playing" — unique films currently in this venue's lineup
        // A film is "now playing" if it has any screening today or in the future
        const nowPlayingMap = new Map<string, Event>();
        for (const evts of Object.values(venueDates)) {
          for (const ev of evts) {
            const key = ev.title.toLowerCase().trim().replace(/[\u2018\u2019\u201C\u201D]/g, "'");
            if (nowPlayingMap.has(key)) continue;
            // Include if the film has any non-past date
            if (ev.date && isEventFuture(ev.date, today)) {
              nowPlayingMap.set(key, ev);
            }
          }
        }
        const nowPlaying = Array.from(nowPlayingMap.values()).sort((a, b) => a.title.localeCompare(b.title));

        return (
          <div key={venue} style={{ marginBottom: '2.5rem' }}>
            {/* Venue header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              marginBottom: '1.25rem', paddingBottom: '0.75rem',
              borderBottom: `2px solid ${vc.border}`,
            }}>
              <span style={{
                width: '10px', height: '10px', borderRadius: '50%', background: vc.accent,
              }} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                {venue}
              </h3>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                {venueTotal} screening{venueTotal !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Now Playing */}
            {nowPlaying.length > 0 && (
              <div style={{
                marginBottom: '1.25rem', padding: '1rem', borderRadius: '0.625rem',
                background: vc.bg, border: `1px solid ${vc.border}`,
              }}>
                <div style={{
                  fontSize: '0.6875rem', fontWeight: 700, color: vc.accent,
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.625rem',
                }}>
                  ▶ Now Playing · {nowPlaying.length} film{nowPlaying.length !== 1 ? 's' : ''}
                </div>
                <NowPlayingGrid films={nowPlaying} vc={vc} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '1rem' }}>
              {sortedDates.map(date => {
                const films = venueDates[date];
                const isPast = date < todayStr;
                const isToday = date === todayStr;

                return (
                  <div key={date}>
                    <div style={{
                      fontSize: '0.75rem', fontWeight: 600,
                      color: isToday ? '#e07a5f' : isPast ? '#b8b5c4' : '#8888a0',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      marginBottom: '0.5rem',
                      display: 'flex', alignItems: 'center', gap: '0.375rem',
                    }}>
                      {isToday && <span style={{
                        width: '6px', height: '6px', borderRadius: '50%', background: '#e07a5f',
                      }} />}
                      {isToday ? 'Today' : format(toDate(date), 'EEE, MMM d')}
                      {isPast && (
                        <span style={{
                          fontSize: '0.625rem', fontWeight: 600, color: '#a09bb2',
                          background: '#f0eef4', padding: '0.1rem 0.4rem',
                          borderRadius: '999px', letterSpacing: '0.05em',
                        }}>
                          PAST
                        </span>
                      )}
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: '0.375rem',
                    }}>
                      {films.sort((a, b) => a.title.localeCompare(b.title)).map(film => (
                        <a
                          key={film.id}
                          href={film.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block', padding: '0.5rem 0.75rem',
                            borderRadius: '0.5rem', fontSize: '0.8125rem',
                            textDecoration: 'none',
                            color: isPast ? 'var(--text-muted)' : 'var(--text-primary)',
                            background: isPast ? 'var(--bg)' : 'var(--bg-card)',
                            border: `1px solid ${isPast ? 'var(--border)' : vc.border}`,
                            borderLeft: `3px solid ${isPast ? 'var(--border)' : vc.accent}`,
                            transition: 'all 0.15s ease',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            e.currentTarget.style.background = isPast ? 'var(--border-light)' : vc.bg;
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                          }}
                          onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            e.currentTarget.style.background = isPast ? 'var(--bg)' : 'var(--bg-card)';
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          title={film.title}
                        >
                          <span style={{ fontWeight: 600 }}>{film.title}</span>
                          {film.time && film.time !== 'TBA' && (
                            <span style={{ color: '#8888a0', marginLeft: '0.5rem', fontSize: '0.75rem' }}>{film.time}</span>
                          )}
                          {isDateRange(film.date || '') && (
                            <span style={{ color: vc.text, marginLeft: '0.5rem', fontSize: '0.6875rem', fontWeight: 500 }}>
                              {getDateLabel(film.date || '')}
                            </span>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filteredByMonth.length === 0 && (
        <EmptyState icon={'\uD83C\uDFAC'} title="No showtimes this month" subtitle={`Check back for ${format(addMonths(currentMonth, 1), 'MMMM')}`} />
      )}
    </div>
  );
}

// --- On View Tab ---

const ON_VIEW_VENUE_COLORS: Record<string, { accent: string; bg: string; text: string; border: string; dot: string }> = {
  'the metropolitan museum of art': { accent: '#b91c1c', bg: '#fef2f2', text: '#991b1b', border: '#fecaca', dot: '#ef4444' },
  'the met':                        { accent: '#b91c1c', bg: '#fef2f2', text: '#991b1b', border: '#fecaca', dot: '#ef4444' },
  'whitney museum of american art':  { accent: '#0369a1', bg: '#f0f9ff', text: '#075985', border: '#bae6fd', dot: '#0ea5e9' },
  'whitney museum':                  { accent: '#0369a1', bg: '#f0f9ff', text: '#075985', border: '#bae6fd', dot: '#0ea5e9' },
  'solomon r. guggenheim museum':    { accent: '#c2410c', bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', dot: '#f97316' },
  'guggenheim':                      { accent: '#c2410c', bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', dot: '#f97316' },
  'the museum of modern art':        { accent: '#1d4ed8', bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe', dot: '#3b82f6' },
  'moma':                            { accent: '#1d4ed8', bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe', dot: '#3b82f6' },
  'new museum':                      { accent: '#7c3aed', bg: '#f5f3ff', text: '#6d28d9', border: '#c4b5fd', dot: '#8b5cf6' },
  'neue galerie':                    { accent: '#a16207', bg: '#fefce8', text: '#854d0e', border: '#fde68a', dot: '#eab308' },
  'the frick collection':            { accent: '#166534', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  'the frick':                       { accent: '#166534', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
  'bam':                             { accent: '#9d174d', bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8', dot: '#ec4899' },
  'brooklyn academy of music':       { accent: '#9d174d', bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8', dot: '#ec4899' },
  'carnegie hall':                   { accent: '#b45309', bg: '#fffbeb', text: '#92400e', border: '#fde68a', dot: '#f59e0b' },
  '92ny':                            { accent: '#0d9488', bg: '#f0fdfa', text: '#115e59', border: '#99f6e4', dot: '#14b8a6' },
  '92nd street y':                   { accent: '#0d9488', bg: '#f0fdfa', text: '#115e59', border: '#99f6e4', dot: '#14b8a6' },
  'lincoln center':                  { accent: '#4338ca', bg: '#eef2ff', text: '#3730a3', border: '#c7d2fe', dot: '#6366f1' },
  'the morgan library & museum':     { accent: '#78350f', bg: '#fffbeb', text: '#92400e', border: '#fde68a', dot: '#d97706' },
  'the jewish museum':               { accent: '#1e3a5f', bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe', dot: '#3b82f6' },
  'museum of arts and design':       { accent: '#be185d', bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8', dot: '#ec4899' },
  'cooper hewitt':                   { accent: '#059669', bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', dot: '#10b981' },
  'met opera':                       { accent: '#b91c1c', bg: '#fef2f2', text: '#991b1b', border: '#fecaca', dot: '#ef4444' },
  'metropolitan opera':              { accent: '#b91c1c', bg: '#fef2f2', text: '#991b1b', border: '#fecaca', dot: '#ef4444' },
  'american ballet theatre':         { accent: '#be185d', bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8', dot: '#ec4899' },
  'abt':                             { accent: '#be185d', bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8', dot: '#ec4899' },
};
const DEFAULT_ON_VIEW_COLOR = { accent: '#6b7280', bg: '#f9fafb', text: '#374151', border: '#d1d5db', dot: '#9ca3af' };

function getOnViewVenueColor(venue: string) {
  return ON_VIEW_VENUE_COLORS[venue.toLowerCase()] || DEFAULT_ON_VIEW_COLOR;
}

function getOnViewDateLabel(event: Event): string {
  if (!event.date) return 'Ongoing';
  if (isDateRange(event.date)) {
    const range = parseDateRange(event.date);
    if (!range) return event.date;
    const startStr = format(range.start, 'MMM d');
    const endMonth = range.end.getMonth();
    const startMonth = range.start.getMonth();
    const endStr = startMonth === endMonth ? format(range.end, 'd') : format(range.end, 'MMM d');
    return `${startStr} – ${endStr}`;
  }
  return format(toDate(event.date), 'MMM d');
}

function OnViewTab({ events, today }: { events: Event[]; today: Date }) {
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);

  const venues = Array.from(new Set(events.map(e => e.venue))).sort();

  // Group events by venue
  const grouped: Record<string, Event[]> = {};
  for (const e of events) {
    if (!grouped[e.venue]) grouped[e.venue] = [];
    grouped[e.venue].push(e);
  }

  // Sort events within each venue: ones with dates first (by start date), then ongoing
  for (const v of Object.keys(grouped)) {
    grouped[v].sort((a, b) => {
      if (!a.date && !b.date) return a.title.localeCompare(b.title);
      if (!a.date) return 1;
      if (!b.date) return -1;
      const aStart = isDateRange(a.date) ? (parseDateRange(a.date)?.start || toDate(a.date)) : toDate(a.date);
      const bStart = isDateRange(b.date) ? (parseDateRange(b.date)?.start || toDate(b.date)) : toDate(b.date);
      return aStart.getTime() - bStart.getTime();
    });
  }

  const activeVenues = selectedVenue ? [selectedVenue] : venues;

  return (
    <div>
      {/* Venue filter pills */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
          {venues.map(v => {
            const vc = getOnViewVenueColor(v);
            const isActive = selectedVenue === v;
            const count = grouped[v]?.length || 0;
            return (
              <button
                key={v}
                onClick={() => setSelectedVenue(isActive ? null : v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                  padding: '0.4rem 0.875rem', borderRadius: '999px', fontSize: '0.8125rem', fontWeight: 500,
                  border: `1.5px solid ${isActive ? vc.accent : 'var(--border)'}`,
                  background: isActive ? vc.bg : 'var(--bg-card)',
                  color: isActive ? vc.text : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? vc.dot : '#d1d1d1' }} />
                {v}
                <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Venue sections */}
      {activeVenues.map(venue => {
        const venueEvents = grouped[venue];
        if (!venueEvents || venueEvents.length === 0) return null;
        const vc = getOnViewVenueColor(venue);

        return (
          <div key={venue} style={{ marginBottom: '2.5rem' }}>
            {/* Venue header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              marginBottom: '1.25rem', paddingBottom: '0.75rem',
              borderBottom: `2px solid ${vc.border}`,
            }}>
              <span style={{
                width: '10px', height: '10px', borderRadius: '50%', background: vc.accent,
              }} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                {venue}
              </h3>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                {venueEvents.length} exhibition{venueEvents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Exhibition list */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
              {venueEvents.map(event => (
                <a
                  key={event.id}
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '1rem', padding: '0.75rem 1rem',
                    borderRadius: '0.5rem', textDecoration: 'none', color: 'var(--text-primary)',
                    background: 'var(--bg-card)', border: `1px solid ${vc.border}`,
                    borderLeft: `3px solid ${vc.accent}`,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = vc.bg;
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{event.title}</div>
                    <div style={{ marginTop: '0.25rem' }}>
                      <CategoryTag category={event.category} />
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 500, color: vc.text,
                    background: vc.bg, padding: '0.25rem 0.625rem',
                    borderRadius: '999px', whiteSpace: 'nowrap',
                    border: `1px solid ${vc.border}`,
                  }}>
                    {getOnViewDateLabel(event)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        );
      })}

      {events.length === 0 && (
        <EmptyState icon={'\uD83D\uDDBC\uFE0F'} title="No ongoing exhibitions" subtitle="Check back later for new exhibitions" />
      )}
    </div>
  );
}

// --- Ongoing / No-date events section ---

function OngoingEvents({ events }: { events: Event[] }) {
  const [showOngoing, setShowOngoing] = useState(false);
  const noDate = events.filter(e => !e.date);

  if (noDate.length === 0) return null;

  return (
    <div style={{
      marginTop: '1.5rem', background: 'var(--bg-card)', borderRadius: '0.75rem',
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setShowOngoing(prev => !prev)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', background: 'var(--border-light)', border: 'none',
          cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)',
        }}
      >
        <span>📌 Ongoing / Date TBD ({noDate.length})</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {showOngoing ? '▲ Hide' : '▼ Show'}
        </span>
      </button>
      {showOngoing && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
          {noDate.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
