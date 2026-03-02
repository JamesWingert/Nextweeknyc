'use client';

import { useState, useEffect } from 'react';
import { Event, Category, EventsData } from '@/lib/types';
import { format, parseISO } from 'date-fns';

const categories: { key: Category; label: string; color: string }[] = [
  { key: 'Film', label: 'Film', color: '#ef4444' },
  { key: 'Museums/Art', label: 'Museums & Art', color: '#8b5cf6' },
  { key: 'Music/Performing Arts', label: 'Music & Performing Arts', color: '#ec4899' },
  { key: 'Food/Drink', label: 'Food & Drink', color: '#f97316' },
  { key: 'Shopping/Markets', label: 'Shopping & Markets', color: '#22c55e' },
  { key: 'Cars & Coffee', label: 'Cars & Coffee', color: '#06b6d4' },
  { key: 'Chinatown/Flushing/LIC', label: 'Chinatown/Flushing/LIC', color: '#eab308' },
  { key: 'Other', label: 'Other', color: '#6b7280' },
];

export default function Home() {
  const [eventsData, setEventsData] = useState<EventsData>({ weekOf: '', events: [] });
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/events.json')
      .then(res => res.json())
      .then((data: EventsData) => {
        setEventsData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleCategory = (category: Category) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const filteredEvents = selectedCategories.length > 0
    ? eventsData.events.filter(e => selectedCategories.includes(e.category))
    : eventsData.events;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
        Loading events...
      </div>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto bg-neutral-950 text-white">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Next Week NYC</h1>
        {eventsData.weekOf && (
          <p className="text-neutral-400">
            Week of {format(parseISO(eventsData.weekOf), 'MMMM d, yyyy')}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {categories.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggleCategory(key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedCategories.includes(key) ? 'text-white' : 'text-neutral-400'
              }`}
              style={{
                backgroundColor: selectedCategories.includes(key) ? color : '#262626',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        
        <div className="flex bg-neutral-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              viewMode === 'list' ? 'bg-neutral-700 text-white' : 'text-neutral-400'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              viewMode === 'calendar' ? 'bg-neutral-700 text-white' : 'text-neutral-400'
            }`}
          >
            Calendar
          </button>
        </div>
      </div>

      <EventList events={filteredEvents} />
    </main>
  );
}

function EventList({ events }: { events: Event[] }) {
  // Group by category → date
  const grouped = events.reduce((acc, event) => {
    if (!acc[event.category]) acc[event.category] = {};
    if (!acc[event.category][event.date]) acc[event.category][event.date] = [];
    acc[event.category][event.date].push(event);
    return acc;
  }, {} as Record<Category, Record<string, Event[]>>);

  const sortedCategories = Object.keys(grouped).sort() as Category[];

  return (
    <div className="space-y-8">
      {sortedCategories.map(category => (
        <section key={category}>
          <h2 className="text-xl font-bold mb-4">{category}</h2>
          
          {Object.entries(grouped[category])
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, dayEvents]) => (
              <div key={date} className="mb-6">
                <h3 className="text-lg font-medium text-neutral-300 mb-3">
                  {format(parseISO(date), 'EEEE, MMMM d')}
                </h3>
                <div className="space-y-3">
                  {dayEvents.map(event => (
                    <a
                      key={event.id}
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 bg-neutral-900 rounded-lg hover:bg-neutral-800 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-blue-400">{event.title}</h4>
                          <p className="text-neutral-400">{event.venue}</p>
                          {event.time && <p className="text-sm text-neutral-500">{event.time}</p>}
                        </div>
                        {event.price && (
                          <span className="text-sm bg-neutral-800 px-2 py-1 rounded">{event.price}</span>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-sm text-neutral-500 mt-2">{event.description}</p>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
        </section>
      ))}
      
      {events.length === 0 && (
        <p className="text-neutral-500 text-center py-12">No events found.</p>
      )}
    </div>
  );
}
