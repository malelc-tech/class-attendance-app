import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Class Attendance",
  description: "QR + GPS based class attendance system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
