import type { MetadataRoute } from "next";
import { getSetting } from "@/lib/settings";
import { siteBaseUrl, siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = await getSetting("seo");

  if (!seo.robotsIndex) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
    // Host takes a bare hostname, not a URL: "https://example.com/" is not a
    // value any crawler that reads this directive accepts.
    host: new URL(siteBaseUrl()).host,
  };
}
