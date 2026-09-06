import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";

export const PREVIEW_COOKIE = "ied_preview";

/**
 * Preview mode renders section DRAFTS instead of published content.
 * It is only honoured for a signed-in admin user, so an unpublished draft can
 * never leak to the public through a shared link.
 */
export async function isPreviewMode(): Promise<boolean> {
  // A static export has no request and no signed-in admin, so preview can
  // never apply — and reading a cookie here would make every page dynamic
  // and fail the export.
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "true") return false;

  const cookieStore = await cookies();
  if (cookieStore.get(PREVIEW_COOKIE)?.value !== "1") return false;
  return (await getCurrentUser()) !== null;
}
