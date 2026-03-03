import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next Week NYC \u2014 What\u2019s On in the City',
  description: 'Film, art, music, theater & more \u2014 your curated guide to what\u2019s happening in NYC this week.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ minHeight: '100vh' }}>{children}</body>
    </html>
  );
}
