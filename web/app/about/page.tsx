import type { Metadata } from "next";
import { AboutPageView, generateAboutMetadata } from "../_localized/about";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generateAboutMetadata("en");
}

export default function AboutPage() {
  return <AboutPageView locale="en" />;
}
