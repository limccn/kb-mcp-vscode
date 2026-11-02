import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RootShell } from "@/components/root-shell";
import { INTL_LOCALES, isLocale } from "@/content";
import { buildMetadata } from "@/lib/metadata";
import "../../globals.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return INTL_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "zh") {
    return {};
  }
  return buildMetadata(locale);
}

export default async function IntlLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || locale === "zh") {
    notFound();
  }

  return <RootShell locale={locale}>{children}</RootShell>;
}