import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Next Week NYC',
  description: 'Your weekly guide to NYC events',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
