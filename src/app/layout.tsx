/**
 * The framework layout supplies page metadata and global styles around the frontend.
 */
import type { Metadata } from "next";
import "../frontend/styles/globals.css";

export const metadata: Metadata = {
  title: "Next Move — your work, your next role",
  description: "Discover your professional footprint, find relevant opportunities, and prepare a resume with evidence from Exa Deep.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
