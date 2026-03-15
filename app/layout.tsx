import type {Metadata} from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Persona Mimic Chat',
  description: 'An AI chatbot that learns and mimics a specific persona.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body className={`${outfit.className} antialiased`} suppressHydrationWarning>{children}</body>
    </html>
  );
}
