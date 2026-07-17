import { LocalizedNotFound } from "@/app/_localized/not-found";
import { getDictionary } from "@/lib/i18n";

export default async function EnglishNotFound() {
  const dictionary = await getDictionary("en");
  return <LocalizedNotFound locale="en" dictionary={dictionary} />;
}
