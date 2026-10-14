/** Only a leading digits-hyphen sequence is structural numbering. */
export const prefixOf = (basename: string): string => basename.match(/^\d+-/)?.[0] ?? "";
export const withoutPrefix = (title: string): string => title.replace(/^\d+-/, "").trim();

export function slugify(title: string): string {
    const slug = title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[.'’‘"“”]/g, "")
        .replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), "-")
        .replace(/^-+|-+$/g, "");
    if (!slug) throw new Error("Use pelo menos uma letra ou número no título.");
    // Windows device names are invalid even with a Markdown extension.
    return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(slug) ? `note-${slug}` : slug;
}

export function humanize(basename: string): string {
    const small = new Set(
        "a an and as at but by for in of on or the to vs via with de da do das dos e em para por".split(" ")
    );
    const words = withoutPrefix(basename).replace(/[-_]+/g, " ").trim().split(/\s+/);
    return words
        .map((word, i) => {
            if (/[A-ZÀ-Ý]/.test(word) || (i > 0 && i < words.length - 1 && small.has(word))) return word;
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
}
