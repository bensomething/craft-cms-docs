// src/search-glossary.tsx
// Change: Add Docs links into the Action Panel inside a submenu (“In the Docs”).
// Everything else remains the same.

import { Action, ActionPanel, Cache, Icon, LaunchProps, List } from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchGlossary } from "./api";
import { summaryHtmlToMarkdown } from "./summary-to-markdown";
import type { GlossaryTerm } from "./types";

const PAGE_SIZE = 30;

const cache = new Cache({ namespace: "craft-glossary" });
const queryCache = new Map<string, GlossaryTerm[]>();
const ALL_KEY = "all-terms";
const QUERY_PREFIX = "q:";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type Props = LaunchProps<{ launchContext?: { slug?: string } }>;

export default function Command(props: Props) {
    const [deeplinkSlug, setDeeplinkSlug] = useState<string | null>(props.launchContext?.slug ?? null);

    // Controlled search bar text and query
    const [searchTextUI, setSearchTextUI] = useState<string>(deeplinkSlug ?? "");
    const [query, setQuery] = useState<string>(deeplinkSlug ?? "");

    const [allItems, setAllItems] = useState<GlossaryTerm[]>([]);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    // Start busy on initial load (so we never render an empty list)
    const [loading, setLoading] = useState<boolean>(true);
    const [resolvingDeepLink, setResolvingDeepLink] = useState<boolean>(!!deeplinkSlug);

    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

    const abortRef = useRef<AbortController | null>(null);

    const hasData = allItems.length > 0;
    const isBusy = loading || resolvingDeepLink;

    // Group only when idle (no query and no deeplink)
    const shouldGroup = !query.trim() && !deeplinkSlug;

    useEffect(() => {
        if (deeplinkSlug !== null) {
            setSearchTextUI(deeplinkSlug);
            setQuery(deeplinkSlug);
        }
    }, [deeplinkSlug]);

    useEffect(() => {
        setPage(1);
        setVisibleCount(PAGE_SIZE);
    }, [query]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            const q = query.trim();

            // 1) In-memory cache
            const mem = queryCache.get(q);
            if (mem) {
                setAllItems(mem);
                adjustSelection(mem, deeplinkSlug, selectedId, setSelectedId);
                setResolvingDeepLink(false);
                setLoading(false);
                return;
            }

            // 2) Persistent cache
            const persisted = readQueryFromCache(q);
            if (persisted) {
                queryCache.set(q, persisted);
                setAllItems(persisted);
                adjustSelection(persisted, deeplinkSlug, selectedId, setSelectedId);
                setResolvingDeepLink(false);
                setLoading(false);
                return;
            }

            // 3) Network
            setLoading(true);
            try {
                const data = await searchGlossary(q, { signal: controller.signal });
                if (cancelled) return;

                queryCache.set(q, data);
                writeQueryToCache(q, data);
                if (!q) writeAllTermsToCache(data);

                setAllItems(data);
                adjustSelection(data, deeplinkSlug, selectedId, setSelectedId);
            } catch (e: any) {
                if (e?.name !== "AbortError") {
                    const fallback = readAllTermsFromCache();
                    if (fallback) {
                        queryCache.set("", fallback);
                        setAllItems(fallback);
                        setSelectedId(fallback.length ? String(fallback[0].id) : undefined);
                    } else {
                        setAllItems([]); // truly empty; placeholder below prevents "No results"
                    }
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setResolvingDeepLink(false);
                }
            }
        };

        const delay = deeplinkSlug ? 0 : 200;
        const t = setTimeout(run, delay);
        return () => {
            cancelled = true;
            clearTimeout(t);
            abortRef.current?.abort();
        };
    }, [query, deeplinkSlug, selectedId]);

    const items = useMemo(() => allItems.slice(0, visibleCount), [allItems, visibleCount]);
    const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
    const hasMore = visibleCount < allItems.length;

    function handleLoadMore() {
        const nextCount = Math.min(visibleCount + PAGE_SIZE, allItems.length);
        setVisibleCount(nextCount);
        const nextPage = Math.min(totalPages, Math.ceil(nextCount / PAGE_SIZE));
        setPage(nextPage);
    }

    const grouped = useMemo(() => (shouldGroup ? groupByLetter(items) : null), [items, shouldGroup]);

    return (
        <List
            isLoading={isBusy} // spinner shows while busy (initial launch and future fetches)
            isShowingDetail
            searchBarPlaceholder="Search Craft Glossary…"
            searchText={searchTextUI}
            onSearchTextChange={(text) => {
                if (deeplinkSlug !== null && text !== deeplinkSlug) {
                    setDeeplinkSlug(null);
                }
                setSearchTextUI(text);
                setQuery(text);
            }}
            throttle
            selectedItemId={selectedId}
            onSelectionChange={(id) => setSelectedId(id)}
            pagination={hasData ? { page, hasMore, onLoadMore: handleLoadMore } : undefined}
        >
            {isBusy && <List.Item id="placeholder" title="Loading…" />}

            {!isBusy &&
                (shouldGroup
                    ? grouped?.keys.map((letter) => {
                          const sectionItems = grouped.map.get(letter) ?? [];
                          return (
                              <List.Section key={letter} title={letter}>
                                  {sectionItems.map((t) => (
                                      <Row key={t.id} term={t} hasMore={hasMore} onLoadMore={handleLoadMore} />
                                  ))}
                              </List.Section>
                          );
                      })
                    : items.map((t) => (
                          <Row key={t.id} term={t} hasMore={hasMore} onLoadMore={handleLoadMore} />
                      )))}
        </List>
    );
}

function Row({ term, hasMore, onLoadMore }: { term: GlossaryTerm; hasMore: boolean; onLoadMore: () => void }) {
    const docs = term.docsLinks ?? [];
    const hasDocs = docs.length > 0;

    return (
        <List.Item
            id={String(term.id)}
            title={term.title}
            detail={<TermDetail term={term} />}
            actions={
                <ActionPanel>
                    <Action.OpenInBrowser url={term.url} />
                    <Action.CopyToClipboard title="Copy URL" content={term.url} />
                    {/* <Action.CopyToClipboard title="Copy Title" content={term.title} />
                    {term.summaryPlain && (
                        <Action.CopyToClipboard title="Copy Summary (Text)" content={term.summaryPlain} />
                    )} */}

                    {hasDocs && (
                        <ActionPanel.Submenu title="In the Docs" icon={Icon.Book} shortcut={{ modifiers: ["cmd"], key: "d" }}>
                            {docs.map((d, i) => (
                                <Action.OpenInBrowser
                                    key={`${term.slug}-doc-action-${i}`}
                                    title={d.title}
                                    icon={Icon.Link}
                                    url={d.url}
                                />
                            ))}
                        </ActionPanel.Submenu>
                    )}

                    {hasMore && (
                        <Action
                            title="Load More"
                            icon={Icon.ArrowDown}
                            onAction={onLoadMore}
                            shortcut={{ modifiers: ["cmd"], key: "l" }}
                        />
                    )}
                </ActionPanel>
            }
        />
    );
}

function TermDetail({ term }: { term: GlossaryTerm }) {
    const hasDocs = (term.docsLinks?.length ?? 0) > 0;

    return (
        <List.Item.Detail
            markdown={buildMarkdown(term)}
            metadata={hasDocs ? <DocsMetadata term={term} /> : undefined}
        />
    );
}

function DocsMetadata({ term }: { term: GlossaryTerm }) {
    const docs = term.docsLinks ?? [];

    return (
        <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="IN THE DOCS" />
            {docs.map((d, i) => (
                <List.Item.Detail.Metadata.Link
                    key={`${term.slug}-doc-${i}`}
                    title={d.title}
                    text="View"
                    target={d.url}
                />
            ))}
        </List.Item.Detail.Metadata>
    );
}

function buildMarkdown(t: GlossaryTerm) {
    const body = t.summaryHtml ? summaryHtmlToMarkdown(t.summaryHtml) : t.summaryPlain ?? "";
    return `# ${t.title}

${body}`;
}

/* ---------------- Cache helpers ---------------- */

function writeAllTermsToCache(terms: GlossaryTerm[]) {
    try {
        cache.set(ALL_KEY, JSON.stringify({ at: Date.now(), terms }));
    } catch {}
}

function readAllTermsFromCache(): GlossaryTerm[] | null {
    try {
        const raw = cache.get(ALL_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at: number; terms: GlossaryTerm[] };
        if (TTL_MS > 0 && Date.now() - parsed.at > TTL_MS) return null;
        return parsed.terms ?? null;
    } catch {
        return null;
    }
}

function keyForQuery(q: string) {
    return `${QUERY_PREFIX}${q}`;
}

function writeQueryToCache(q: string, terms: GlossaryTerm[]) {
    try {
        if (!q) {
            writeAllTermsToCache(terms);
            return;
        }
        cache.set(keyForQuery(q), JSON.stringify({ at: Date.now(), terms }));
    } catch {}
}

function readQueryFromCache(q: string): GlossaryTerm[] | null {
    try {
        if (!q) return readAllTermsFromCache();
        const raw = cache.get(keyForQuery(q));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at: number; terms: GlossaryTerm[] };
        if (TTL_MS > 0 && Date.now() - parsed.at > TTL_MS) return null;
        return parsed.terms ?? null;
    } catch {
        return null;
    }
}

/* --------------- Selection + grouping --------------- */

function adjustSelection(
    data: GlossaryTerm[],
    deeplinkSlug: string | null,
    prevSelectedId: string | undefined,
    setSelectedId: (id: string | undefined) => void
) {
    const hasPrev = !!prevSelectedId && data.some((t) => String(t.id) === String(prevSelectedId));
    if (hasPrev) return;

    if (deeplinkSlug) {
        const match =
            data.find((t) => t.slug === deeplinkSlug) ||
            data.find((t) => t.slug?.toLowerCase() === deeplinkSlug.toLowerCase());
        setSelectedId(match ? String(match.id) : data.length ? String(data[0].id) : undefined);
    } else {
        setSelectedId(data.length ? String(data[0].id) : undefined);
    }
}

function groupByLetter(terms: GlossaryTerm[]) {
    const map = new Map<string, GlossaryTerm[]>();
    for (const t of terms) {
        const first = (t.title?.trim()?.[0] || "").toUpperCase();
        const key = /^[A-Z]$/.test(first) ? first : "#";
        const arr = map.get(key);
        if (arr) arr.push(t);
        else map.set(key, [t]);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
        if (a === "#" && b !== "#") return 1;
        if (b === "#" && a !== "#") return -1;
        return a.localeCompare(b);
    });
    return { keys, map };
}
