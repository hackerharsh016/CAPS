import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CAPS — Cloud Automated Printing Solution',
  description:
    'Upload documents, configure print settings, pay online, and skip the xerox shop queue.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-3">
              <span className="rounded-lg bg-blue-600 px-3 py-1 font-mono text-sm font-bold text-white">
                CAPS
              </span>
              <span className="text-lg font-semibold text-slate-900">Customer Portal</span>
            </div>
            <nav className="flex items-center space-x-4 text-sm font-medium text-slate-600">
              <span className="text-blue-600">Find Shops</span>
              <span>My Orders</span>
              <span>Help</span>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
