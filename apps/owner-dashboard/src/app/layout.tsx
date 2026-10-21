import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '../components/AppProviders';
import { OwnerHeader } from '../components/OwnerHeader';

export const metadata: Metadata = {
  title: 'CAPS — Shop Owner Operations Dashboard',
  description:
    'Manage incoming print queues, 1-click execution, printer routing, and sales reports.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 antialiased">
        <AppProviders>
          <OwnerHeader />
          <main>{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
