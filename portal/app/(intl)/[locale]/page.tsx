import { notFound } from "next/navigation";
import { HomePage } from "@/components/home-page";
import { getContent, INTL_LOCALES, isLocale } from "@/content";

export const dynamicParams = false;

export function generateStaticParams() {
  return INTL_LOCALES.map((locale) => ({ locale }));
}

export default async function IntlPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "zh") {
    notFound();
  }

  return <HomePage content={getContent(locale)} />;
}