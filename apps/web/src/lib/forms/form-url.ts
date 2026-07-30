import { slugify } from "@/lib/utils/slug";

/**
 * Public form path. The token is the only resolution key — the slug is
 * decorative and ignored by the route, so stale titles are harmless.
 */
export function formPublicPath(token: string, title?: string | null): string {
  const slug = title ? slugify(title) : "";
  return slug ? `/f/${token}/${slug}` : `/f/${token}`;
}
