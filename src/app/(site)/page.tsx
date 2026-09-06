import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionRenderer } from "@/components/sections/SectionRenderer";
import { JsonLd } from "@/components/public/JsonLd";
import { getPageMeta, getPageSections } from "@/server/content";
import { getAllSettings } from "@/lib/settings";
import { getBrandLogos } from "@/lib/brand";
import { getLocale } from "@/lib/locale";
import { metadataFromPageSeo, openingHoursSchema, parsePageSeo, siteUrl } from "@/lib/seo";
import { t } from "@/lib/i18n";
import { contactPhones } from "@/lib/settings-schema";

export async function generateMetadata(): Promise<Metadata> {
  const [page, settings, logos] = await Promise.all([
    getPageMeta("home"),
    getAllSettings(),
    getBrandLogos(),
  ]);
  return metadataFromPageSeo(parsePageSeo(page?.seoJson), {
    title: settings.seo.defaultTitle,
    description: settings.seo.defaultDescription,
    path: "/",
    ogImage: logos.ogImage,
    siteName: settings.general.siteName,
    titleIsComplete: true,
  });
}

export default async function HomePage() {
  const [sections, settings, locale, logos] = await Promise.all([
    getPageSections("home"),
    getAllSettings(),
    getLocale(),
    getBrandLogos(),
  ]);

  if (!sections) notFound();

  const { general, contact, social, seo } = settings;
  const socialLinks = Object.values(social).filter((value) => value.trim() !== "");

  // Everything below is read from the settings the school owns; a field it has
  // not filled in is left out of the graph rather than published empty.
  const phones = contactPhones(contact);
  const street = [contact.addressLine1, contact.addressLine2].filter(Boolean).join(", ");
  const openingHours = openingHoursSchema(
    (Array.isArray(contact.openingHours) ? contact.openingHours : []).map((row) => ({
      day: t(row.day, "en") || t(row.day, locale),
      hours: row.hours ?? "",
    })),
  );

  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": seo.organizationType || "EducationalOrganization",
            name: general.siteName,
            alternateName: t(general.tagline, locale),
            description: seo.defaultDescription,
            url: siteUrl("/"),
            logo: logos.primary ? siteUrl(logos.primary) : undefined,
            image: siteUrl(logos.ogImage ?? "/assets/social-card.png"),
            email: contact.email || undefined,
            telephone: phones[0] || undefined,
            sameAs: socialLinks.length > 0 ? socialLinks : undefined,
            hasMap: contact.mapsLink || undefined,
            openingHoursSpecification: openingHours.length > 0 ? openingHours : undefined,
            address: {
              "@type": "PostalAddress",
              streetAddress: street || undefined,
              addressLocality: contact.city || undefined,
              addressCountry: contact.country || undefined,
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: general.siteName,
            url: siteUrl("/"),
            inLanguage: general.enabledLocales,
          },
        ]}
      />
      <SectionRenderer sections={sections} locale={locale} />
    </>
  );
}
