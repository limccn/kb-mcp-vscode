import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootShell } from "@/components/root-shell";
import { buildMetadata } from "@/lib/metadata";
import "../globals.css";

export const metadata: Metadata = buildMetadata("zh");

export default function ZhLayout({ children }: { children: ReactNode }) {
  return <RootShell locale="zh">{children}</RootShell>;
}