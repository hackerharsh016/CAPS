import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '../features/auth/auth-context';
import { Navbar } from '../components/layout/Navbar';

export const metadata: Metadata = {
  title: 'CAPS — Cloud Automated Printing Solution',
  description:
    'Upload documents, configure print settings, pay online, and skip the xerox shop queue.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col">
        <AuthProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
