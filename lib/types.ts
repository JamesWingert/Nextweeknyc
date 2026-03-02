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
  | 'Music/Performing Arts' 
  | 'Food/Drink' 
  | 'Shopping/Markets' 
  | 'Cars & Coffee' 
  | 'Chinatown/Flushing/LIC' 
  | 'Other';

export interface EventsData {
  weekOf: string;
  events: Event[];
}
