import type { Metadata } from 'next';
import './globals.css';

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
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-3">
              <span className="rounded-lg bg-emerald-600 px-3 py-1 font-mono text-sm font-bold text-white">
                CAPS
              </span>
              <span className="text-lg font-semibold text-slate-900">Owner Portal</span>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                ● Shop Online
              </span>
            </div>
            <div className="flex items-center space-x-4 text-sm font-medium text-slate-600">
              <span className="text-emerald-700 font-semibold">Live Queue</span>
              <span>Printers</span>
              <span>Pricing</span>
              <span>Reports</span>
              <span>Settings</span>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
