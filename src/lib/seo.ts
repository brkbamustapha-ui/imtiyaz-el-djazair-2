import type { Metadata } from "next";
import { parseJson } from "./json";

export type PageSeo = {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
};

export function parsePageSeo(seoJson: string | null | undefined): PageSeo {
  return parseJson<PageSeo>(seoJson, {});
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Adds the scheme Vercel's host variables omit, and drops a trailing slash. */
function normaliseBase(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

function isLoopback(base: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(base).hostname);
  } catch {
    return false;
  }
}

let cachedBase: string | null = null;

/**
 * The site's public base URL, without a trailing slash.
 *
 * NEXT_PUBLIC_SITE_URL wins, because it is the only place a custom domain can
 * be declared. But it ships as "http://localhost:3000" and is easy to leave
 * that way, and a loopback address is never a valid public base: left alone it
 * publishes "localhost" into robots.txt, sitemap.xml, every canonical, every
 * Open Graph tag and the JSON-LD — telling search engines to fetch the sitemap
 * from their own machine.
 *
 * So a loopback value defers to the host. VERCEL_PROJECT_PRODUCTION_URL is the
 * project's production domain and stays the same on preview builds, which is
 * what canonicals want; VERCEL_URL is the per-deployment host, used only before
 * a production domain exists. Setting NEXT_PUBLIC_SITE_URL to the real domain
 * still overrides all of it.
 */
export function siteBaseUrl(): string {
  if (cachedBase) return cachedBase;

  const configured = normaliseBase(process.env.NEXT_PUBLIC_SITE_URL);
  const deployed =
    normaliseBase(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normaliseBase(process.env.VERCEL_URL);

  cachedBase =
    (configured && !isLoopback(configured) ? configured : null) ??
    deployed ??
    configured ??
    "http://localhost:3000";

  return cachedBase;
}

export function siteUrl(path = "/"): string {
  return `${siteBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute form of a stored path, leaving a full URL untouched. */
export function absoluteUrl(value: string): string {
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : siteUrl(value.trim());
}

/** Site-wide share image, used whenever a page has nothing more specific. */
const DEFAULT_SHARE_IMAGE = "/assets/social-card.png";

export function metadataFromPageSeo(
  seo: PageSeo,
  fallback: {
    title: string;
    description: string;
    path: string;
    /** Page-specific share image — a post's cover, or the school's own file. */
    ogImage?: string | null;
    /** Shown as og:site_name. Without it the brand is absent from previews. */
    siteName?: string;
    /**
     * Skip the layout's "%s | Imtiyaz El Djazair" template. The home page's
     * title already ends in the school's name, so the template printed it
     * twice: "Imtiyaz El Djazair — School & Exam Center | Imtiyaz El Djazair".
     */
    titleIsComplete?: boolean;
  },
): Metadata {
  const title = seo.title?.trim() || fallback.title;
  const description = seo.description?.trim() || fallback.description;
  const url = absoluteUrl(seo.canonical?.trim() || siteUrl(fallback.path));

  // Next.js replaces the layout's openGraph outright when a page supplies its
  // own — it does not merge the two. Emitting `images: undefined` here left
  // every public page with no share picture at all while /admin/login, which
  // overrides nothing, kept one. So always resolve an image.
  const share = absoluteUrl(
    seo.ogImage?.trim() || fallback.ogImage?.trim() || DEFAULT_SHARE_IMAGE,
  );

  return {
    title: fallback.titleIsComplete ? { absolute: title } : title,
    description,
    keywords: seo.keywords?.length ? seo.keywords : undefined,
    alternates: { canonical: url },
    robots: seo.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: fallback.siteName || undefined,
      type: "website",
      images: [{ url: share, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [share],
    },
  };
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type OpeningHoursSpec = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
};

/**
 * Every spelling of a weekday the admin might type, mapped to the one word
 * schema.org understands. French is here because the school writes in French:
 * without it a hours row typed only in French would silently produce nothing.
 */
const DAY_NAMES: Record<string, (typeof WEEKDAYS)[number]> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
  lundi: "Monday",
  mardi: "Tuesday",
  mercredi: "Wednesday",
  jeudi: "Thursday",
  vendredi: "Friday",
  samedi: "Saturday",
  dimanche: "Sunday",
};

// Longest first, so "mercredi" is never cut short by "mardi"-style prefixes.
const DAY_PATTERN = new RegExp(
  Object.keys(DAY_NAMES)
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "gi",
);

/**
 * Turns the opening hours the school types in the admin into the shape
 * schema.org wants, so Google can show them.
 *
 * The admin field is free text — someone may write "Closed", "Sur rendez-vous",
 * or a range in any wording. Anything this cannot read with certainty produces
 * nothing rather than a guess: wrong hours in structured data send people to a
 * closed door, which is worse than no hours at all.
 */
export function openingHoursSchema(
  entries: { day: string; hours: string }[],
): OpeningHoursSpec[] {
  const out: OpeningHoursSpec[] = [];

  for (const entry of entries) {
    const time = entry.hours.match(/(\d{1,2}:\d{2})\s*[\u2013\u2014-]\s*(\d{1,2}:\d{2})/);
    if (!time) continue;

    const named = entry.day.match(DAY_PATTERN);
    if (!named || named.length === 0) continue;

    const canonical = (value: string) => DAY_NAMES[value.toLowerCase()];

    let days: string[];
    if (named.length === 2 && /[\u2013\u2014-]|\bto\b|\b(?:à|au)\b/i.test(entry.day)) {
      // "Saturday – Thursday" wraps around the end of the week.
      const from = WEEKDAYS.indexOf(canonical(named[0]));
      const to = WEEKDAYS.indexOf(canonical(named[1]));
      if (from < 0 || to < 0) continue;
      days = [];
      for (let i = from; ; i = (i + 1) % WEEKDAYS.length) {
        days.push(WEEKDAYS[i]);
        if (i === to) break;
        if (days.length > 7) break;
      }
    } else {
      days = named.map(canonical).filter(Boolean);
    }

    if (days.length === 0) continue;
    // schema.org reads these as ISO 8601 times, which want two digits: "8:00"
    // typed in the admin has to leave here as "08:00".
    const pad = (value: string) => (value.length === 4 ? `0${value}` : value);
    out.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days.map((d) => `https://schema.org/${d}`),
      opens: pad(time[1]),
      closes: pad(time[2]),
    });
  }

  return out;
}

/**
 * The Home > Section > Page trail, as schema.org reads it.
 *
 * Google draws this above the blue link in place of the raw URL, so a result
 * for a news post reads "Imtiyaz El Djazair > News > …" instead of a path.
 * The trail must match what the visitor can actually click, so every entry
 * here has a real page behind it.
 */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: siteUrl(step.path),
    })),
  };
}
