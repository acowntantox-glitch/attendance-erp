import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attendance & Workforce ERP",
  description: "Attendance & Workforce Management ERP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
