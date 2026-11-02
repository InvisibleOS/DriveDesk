import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// fonts bundled with the app, so the desk looks the same with or without internet:
// Geist for the interface, Newsreader (serif) for titles and big numbers, Geist Mono for registration numbers
const sans = localFont({ src: './fonts/geist.woff2', weight: '100 900', variable: '--font-sans', display: 'swap' });
const serif = localFont({ src: './fonts/newsreader.woff2', weight: '200 800', variable: '--font-serif', display: 'swap' });
const mono = localFont({ src: './fonts/geist-mono.woff2', weight: '100 900', variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = { title: 'DriveDesk', description: 'Live cabin and queue board for campus interview drives' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // the saved theme is applied before the first paint, so a dark page never flashes white
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'light'}catch(e){}" }} /></head>
      <body>{children}</body>
    </html>
  );
}
