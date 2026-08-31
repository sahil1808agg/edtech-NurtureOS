import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NurtureOS',
  description: 'Understand your child\'s school report, and what to do next.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-3xl px-6 py-10">{children}</div>
      </body>
    </html>
  );
}
