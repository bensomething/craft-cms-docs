// src/linking.ts
const GLOSSARY_HOST = "craftcms.com";

export function rewriteGlossaryLinksToRaycast(html: string, opts: {
    publisher: string;
    extensionName: string;
    command: string; // e.g., "search"
}) {
    const { publisher, extensionName, command } = opts;

    // Build base Raycast deep link
    const base = `raycast://extensions/${encodeURIComponent(publisher)}/${encodeURIComponent(extensionName)}/${encodeURIComponent(command)}`;

    // 1) Absolute links https://craftcms.com/glossary/<slug>
    html = html.replace(
        /href\s*=\s*"(https?:\/\/(?:www\.)?craftcms\.com)?\/glossary\/([a-z0-9-]+)"/gi,
        (_m, _host, slug) => `href="${base}?slug=${encodeURIComponent(slug)}"`
    );

    // 2) Relative links /glossary/<slug>
    html = html.replace(
        /href\s*=\s*"\/glossary\/([a-z0-9-]+)"/gi,
        (_m, slug) => `href="${base}?slug=${encodeURIComponent(slug)}"`
    );

    return html;
}
