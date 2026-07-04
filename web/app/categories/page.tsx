import type { Metadata } from "next";
import { CategoriesPageView, generateCategoriesMetadata } from "../_localized/categories";

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  return generateCategoriesMetadata("en");
}

export default function CategoriesPage() {
  return <CategoriesPageView locale="en" />;
}
