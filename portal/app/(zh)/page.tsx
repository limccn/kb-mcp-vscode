import { HomePage } from "@/components/home-page";
import { getContent } from "@/content";

export default function ZhPage() {
  return <HomePage content={getContent("zh")} />;
}