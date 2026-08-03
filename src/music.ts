export type AppleAlbum = {
  title: string;
  artist: string;
  releaseDate: string;
  appleId: string;
  artwork: string;
  sourceUrl: string;
  collectionType: string;
};
export type MbMatch = { id: string; title: string; artist: string; artistId: string; firstReleaseDate: string; primaryType: string; score: number };

export function appleAlbumId(input: string): string | null {
  try {
    const url = new URL(input);
    if (!/(^|\.)music\.apple\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const albumIndex = parts.indexOf("album");
    if (albumIndex < 0) return null;
    const id = parts[parts.length - 1];
    return /^\d+$/.test(id) ? id : null;
  } catch { return null; }
}

export function appleStorefront(input: string): string {
  try {
    const url = new URL(input);
    const storefront = url.pathname.split("/").filter(Boolean)[0] ?? "us";
    return /^[a-z]{2}$/i.test(storefront) ? storefront.toLowerCase() : "us";
  } catch { return "us"; }
}

export function largeArtworkUrl(input: string): string {
  return input
    .replace(/\{w\}x\{h\}(?:bb)?/i, "1200x1200bb")
    .replace(/\d+x\d+(?:bb)?(?=\.[a-z]+(?:\?|$))/i, "1200x1200bb")
    .replace(/\d+x\d+(?:bb)?(?=\/)/i, "1200x1200bb");
}

export function cleanAppleTitle(value: string, sourceUrl = ""): string {
  const raw = value.trim();
  const localized = raw.match(/\u4e13\u8f91\u300a(.+?)\u300b/u)?.[1]?.trim(); if (localized) return localized;
  const english = raw.match(/^(.+?)\s+by\s+.+?\s+on Apple Music$/i)?.[1]?.trim(); if (english) return english;
  if (!/Apple[\s\u00a0]*Music/i.test(raw)) return raw;
  try {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const albumIndex = parts.indexOf("album"); const slug = albumIndex >= 0 ? parts[albumIndex + 1] : "";
    return slug ? slug.replace(/-/g, " ") : raw;
  } catch { return raw; }
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function albumFromSerializedData(html: string, appleId = ""): Partial<AppleAlbum> {
  const script = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) return {};
  let root: unknown; try { root = JSON.parse(script); } catch { return {}; }
  const stack: unknown[] = [root]; let fallback: Record<string, unknown> | null = null;
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (!current || typeof current !== "object") continue;
    const object = current as Record<string, unknown>;
    const attributes = object.attributes && typeof object.attributes === "object" ? object.attributes as Record<string, unknown> : null;
    if (attributes?.name && attributes.artistName) {
      const playParams = attributes.playParams && typeof attributes.playParams === "object" ? attributes.playParams as Record<string, unknown> : null;
      const candidateId = String(object.id ?? playParams?.id ?? "");
      const type = String(object.type ?? playParams?.kind ?? "").toLowerCase();
      if (type === "albums" || type === "album") {
        if (!fallback) fallback = object;
        if (!appleId || candidateId === appleId) { fallback = object; break; }
      }
    }
    stack.push(...Object.values(object));
  }
  if (!fallback) return {};
  const attributes = fallback.attributes as Record<string, unknown>;
  const artwork = attributes.artwork && typeof attributes.artwork === "object" ? attributes.artwork as Record<string, unknown> : null;
  return {
    title: String(attributes.name ?? ""), artist: String(attributes.artistName ?? ""),
    releaseDate: String(attributes.releaseDate ?? "").slice(0, 10),
    artwork: largeArtworkUrl(String(artwork?.url ?? "")), collectionType: "Album",
  };
}

/** Extract the stable fallback metadata exposed by an Apple Music album page. */
export function parseApplePageMetadata(html: string, appleId = ""): Partial<AppleAlbum> {
  const serialized = albumFromSerializedData(html, appleId);
  const meta = (property: string) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content="([^"]*)"`, "i"),
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content='([^']*)'`, "i"),
      new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property=["']${escaped}["']`, "i"),
      new RegExp(`<meta[^>]+content='([^']*)'[^>]+property=["']${escaped}["']`, "i"),
    ];
    for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decodeHtml(match[1]).trim(); }
    return "";
  };
  const rawTitle = meta("og:title");
  const titleParts = rawTitle.split(/\s+[–—-]\s+/);
  const description = meta("og:description");
  const artistFromDescription = description.match(/(?:by|\u7531)\s+([^.,\u00b7]+?)(?:\s+on Apple Music|[.,\u00b7]|$)/i)?.[1]?.trim() ?? "";
  return {
    title: serialized.title || titleParts[0]?.trim() || "",
    artist: serialized.artist || artistFromDescription || titleParts[1]?.replace(/\s+on Apple Music.*$/i, "").trim() || "",
    releaseDate: serialized.releaseDate ?? "", collectionType: serialized.collectionType ?? "Album",
    artwork: serialized.artwork || largeArtworkUrl(meta("og:image")),
  };
}

export function releaseGroupId(input: string): string | null {
  const raw = input.trim();
  const match = raw.match(/(?:musicbrainz\.org\/release-group\/)?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function baseTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[\[(].*?\b(deluxe|remaster(?:ed)?|expanded|anniversary|edition)\b.*?[\])]/gi, "")
    .replace(/\s*[-–—:]\s*(deluxe|remaster(?:ed)?|expanded|anniversary)(?:\s+edition)?\s*$/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeArtist(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function reliableMatch(title: string, artist: string, candidates: MbMatch[]): MbMatch | null {
  const normalizedArtist = normalizeArtist(artist);
  const exact = candidates.filter(c => baseTitle(c.title) === baseTitle(title)
    && (!normalizedArtist || normalizeArtist(c.artist) === normalizedArtist)
    && c.score >= 90);
  return exact.length === 1 ? exact[0] : null;
}
