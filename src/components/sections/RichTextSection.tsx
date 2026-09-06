import { Reveal } from "@/components/ui/Reveal";
import { cn, sanitizeRichText } from "@/lib/utils";
import { ls, str, SectionShell, type SectionProps } from "./helpers";

export function RichTextSection({ data, locale, sectionId, isLead }: SectionProps) {
  const Title = isLead ? "h1" : "h2";
  const narrow = str(data, "width", "narrow") === "narrow";
  return (
    <SectionShell id={sectionId}>
      <Reveal className={cn(narrow ? "mx-auto max-w-3xl" : "")}>
        {ls(data, "title", locale) && (
          <Title className="h2 mb-6">{ls(data, "title", locale)}</Title>
        )}
        <div
          className="prose-brand"
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(ls(data, "body", locale)) }}
        />
      </Reveal>
    </SectionShell>
  );
}
