'use client';

import { useState, useEffect } from 'react';
import { Event, Category, EventsData } from '@/lib/types';
import { format, parseISO, isBefore, startOfDay, addDays } from 'date-fns';

const categoryConfig: { key: Category; label: string; bg: string; text: string; dot: string }[] = [
  { key: 'Film', label: 'Film', bg: '#fde8e8', text: '#b91c1c', dot: '#ef4444' },
  { key: 'Museum Exhibition', label: 'Museums', bg: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' },
  { key: 'Museums/Art', label: 'Art', bg: '#ede9fe', text: '#6d28d9', dot: '#a78bfa' },
  { key: 'Classical Music', label: 'Classical', bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
  { key: 'Ballet', label: 'Ballet', bg: '#fce7f3', text: '#be185d', dot: '#ec4899' },
  { key: 'Opera', label: 'Opera', bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  { key: 'Dance', label: 'Dance', bg: '#d1fae5', text: '#065f46', dot: '#10b981' },
  { key: 'Jazz', label: 'Jazz', bg: '#e0e7ff', text: '#3730a3', dot: '#6366f1' },
  { key: 'Music/Performing Arts', label: 'Performing Arts', bg: '#fce7f3', text: '#9d174d', dot: '#f472b6' },
  { key: 'Talk', label: 'Talks', bg: '#f3e8ff', text: '#7e22ce', dot: '#a855f7' },
  { key: 'Food/Drink', label: 'Food & Drink', bg: '#ffedd5', text: '#c2410c', dot: '#f97316' },
  { key: 'Shopping/Markets', label: 'Markets', bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
  { key: 'Cars & Coffee', label: 'Cars & Coffee', bg: '#cffafe', text: '#155e75', dot: '#06b6d4' },
  { key: 'Chinatown/Flushing/LIC', label: 'Chinatown/Flushing', bg: '#fef9c3', text: '#854d0e', dot: '#eab308' },
  { key: 'Other', label: 'Other', bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af' },
];

function getCategoryStyle(category: Category) {
  return categoryConfig.find(c => c.key === category) || categoryConfig[categoryConfig.length - 1];
}

export default function Home() {
  const [eventsData, setEventsData] = useState<EventsData>({ weekOf: '', events: [] });
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [viewMode, setViewMode] = useState<'category' | 'calendar'>('category');
  const [loading, setLoading] = useState(true);
  const [today] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    Promise.all([
      fetch('/data/events.json').then(r => r.json()).catch(() => ({ weekOf: '', events: [] })),
      fetch('/data/film_museum_events.json').then(r => r.json()).catch(() => ({ weekOf: '', events: [] }))
    ]).then(([generalData, filmData]) => {
      const allEvents = [...generalData.events, ...filmData.events];
      const uniqueEvents = allEvents.filter((event: Event, index: number, self: Event[]) =>
        index === self.findIndex(e => e.id === event.id)
      );
      const futureEvents = uniqueEvents.filter((e: Event) => !isBefore(parseISO(e.date), today));
      setEventsData({
        weekOf: generalData.weekOf || filmData.weekOf || '2026-03-09',
        events: futureEvents
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [today]);

  const toggleCategory = (category: Category) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const presentCategories = Array.from(new Set(eventsData.events.map(e => e.category)));
  const visibleCategoryConfig = categoryConfig.filter(c => presentCategories.includes(c.key));

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

  const weekLabel = eventsData.weekOf
    ? format(parseISO(eventsData.weekOf), 'MMM d') + ' – ' + format(addDays(parseISO(eventsData.weekOf), 6), 'MMM d, yyyy')
    : '';

  return (
    <main style={{ minHeight: '100vh', padding: '2rem 1.5rem', maxWidth: '72rem', margin: '0 auto' }}>
      {/* Header */}
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a2e' }}>
            Next Week NYC
          </h1>
          {weekLabel && (
            <span style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#e07a5f',
              background: '#fde8e8',
              padding: '0.25rem 0.75rem',
              borderRadius: '999px',
            }}>
              {weekLabel}
            </span>
          )}
        </div>
        <p style={{ color: '#8888a0', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''} this week
        </p>
      </header>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {visibleCategoryConfig.map(({ key, label, bg, text, dot }) => {
            const isActive = selectedCategories.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleCategory(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.375rem 0.75rem',
                  borderRadius: '999px',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  border: isActive ? `1.5px solid ${dot}` : '1.5px solid #e8e4de',
                  background: isActive ? bg : '#fff',
                  color: isActive ? text : '#8888a0',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: isActive ? dot : '#d1d1d1',
                }} />
                {label}
              </button>
            );
          })}
        </div>

        <div style={{
          display: 'flex',
          background: '#f0ece6',
          borderRadius: '0.5rem',
          padding: '3px',
        }}>
          {(['category', 'calendar'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '0.4rem 1rem',
                borderRadius: '0.375rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
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

function CategoryTag({ category }: { category: Category }) {
  const style = getCategoryStyle(category);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      fontSize: '0.6875rem',
      fontWeight: 600,
      padding: '0.2rem 0.5rem',
      borderRadius: '999px',
      background: style.bg,
      color: style.text,
      letterSpacing: '0.01em',
      textTransform: 'uppercase',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: style.dot }} />
      {style.label}
    </span>
  );
}

function EventCard({ event }: { event: Event }) {
  return (
    <a
      href={event.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block',
        padding: '1rem 1.25rem',
        background: '#fff',
        borderRadius: '0.75rem',
        border: '1px solid #e8e4de',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.15s ease',
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
            {event.time && (
              <span style={{ fontSize: '0.75rem', color: '#8888a0' }}>
                {event.time}
              </span>
            )}
          </div>
          <h4 style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#1a1a2e', marginBottom: '0.25rem' }}>
            {event.title}
          </h4>
          <p style={{ fontSize: '0.8125rem', color: '#4a4a68', margin: 0 }}>{event.venue}</p>
        </div>
        {event.price && (
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#4a4a68',
            background: '#f5f2ed',
            padding: '0.25rem 0.625rem',
            borderRadius: '0.375rem',
            whiteSpace: 'nowrap',
          }}>
            {event.price}
          </span>
        )}
      </div>
      {event.description && (
        <p style={{
          fontSize: '0.8125rem',
          color: '#8888a0',
          marginTop: '0.5rem',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {event.description}
        </p>
      )}
    </a>
  );
}

function EventList({ events }: { events: Event[] }) {
  const grouped = events.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = {};
    if (!acc[event.category][event.date]) acc[event.category][event.date] = [];
    acc[event.category][event.date].push(event);
    return acc;
  }, {} as Record<string, Record<string, Event[]>>);

  const sortedCategories = Object.keys(grouped).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {sortedCategories.map(category => {
        const style = getCategoryStyle(category as Category);
        return (
          <section key={category}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              marginBottom: '1.25rem',
              paddingBottom: '0.75rem',
              borderBottom: '2px solid #f0ece6',
            }}>
              <span style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: style.dot,
              }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
                {style.label}
              </h2>
              <span style={{ fontSize: '0.8125rem', color: '#8888a0', fontWeight: 400 }}>
                ({Object.values(grouped[category]).flat().length})
              </span>
            </div>

            {Object.entries(grouped[category])
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, dayEvents]) => (
                <div key={date} style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#8888a0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.75rem',
                  }}>
                    {format(parseISO(date), 'EEEE, MMMM d')}
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

function CalendarView({ events, weekOf }: { events: Event[]; weekOf: string }) {
  const weekStart = parseISO(weekOf);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: '0.5rem',
    }}>
      {days.map(day => {
        const dayStr = formatDate(day);
        const dayEvents = events.filter(e => e.date === dayStr);
        const isToday = dayStr === todayStr;

        // Group events by category for this day
        const byCategory = dayEvents.reduce((acc, e) => {
          if (!acc[e.category]) acc[e.category] = [];
          acc[e.category].push(e);
          return acc;
        }, {} as Record<string, Event[]>);

        return (
          <div
            key={dayStr}
            style={{
              minHeight: '200px',
              background: isToday ? '#fef9f3' : '#fff',
              borderRadius: '0.75rem',
              padding: '0.75rem',
              border: isToday ? '2px solid #e07a5f' : '1px solid #e8e4de',
            }}
          >
            <div style={{
              textAlign: 'center',
              marginBottom: '0.625rem',
              paddingBottom: '0.5rem',
              borderBottom: '1px solid #f0ece6',
            }}>
              <div style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#8888a0',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {format(day, 'EEE')}
              </div>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: isToday ? '#e07a5f' : '#1a1a2e',
                lineHeight: 1.2,
              }}>
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
                          display: 'block',
                          padding: '0.375rem 0.5rem',
                          borderRadius: '0.375rem',
                          fontSize: '0.6875rem',
                          textDecoration: 'none',
                          color: 'inherit',
                          background: catStyle.bg,
                          borderLeft: `3px solid ${catStyle.dot}`,
                          marginBottom: '0.25rem',
                          transition: 'opacity 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                      >
                        <div style={{
                          fontWeight: 600,
                          color: '#1a1a2e',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {event.title}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          marginTop: '0.125rem',
                        }}>
                          <span style={{
                            fontSize: '0.5625rem',
                            fontWeight: 700,
                            color: catStyle.text,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                          }}>
                            {catStyle.label}
                          </span>
                          {event.time && (
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
                <p style={{ fontSize: '0.75rem', color: '#c4c0b8', textAlign: 'center', margin: '1rem 0' }}>
                  No events
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Responsive fallback for mobile */}
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
