/** Raw shape from the scraped JSON files (arrays in public/data/).
 *  Scrapers may use different field names — the UI normalizes on load. */
export interface RawEvent {
  title?: string;
  name?: string;
  venue?: string;
  location?: string;
  date: string;           // "YYYY-MM-DD" or "YYYY-MM-DD to YYYY-MM-DD"
  category?: string;
  type?: string;
  url?: string;
  sourceUrl?: string;
  link?: string;
  id?: string;
  time?: string;
  description?: string;
  price?: string;
}

/** Normalised event used by the UI */
export interface Event {
  id: string;
  title: string;
  venue: string;
  date: string;
  category: Category;
  sourceUrl: string;
  time?: string;
  description?: string;
  price?: string;
}

export type Category =
  | 'Film'
  | 'Art'
  | 'Classical Music'
  | 'Ballet'
  | 'Opera'
  | 'Dance'
  | 'Jazz'
  | 'Theater'
  | 'Comedy'
  | 'Music/Performing Arts'
  | 'Family'
  | 'Talk'
  | 'Food/Drink'
  | 'Shopping/Markets'
  | 'Cars & Coffee'
  | 'Chinatown/Flushing/LIC'
  | 'Outdoor/Parks'
  | 'Other';

export interface EventsData {
  weekOf: string;
  events: Event[];
}
