'use client';

import { useState, useEffect } from 'react';
import { Event, Category, EventsData } from '@/lib/types';
import type { RawEvent } from '@/lib/types';
import { format, isBefore, startOfDay, addDays } from 'date-fns';

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

function isEventFuture(eventDate: string, today: Date): boolean {
  if (isDateRange(eventDate)) {
    const range = parseDateRange(eventDate);
    if (!range) return false;
    return !isBefore(range.end, today);
  }
  return !isBefore(toDate(eventDate), today);
}

// --- Category config ---

const categoryConfig: { key: Category; label: string; bg: string; text: string; dot: string }[] = [
  { key: 'Film', label: 'Film', bg: '#fde8e8', text: '#b91c1c', dot: '#ef4444' },
  { key: 'Art', label: 'Art & Museums', bg: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' },
  { key: 'Classical Music', label: 'Classical', bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
  { key: 'Ballet', label: 'Ballet', bg: '#fce7f3', text: '#be185d', dot: '#ec4899' },
  { key: 'Opera', label: 'Opera', bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  { key: 'Dance', label: 'Dance', bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  { key: 'Jazz', label: 'Jazz', bg: '#e0e7ff', text: '#3730a3', dot: '#6366f1' },
  { key: 'Theater', label: 'Theater', bg: '#fef3c7', text: '#78350f', dot: '#d97706' },
  { key: 'Comedy', label: 'Comedy', bg: '#fef9c3', text: '#713f12', dot: '#facc15' },
  { key: 'Music/Performing Arts', label: 'Performing Arts', bg: '#fce7f3', text: '#9d174d', dot: '#f472b6' },
  { key: 'Family', label: 'Family', bg: '#fce7f3', text: '#9d174d', dot: '#f472b6' },
  { key: 'Talk', label: 'Talks', bg: '#f3e8ff', text: '#7e22ce', dot: '#a855f7' },
  { key: 'Food/Drink', label: 'Food & Drink', bg: '#ffedd5', text: '#c2410c', dot: '#f97316' },
  { key: 'Shopping/Markets', label: 'Markets', bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
  { key: 'Cars & Coffee', label: 'Cars & Coffee', bg: '#cffafe', text: '#155e75', dot: '#06b6d4' },
  { key: 'Chinatown/Flushing/LIC', label: 'Chinatown/Flushing', bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  { key: 'Outdoor/Parks', label: 'Outdoor', bg: '#d1fae5', text: '#14532d', dot: '#22c55e' },
  { key: 'Other', label: 'Other', bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af' },
];

/** Map messy scraped category names → canonical Category keys */
const categoryAliases: Record<string, Category> = {
  'art': 'Art',
  'arts': 'Art',
  'museums/art': 'Art',
  'museum exhibition': 'Art',
  'museum': 'Art',
  'exhibition': 'Art',
  'gallery': 'Art',
  'classical': 'Classical Music',
  'classical music': 'Classical Music',
  'orchestra': 'Classical Music',
  'symphony': 'Classical Music',
  'chamber music': 'Classical Music',
  'ballet': 'Ballet',
  'opera': 'Opera',
  'dance': 'Dance',
  'comedy': 'Comedy',
  'standup': 'Comedy',
  'stand-up': 'Comedy',
  'improv': 'Comedy',
  'jazz': 'Jazz',
  'theater': 'Theater',
  'theatre': 'Theater',
  'musical': 'Theater',
  'broadway': 'Theater',
  'off-broadway': 'Theater',
  'music': 'Music/Performing Arts',
  'concert': 'Music/Performing Arts',
  'concerts': 'Music/Performing Arts',
  'live music': 'Music/Performing Arts',
  'performing arts': 'Music/Performing Arts',
  'outdoor': 'Outdoor/Parks',
  'parks': 'Outdoor/Parks',
  'fitness': 'Outdoor/Parks',
  'workshop': 'Talk',
  'lecture': 'Talk',
  'reading': 'Talk',
  'storytelling': 'Talk',
  'general': 'Other',
  'attraction': 'Other',
  'circus': 'Other',
  'sports': 'Other',
  'party': 'Other',
  'gallery experience': 'Art',
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

// --- Main component ---

export default function Home() {
  const [eventsData, setEventsData] = useState<EventsData>({ weekOf: '', events: [] });
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [viewMode, setViewMode] = useState<'category' | 'calendar'>('category');
  const [loading, setLoading] = useState(true);
  const [today] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    Promise.all([
      fetch('/data/events.json').then(r => r.json()).catch(() => []),
      fetch('/data/film_museum_events.json').then(r => r.json()).catch(() => [])
    ]).then(([raw1, raw2]) => {
      // Support both formats: raw array or { weekOf, events }
      const arr1: RawEvent[] = Array.isArray(raw1) ? raw1 : (raw1.events || []);
      const arr2: RawEvent[] = Array.isArray(raw2) ? raw2 : (raw2.events || []);
      // Dynamic week: derive Monday of the current week from today
      const now = new Date();
      const dow = now.getDay(); // 0=Sun
      const diffToMon = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMon);
      const defaultWeekOf = toStr(monday);
      const weekOf = (!Array.isArray(raw1) && raw1.weekOf) || (!Array.isArray(raw2) && raw2.weekOf) || defaultWeekOf;

      const allRaw = [...arr1, ...arr2];
      // Dedupe by title+venue+date
      const seen = new Set<string>();
      const unique = allRaw.filter(e => {
        const title = e.title || e.name || '';
        const venue = e.venue || e.location || '';
        const key = `${title}|${venue}|${e.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Map raw → Event (handle field name variants from different scrapers)
      const processed: Event[] = unique
        .map((e, i) => ({
          id: e.id || `evt-${i}`,
          title: (e.title || e.name || '').trim(),
          venue: (e.venue || e.location || '').trim(),
          date: e.date,
          category: normalizeCategory(e.category || e.type || 'Other'),
          sourceUrl: (e.sourceUrl || e.url || e.link || '').trim(),
          ...(e.time ? { time: e.time } : {}),
          ...(e.description ? { description: e.description } : {}),
          ...(e.price ? { price: e.price } : {}),
        }))
        .filter(e => isEventFuture(e.date, today));

      setEventsData({ weekOf, events: processed });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [today]);

  const presentCategories = Array.from(new Set(eventsData.events.map(e => e.category)));
  const visibleCategoryConfig = categoryConfig.filter(c => presentCategories.includes(c.key));
  const deduped = visibleCategoryConfig.filter((c, i, arr) =>
    arr.findIndex(x => x.label === c.label) === i
  );

  const filteredEvents = selectedCategories.length > 0
    ? eventsData.events.filter(e => selectedCategories.includes(e.category))
    : eventsData.events;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf7f2', color: '#4a4a68' }}>
        <p style={{ fontSize: '1.1rem' }}>Loading events...</p>
      </div>
    );
  }

  const weekStart = toDate(eventsData.weekOf || '2026-03-09');
  const weekLabel = eventsData.weekOf
    ? format(weekStart, 'MMM d') + ' – ' + format(addDays(weekStart, 6), 'MMM d, yyyy')
    : '';

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1.5rem', maxWidth: '72rem', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a2e' }}>
            Next Week NYC
          </h1>
          {weekLabel && (
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#e07a5f', background: '#fde8e8', padding: '0.25rem 0.75rem', borderRadius: '999px' }}>
              {weekLabel}
            </span>
          )}
        </div>
        <p style={{ color: '#8888a0', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} this week
        </p>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                  border: isActive ? `1.5px solid ${dot}` : '1.5px solid #e8e4de',
                  background: isActive ? bg : '#fff', color: isActive ? text : '#8888a0',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive ? dot : '#d1d1d1' }} />
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', background: '#f0ece6', borderRadius: '0.5rem', padding: '3px' }}>
          {(['category', 'calendar'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '0.4rem 1rem', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: viewMode === mode ? '#fff' : 'transparent',
                color: viewMode === mode ? '#1a1a2e' : '#8888a0',
                boxShadow: viewMode === mode ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {mode === 'category' ? '📂 Category' : '📅 Calendar'}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'category' ? (
        <EventList events={filteredEvents} />
      ) : (
        <CalendarView events={filteredEvents} weekOf={eventsData.weekOf} />
      )}
    </main>
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

function DateBadge({ date }: { date: string }) {
  if (!isDateRange(date)) return null;
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
        display: 'block', padding: '1rem 1.25rem', background: '#fff',
        borderRadius: '0.75rem', border: '1px solid #e8e4de',
        textDecoration: 'none', color: 'inherit', transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#d1ccc4';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#e8e4de';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
            <CategoryTag category={event.category} />
            {showDate && <DateBadge date={event.date} />}
            {event.time && event.time !== 'TBA' && (
              <span style={{ fontSize: '0.75rem', color: '#8888a0' }}>{event.time}</span>
            )}
          </div>
          <h4 style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#1a1a2e', marginBottom: '0.25rem' }}>
            {event.title}
          </h4>
          <p style={{ fontSize: '0.8125rem', color: '#4a4a68', margin: 0 }}>{event.venue}</p>
        </div>
        {event.price && event.price !== 'TBA' && (
          <span style={{
            fontSize: '0.75rem', fontWeight: 600, color: '#4a4a68',
            background: '#f5f2ed', padding: '0.25rem 0.625rem',
            borderRadius: '0.375rem', whiteSpace: 'nowrap',
          }}>
            {event.price}
          </span>
        )}
      </div>
      {event.description && (
        <p style={{
          fontSize: '0.8125rem', color: '#8888a0', marginTop: '0.5rem', lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {event.description}
        </p>
      )}
    </a>
  );
}

// --- Category (List) View ---

function EventList({ events }: { events: Event[] }) {
  const singleDay = events.filter(e => !isDateRange(e.date));
  const multiDay = events.filter(e => isDateRange(e.date));

  const grouped = singleDay.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = {};
    if (!acc[event.category][event.date]) acc[event.category][event.date] = [];
    acc[event.category][event.date].push(event);
    return acc;
  }, {} as Record<string, Record<string, Event[]>>);

  const multiGrouped = multiDay.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = [];
    acc[event.category].push(event);
    return acc;
  }, {} as Record<string, Event[]>);

  const allCategories = Array.from(new Set([...Object.keys(grouped), ...Object.keys(multiGrouped)])).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {allCategories.map(category => {
        const style = getCategoryStyle(category as Category);
        const singleEntries = grouped[category]
          ? Object.entries(grouped[category]).sort(([a], [b]) => a.localeCompare(b))
          : [];
        const multiEntries = multiGrouped[category] || [];
        const totalCount = singleEntries.reduce((n, [, evts]) => n + evts.length, 0) + multiEntries.length;

        return (
          <section key={category}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '2px solid #f0ece6',
            }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: style.dot }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
                {style.label}
              </h2>
              <span style={{ fontSize: '0.8125rem', color: '#8888a0', fontWeight: 400 }}>
                ({totalCount})
              </span>
            </div>

            {multiEntries.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: '#3730a3',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}>
                  <span style={{ fontSize: '0.875rem' }}>🗓</span> Multiple Days
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {multiEntries.map(event => (
                    <EventCard key={event.id} event={event} showDate />
                  ))}
                </div>
              </div>
            )}

            {singleEntries.map(([date, dayEvents]) => (
              <div key={date} style={{ marginBottom: '1.25rem' }}>
                <h3 style={{
                  fontSize: '0.8125rem', fontWeight: 600, color: '#8888a0',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem',
                }}>
                  {format(toDate(date), 'EEEE, MMMM d')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
        <p style={{ textAlign: 'center', color: '#8888a0', padding: '3rem 0', fontSize: '1rem' }}>
          No upcoming events found.
        </p>
      )}
    </div>
  );
}

// --- Calendar View ---

function CalendarView({ events, weekOf }: { events: Event[]; weekOf: string }) {
  const [showAllWeek, setShowAllWeek] = useState(true);
  // Dynamic fallback: Monday of the current week
  const now = new Date();
  const dow = now.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const fallbackMon = new Date(now);
  fallbackMon.setDate(now.getDate() + diffToMon);
  const weekStart = toDate(weekOf || toStr(fallbackMon));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayStr = toStr(new Date());

  const multiDayEvents = events.filter(e => isDateRange(e.date));
  const singleDayEvents = events.filter(e => !isDateRange(e.date));

  const multiByCategory = multiDayEvents.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = [];
    acc[e.category].push(e);
    return acc;
  }, {} as Record<string, Event[]>);

  return (
    <div>
      {multiDayEvents.length > 0 && (
        <div style={{
          marginBottom: '1rem', background: '#fff', borderRadius: '0.75rem',
          border: '1px solid #e0e7ff', overflow: 'hidden',
        }}>
          <button
            onClick={() => setShowAllWeek(prev => !prev)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1rem', background: '#eef2ff', border: 'none',
              cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: '#3730a3',
            }}
          >
            <span>🗓 Playing all week ({multiDayEvents.length})</span>
            <span style={{ fontSize: '0.75rem', color: '#6366f1' }}>
              {showAllWeek ? '▲ Hide' : '▼ Show'}
            </span>
          </button>
          {showAllWeek && (
            <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {Object.entries(multiByCategory).map(([cat, catEvents]) => {
                const catStyle = getCategoryStyle(cat as Category);
                return (
                  <div key={cat}>
                    <div style={{
                      fontSize: '0.6875rem', fontWeight: 700, color: catStyle.text,
                      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem',
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                    }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: catStyle.dot }} />
                      {catStyle.label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.375rem' }}>
                      {catEvents.map(event => (
                        <a
                          key={event.id}
                          href={event.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block', padding: '0.375rem 0.625rem',
                            borderRadius: '0.375rem', fontSize: '0.75rem',
                            textDecoration: 'none', color: '#1a1a2e',
                            background: catStyle.bg, borderLeft: `3px solid ${catStyle.dot}`,
                            transition: 'opacity 0.15s ease',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                          title={`${event.title} — ${event.venue}`}
                        >
                          <span style={{ fontWeight: 600 }}>{event.title}</span>
                          <span style={{ color: '#8888a0', marginLeft: '0.375rem', fontSize: '0.6875rem' }}>{event.venue}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.5rem' }}>
        {days.map(day => {
          const dayStr = toStr(day);
          const dayEvents = singleDayEvents.filter(e => e.date === dayStr);
          const isToday = dayStr === todayStr;
          const byCategory = dayEvents.reduce((acc, e) => {
            if (!acc[e.category]) acc[e.category] = [];
            acc[e.category].push(e);
            return acc;
          }, {} as Record<string, Event[]>);

          return (
            <div
              key={dayStr}
              style={{
                minHeight: '200px', background: isToday ? '#fef9f3' : '#fff',
                borderRadius: '0.75rem', padding: '0.75rem',
                border: isToday ? '2px solid #e07a5f' : '1px solid #e8e4de',
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: '0.625rem', paddingBottom: '0.5rem', borderBottom: '1px solid #f0ece6' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#8888a0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {format(day, 'EEE')}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: isToday ? '#e07a5f' : '#1a1a2e', lineHeight: 1.2 }}>
                  {format(day, 'd')}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {Object.entries(byCategory).map(([cat, catEvents]) => {
                  const catStyle = getCategoryStyle(cat as Category);
                  return (
                    <div key={cat}>
                      {catEvents.map(event => (
                        <a
                          key={event.id}
                          href={event.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block', padding: '0.375rem 0.5rem',
                            borderRadius: '0.375rem', fontSize: '0.6875rem',
                            textDecoration: 'none', color: 'inherit',
                            background: catStyle.bg, borderLeft: `3px solid ${catStyle.dot}`,
                            marginBottom: '0.25rem', transition: 'opacity 0.15s ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                        >
                          <div style={{ fontWeight: 600, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {event.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.125rem' }}>
                            <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: catStyle.text, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                              {catStyle.label}
                            </span>
                            {event.time && event.time !== 'TBA' && (
                              <>
                                <span style={{ color: '#d1d1d1' }}>·</span>
                                <span style={{ color: '#8888a0' }}>{event.time}</span>
                              </>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                  );
                })}
                {dayEvents.length === 0 && (
                  <p style={{ fontSize: '0.75rem', color: '#c4c0b8', textAlign: 'center', margin: '1rem 0' }}>No events</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns: repeat(7"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
