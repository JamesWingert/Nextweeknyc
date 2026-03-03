import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next Week NYC \u2014 What\u2019s On in the City',
  description: 'Film, art, music, theater & more \u2014 your curated guide to what\u2019s happening in NYC this week.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon-180x180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Next Week NYC',
    description: 'Curated film, art, music, theater & more for the city',
    siteName: 'Next Week NYC',
    type: 'website',
    url: 'https://nextweeknyc.vercel.app',
  },
  other: {
    'theme-color': '#faf7f2',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ minHeight: '100vh' }}>{children}</body>
    </html>
  );
}
