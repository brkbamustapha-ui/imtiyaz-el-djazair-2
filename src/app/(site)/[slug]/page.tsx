import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionRenderer } from "@/components/sections/SectionRenderer";
import { getPageMeta, getPageSections } from "@/server/content";
import { getAllSettings } from "@/lib/settings";
import { getBrandLogos } from "@/lib/brand";
import { getLocale } from "@/lib/locale";
import { JsonLd } from "@/components/public/JsonLd";
import { breadcrumbSchema, metadataFromPageSeo, parsePageSeo } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [page, settings, logos] = await Promise.all([
    getPageMeta(slug),
    getAllSettings(),
    getBrandLogos(),
  ]);
  if (!page) return { title: "Page not found" };

  return metadataFromPageSeo(parsePageSeo(page.seoJson), {
    title: page.title,
    description: settings.seo.defaultDescription,
    path: `/${slug}`,
    ogImage: logos.ogImage,
    siteName: settings.general.siteName,
  });
}

export default async function CmsPage({ params }: Props) {
  const { slug } = await params;
  if (slug === "home") notFound();

  const [sections, locale, page, settings] = await Promise.all([
    getPageSections(slug),
    getLocale(),
    getPageMeta(slug),
    getAllSettings(),
  ]);
  if (!sections) notFound();

  return (
    <div className="pt-[var(--header-h)]">
      <JsonLd
        data={breadcrumbSchema([
          { name: settings.general.siteName, path: "/" },
          { name: page?.title ?? slug, path: `/${slug}` },
        ])}
      />
      <SectionRenderer sections={sections} locale={locale} />
    </div>
  );
}
