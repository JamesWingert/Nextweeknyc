/** Raw shape from the scraped JSON files (arrays in public/data/) */
export interface RawEvent {
  title: string;
  venue: string;
  date: string;       // "YYYY-MM-DD" or "YYYY-MM-DD to YYYY-MM-DD"
  category: string;
  url: string;
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
  | 'Music/Performing Arts'
  | 'Family'
  | 'Talk'
  | 'Food/Drink'
  | 'Shopping/Markets'
  | 'Cars & Coffee'
  | 'Chinatown/Flushing/LIC'
  | 'Other';

export interface EventsData {
  weekOf: string;
  events: Event[];
}
