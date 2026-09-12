import { t, type Locale, type LocalizedText } from "@/lib/i18n";
import { Reveal } from "@/components/ui/Reveal";
import { cn } from "@/lib/utils";

export type SectionProps = {
  data: Record<string, unknown>;
  locale: Locale;
  sectionId: string;
  /**
   * True for the block that opens the page. Its heading becomes the page's
   * <h1>: only the home page had one, because only the hero renders one, so
   * seven pages were published with no top-level heading at all. The styling
   * is unchanged — `h2` here is a class, not the tag.
   */
  isLead?: boolean;
};

export function ls(
  data: Record<string, unknown>,
  key: string,
  locale: Locale,
): string {
  return t(data[key] as LocalizedText | string | undefined, locale);
}

/**
 * Same as `ls`, but an author who clears the field in ONE language gets
 * nothing in that language instead of the English text.
 *
 * `t` treats an empty string as "not translated yet" and falls back, which is
 * right for a heading — better English than a blank page. It is wrong for the
 * small label above a heading: the Arabic word for "Campus" read as the
 * Sacred Mosque, and clearing it only brought the English back. Clearing a
 * key that exists is a decision; a key that was never filled still falls back.
 */
export function lsOptional(
  data: Record<string, unknown>,
  key: string,
  locale: Locale,
): string {
  const value = data[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, locale)) {
      const own = record[locale];
      if (typeof own === "string" && own.trim() === "") return "";
    }
  }
  return ls(data, key, locale);
}

export function str(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" ? value : fallback;
}

export function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bool(data: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = data[key];
  return typeof value === "boolean" ? value : fallback;
}

export function arr<T>(data: Record<string, unknown>, key: string): T[] {
  const value = data[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export type Cta = { label: LocalizedText | string; href: string };

/** CTAs are stored as a one-row repeater so the admin UI can add/remove them. */
export function cta(data: Record<string, unknown>, key: string): Cta | null {
  const rows = arr<Cta>(data, key);
  const first = rows[0];
  if (!first) return null;
  const label = typeof first.label === "string" ? first.label : first.label;
  if (!label) return null;
  return { label, href: first.href || "#" };
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  align?: "center" | "left";
  className?: string;
  as?: "h1" | "h2";
}) {
  if (!eyebrow && !title && !subtitle) return null;
  return (
    <Reveal
      className={cn(
        "max-w-3xl",
        align === "center" ? "mx-auto text-center" : "text-start",
        className,
      )}
    >
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      {title && <Tag className="h2 mt-3 text-balance">{title}</Tag>}
      {subtitle && <p className="lead mt-4 text-pretty">{subtitle}</p>}
      {align === "center" && (title || eyebrow) && (
        <div className="divider-gold mx-auto mt-7 w-24" />
      )}
    </Reveal>
  );
}

export function SectionShell({
  id,
  children,
  className,
  tone = "default",
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "surface";
}) {
  return (
    <section
      id={id}
      className={cn(
        "section-y relative",
        tone === "surface" && "bg-[var(--c-surface)]",
        className,
      )}
    >
      <div className="container-x relative">{children}</div>
    </section>
  );
}
