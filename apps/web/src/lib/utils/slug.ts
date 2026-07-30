const MAX_SLUG_LENGTH = 60;

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}
