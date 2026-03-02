export interface Event {
  id: string;
  title: string;
  venue: string;
  date: string;
  time?: string;
  category: Category;
  sourceUrl: string;
  description?: string;
  price?: string;
}

export type Category =
  | 'Film'
  | 'Museums/Art'
  | 'Museum Exhibition'
  | 'Music/Performing Arts'
  | 'Classical Music'
  | 'Ballet'
  | 'Opera'
  | 'Dance'
  | 'Jazz'
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
