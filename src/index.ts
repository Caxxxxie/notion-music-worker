import { appleAlbumId, appleStorefront, baseTitle, cleanAppleTitle, largeArtworkUrl, normalizeArtist, parseApplePageMetadata, releaseGroupId, reliableMatch, type AppleAlbum, type MbMatch } from "./music";
import { schemaCandidates, schemaForPage, type Schema } from "./config";
import type { WorkerEnv } from "./env";
import { searchPage } from "./search-page";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MB_HEADERS = { "user-agent": "NotionMusicImporter/1.0 (personal music library)", accept: "application/json" };

type Page = { id: string; parent: { type: string; data_source_id?: string }; properties: Record<string, Property> };
type Property = { type: string; title?: RichText[]; rich_text?: RichText[]; url?: string | null; select?: { name: string } | null; checkbox?: boolean; people?: { id: string }[]; relation?: { id: string }[] };
type RichText = { plain_text?: string; text?: { content: string } };
type WebhookEvent = { type?: string; entity?: { id?: string; type?: string }; verification_token?: string };
type ApiBody = Record<string, unknown>;

function textValue(p?: Property): string { return (p?.title ?? p?.rich_text ?? []).map(x => x.plain_text ?? x.text?.content ?? "").join("").trim(); }
function urlValue(p?: Property): string { return p?.url?.trim() ?? ""; }
function selectValue(p?: Property): string { return p?.select?.name ?? ""; }
function richText(content: string) { return { rich_text: content ? [{ type: "text", text: { content: content.slice(0, 2000) } }] : [] }; }
function title(content: string) { return { title: [{ type: "text", text: { content: content.slice(0, 2000) } }] }; }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function normId(id: string) { return id.replaceAll("-", ""); }

async function readApiBody(request: Request): Promise<ApiBody> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 8_000) throw new Error("payload too large");
  const { text, truncated } = await readTextLimited(request.body, 8_000);
  if (truncated) throw new Error("payload too large");
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid json");
    return value as ApiBody;
  } catch (error) {
    if (error instanceof Error && ["payload too large", "invalid json"].includes(error.message)) throw error;
    throw new Error("invalid json");
  }
}

function stringField(body: ApiBody, name: string, maxLength: number) {
  return typeof body[name] === "string" ? body[name].trim().slice(0, maxLength) : "";
}

function importErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Notion 401") || message.startsWith("Notion 403")) return "The Notion integration no longer has permission to edit this library.";
  if (message.startsWith("Notion 404")) return "A configured Notion database could not be found.";
  if (message.startsWith("Notion 400")) return "Notion rejected the album data. Check that the library schema still matches the template.";
  if (message.startsWith("MusicBrainz")) return "MusicBrainz is temporarily unavailable. Try again in a moment.";
  if (message.includes("artist for this album")) return "MusicBrainz did not return an artist for this album.";
  if (message.includes("database does not match")) return "The Notion library schema does not match the configured template.";
  return "The album could not be added. Try again in a moment.";
}

async function notion(env: WorkerEnv, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, "notion-version": env.NOTION_VERSION, "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Notion ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getPage(env: WorkerEnv, id: string) { return notion(env, `/pages/${id}`) as Promise<unknown> as Promise<Page>; }
async function patchPage(env: WorkerEnv, id: string, properties: Record<string, unknown>, cover?: string) {
  return notion(env, `/pages/${id}`, { method: "PATCH", body: JSON.stringify({ properties, ...(cover ? { cover: { type: "external", external: { url: cover } } } : {}) }) });
}
async function query(env: WorkerEnv, dataSourceId: string, filter: unknown, pageSize = 10) {
  return notion(env, `/data_sources/${dataSourceId}/query`, { method: "POST", body: JSON.stringify({ filter, page_size: pageSize }) }) as Promise<{ results?: Page[] }>;
}
async function createPage(env: WorkerEnv, dataSourceId: string, properties: Record<string, unknown>, cover?: string) {
  return notion(env, "/pages", { method: "POST", body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties, ...(cover ? { cover: { type: "external", external: { url: cover } } } : {}) }) }) as Promise<{ id: string }>;
}

async function readTextLimited(body: ReadableStream<Uint8Array> | null, maxBytes = 8_000_000): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader(); const decoder = new TextDecoder();
  const readLimit = maxBytes + 1;
  let total = 0; let output = ""; let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const remaining = readLimit - total;
      if (remaining <= 0) { truncated = true; await reader.cancel(); break; }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      total += chunk.byteLength; output += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength || total >= readLimit) { truncated = true; await reader.cancel(); break; }
    }
    return { text: output + decoder.decode(), truncated };
  } finally { reader.releaseLock(); }
}

async function appleApiLookup(input: string, id: string): Promise<Partial<AppleAlbum>> {
  const preferred = appleStorefront(input);
  const storefronts = [...new Set([preferred, "us"])];
  for (const storefront of storefronts) {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${id}&country=${storefront}&entity=album`;
    const response = await fetch(lookupUrl, { headers: { accept: "application/json", "user-agent": "NotionMusicImporter/1.1" } });
    if (!response.ok) { console.warn(JSON.stringify({ event: "apple_lookup_failed", albumId: id, storefront, status: response.status })); continue; }
    const data = await response.json() as { results?: Array<Record<string, unknown>> };
    const row = data.results?.find(x => x.wrapperType === "collection") ?? data.results?.[0];
    if (!row) continue;
    return {
      title: String(row.collectionName ?? ""), artist: String(row.artistName ?? ""),
      releaseDate: String(row.releaseDate ?? "").slice(0, 10), appleId: String(row.collectionId ?? id),
      artwork: largeArtworkUrl(String(row.artworkUrl100 ?? row.artworkUrl60 ?? "")),
      collectionType: String(row.collectionType ?? "Album"),
    };
  }
  return {};
}

async function applePageLookup(input: string, id: string): Promise<Partial<AppleAlbum>> {
  const response = await fetch(input, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 NotionMusicImporter/1.1" }, redirect: "follow" });
  if (!response.ok) { console.warn(JSON.stringify({ event: "apple_page_failed", status: response.status, url: input })); return {}; }
  const parsed = parseApplePageMetadata((await readTextLimited(response.body)).text, id);
  if (!parsed.title || !parsed.artist) console.warn(JSON.stringify({ event: "apple_page_metadata_missing", url: input, hasTitle: Boolean(parsed.title), hasArtist: Boolean(parsed.artist), hasArtwork: Boolean(parsed.artwork) }));
  return parsed;
}

async function appleLookup(input: string): Promise<AppleAlbum | null> {
  const id = appleAlbumId(input); if (!id) return null;
  const [api, page] = await Promise.all([
    appleApiLookup(input, id).catch(error => { console.warn(JSON.stringify({ event: "apple_api_error", albumId: id, error: String(error) })); return {}; }),
    applePageLookup(input, id).catch(error => { console.warn(JSON.stringify({ event: "apple_page_error", albumId: id, error: String(error) })); return {}; }),
  ]);
  const merged = { ...page, ...Object.fromEntries(Object.entries(api).filter(([, value]) => value)) } as Partial<AppleAlbum>;
  const cleanedTitle = cleanAppleTitle(merged.title ?? "", input);
  if (!cleanedTitle) {
    console.error(JSON.stringify({ event: "apple_metadata_unavailable", albumId: id, hasTitle: false, hasArtist: Boolean(merged.artist), hasArtwork: Boolean(merged.artwork) }));
    return null;
  }
  return {
    title: cleanedTitle, artist: merged.artist ?? "", releaseDate: merged.releaseDate ?? "", appleId: merged.appleId ?? id,
    artwork: merged.artwork ?? "", sourceUrl: input, collectionType: merged.collectionType ?? "Album",
  };
}

async function imageWorks(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET", headers: { range: "bytes=0-1023", accept: "image/*" }, redirect: "follow" });
    const valid = response.ok && (response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
    await response.body?.cancel(); return valid;
  } catch { return false; }
}

async function chooseCover(appleArtwork: string, mbid: string): Promise<string> {
  if (appleArtwork && await imageWorks(appleArtwork)) return appleArtwork;
  const caa = mbid ? `https://coverartarchive.org/release-group/${mbid}/front-500` : "";
  return caa && await imageWorks(caa) ? caa : "";
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function refreshExistingAlbums(env: WorkerEnv) {
  let fields: Schema | null = null;
  let albums: { results?: Page[] } | null = null;
  for (const candidate of schemaCandidates(env)) {
    try {
      albums = await query(env, env.ALBUM_DATA_SOURCE_ID, { property: candidate.album.sourceUrl, url: { is_not_empty: true } }, 100);
      fields = candidate; break;
    } catch { /* Try the other built-in language schema. */ }
  }
  if (!fields || !albums) throw new Error("The album database does not match the English or legacy schema");
  let updated = 0; const skipped: Array<{ pageId: string; reason: string }> = [];
  for (const page of albums.results ?? []) {
    const sourceUrl = urlValue(page.properties[fields.album.sourceUrl]);
    if (!appleAlbumId(sourceUrl)) { skipped.push({ pageId: page.id, reason: "Source is not an Apple Music album URL" }); continue; }
    try {
      const apple = await appleLookup(sourceUrl);
      if (!apple) { skipped.push({ pageId: page.id, reason: "Apple Music metadata could not be parsed" }); continue; }
      const mbid = textValue(page.properties[fields.album.musicBrainzId]);
      const match = mbid ? await mbById(mbid) : null;
      const cover = await chooseCover(apple.artwork, mbid);
      const properties: Record<string, unknown> = {
        ...(match ? {
          [fields.album.title]: title(match.title),
          [fields.album.releaseDate]: (match.firstReleaseDate || apple.releaseDate) ? { date: { start: match.firstReleaseDate || apple.releaseDate } } : { date: null },
          [fields.album.type]: { select: { name: albumType(match.primaryType || apple.collectionType) } },
        } : {}),
        [fields.album.sourceUrl]: { url: sourceUrl },
        ...(cover ? { [fields.album.cover]: { files: [{ type: "external", name: "cover.jpg", external: { url: cover } }] } } : {}),
      };
      await patchPage(env, page.id, properties, cover); updated++;
      if (mbid) await sleep(1100); // Respect MusicBrainz's one-request-per-second limit.
    } catch (error) {
      skipped.push({ pageId: page.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ event: "existing_albums_refreshed", updated, skipped: skipped.length }));
  return { scanned: albums.results?.length ?? 0, updated, skipped };
}

async function secretEquals(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(actualHash, expectedHash);
}

async function validSearchEmbedToken(supplied: string, env: WorkerEnv): Promise<boolean> {
  const token = env.SEARCH_EMBED_TOKEN;
  return token ? secretEquals(supplied, token) : false;
}

function artistCredit(row: Record<string, unknown>) {
  const credit = row["artist-credit"] as Array<{ name?: string; artist?: { id?: string; name?: string } }> | undefined;
  return { name: credit?.map(x => x.name ?? x.artist?.name ?? "").filter(Boolean).join(", ") ?? "", id: credit?.[0]?.artist?.id ?? "" };
}
async function mbById(id: string): Promise<MbMatch> {
  const response = await fetch(`https://musicbrainz.org/ws/2/release-group/${id}?inc=artists&fmt=json`, { headers: MB_HEADERS });
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
  const row = await response.json() as Record<string, unknown>; const a = artistCredit(row);
  return { id: String(row.id), title: String(row.title), artist: a.name, artistId: a.id, firstReleaseDate: String(row["first-release-date"] ?? ""), primaryType: String(row["primary-type"] ?? "Album"), score: 100 };
}
async function mbSearch(album: string, artist: string): Promise<MbMatch[]> {
  const q = artist
    ? `releasegroup:${JSON.stringify(baseTitle(album))} AND artist:${JSON.stringify(artist)}`
    : `releasegroup:${JSON.stringify(baseTitle(album))}`;
  const response = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`, { headers: MB_HEADERS });
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
  const data = await response.json() as { "release-groups"?: Array<Record<string, unknown>> };
  return (data["release-groups"] ?? []).map(row => { const a = artistCredit(row); return { id: String(row.id), title: String(row.title), artist: a.name, artistId: a.id, firstReleaseDate: String(row["first-release-date"] ?? ""), primaryType: String(row["primary-type"] ?? "Album"), score: Number(row.score ?? 0) }; });
}

function albumType(primary: string) { const p = primary.toLowerCase(); if (p === "ep") return "EP"; if (p === "single") return "Single"; return "Album"; }
function artistType(type?: string, name?: string) { if (name === "Various Artists") return "Various Artists"; if (type === "Group") return "Band"; return "Solo"; }
async function getArtist(env: WorkerEnv, id: string) {
  const response = await fetch(`https://musicbrainz.org/ws/2/artist/${id}?fmt=json`, { headers: MB_HEADERS });
  if (!response.ok) throw new Error(`MusicBrainz artist ${response.status}`);
  return response.json() as Promise<{ id: string; name: string; type?: string; country?: string; area?: { name?: string }; "life-span"?: { begin?: string; end?: string } }>;
}

async function ensureArtist(env: WorkerEnv, fields: Schema, mbid: string, preferredName: string, people: { id: string }[]) {
  const existing = await query(env, env.ARTIST_DATA_SOURCE_ID, { property: fields.artist.musicBrainzId, rich_text: { equals: mbid } });
  if (existing.results?.[0]) return existing.results[0].id;
  const artist = await getArtist(env, mbid);
  const span = [artist["life-span"]?.begin, artist["life-span"]?.end].filter(Boolean).join("–");
  const created = await createPage(env, env.ARTIST_DATA_SOURCE_ID, {
    [fields.artist.name]: title(preferredName || artist.name), [fields.artist.musicBrainzId]: richText(mbid),
    [fields.artist.musicBrainzUrl]: { url: `https://musicbrainz.org/artist/${mbid}` },
    [fields.artist.type]: { select: { name: artistType(artist.type, artist.name) } },
    [fields.artist.region]: richText(artist.area?.name || artist.country || ""),
    [fields.artist.activeYears]: richText(span), [fields.artist.bio]: richText(`Basic metadata for ${artist.name} comes from MusicBrainz.`),
    [fields.artist.addedBy]: { people },
  }); return created.id;
}

async function schemaForLibrary(env: WorkerEnv): Promise<Schema> {
  for (const fields of schemaCandidates(env)) {
    try {
      await query(env, env.ALBUM_DATA_SOURCE_ID, { property: fields.album.musicBrainzId, rich_text: { is_not_empty: true } }, 1);
      return fields;
    } catch { /* The library uses another supported schema. */ }
  }
  throw new Error("The album database does not match the English or legacy schema");
}

async function importSelectedMatch(env: WorkerEnv, fields: Schema, match: MbMatch) {
  if (!match.artistId) throw new Error("MusicBrainz did not return an artist for this album");
  const duplicate = await query(env, env.ALBUM_DATA_SOURCE_ID, { property: fields.album.musicBrainzId, rich_text: { equals: match.id } });
  const existing = duplicate.results?.[0];
  if (existing) return { id: existing.id, alreadyExists: true };

  const cover = await chooseCover("", match.id);
  // The MusicBrainz lookup that produced this match may have happened just
  // before this request. Pause before the artist lookup to respect its rate limit.
  await sleep(1100);
  const artistId = await ensureArtist(env, fields, match.artistId, match.artist, []);
  const created = await createPage(env, env.ALBUM_DATA_SOURCE_ID, {
    [fields.album.title]: title(match.title), [fields.album.artist]: { relation: [{ id: artistId }] },
    [fields.album.musicBrainzId]: richText(match.id), [fields.album.musicBrainzUrl]: { url: `https://musicbrainz.org/release-group/${match.id}` },
    [fields.album.sourceUrl]: { url: `https://musicbrainz.org/release-group/${match.id}` },
    [fields.album.releaseDate]: match.firstReleaseDate ? { date: { start: match.firstReleaseDate } } : { date: null },
    [fields.album.type]: { select: { name: albumType(match.primaryType) } },
    [fields.album.status]: { select: { name: fields.values.wantToListen } },
    [fields.album.priority]: { select: { name: fields.values.mediumPriority } },
    [fields.album.reason]: richText(""), [fields.album.addedBy]: { people: [] },
    ...(cover ? { [fields.album.cover]: { files: [{ type: "external", name: "cover.jpg", external: { url: cover } }] } } : {}),
  }, cover);
  return { id: created.id, alreadyExists: false };
}

async function importMatch(env: WorkerEnv, fields: Schema, quick: Page, match: MbMatch, apple: AppleAlbum | null, sourceUrl: string, userConfirmed = false) {
  const duplicate = await query(env, env.ALBUM_DATA_SOURCE_ID, { property: fields.album.musicBrainzId, rich_text: { equals: match.id } });
  let albumId = duplicate.results?.[0]?.id;
  const albumTitle = match.title || apple?.title || "";
  const artistName = match.artist || apple?.artist || "";
  const releaseDate = match.firstReleaseDate || apple?.releaseDate || "";
  const type = match.primaryType || apple?.collectionType || "Album";
  const cover = await chooseCover(apple?.artwork ?? "", match.id);
  if (!albumId) {
    const people = quick.properties[fields.quick.submittedBy]?.people ?? [];
    const artistId = await ensureArtist(env, fields, match.artistId, artistName, people);
    const properties: Record<string, unknown> = {
      [fields.album.title]: title(albumTitle), [fields.album.artist]: { relation: [{ id: artistId }] },
      [fields.album.musicBrainzId]: richText(match.id), [fields.album.musicBrainzUrl]: { url: `https://musicbrainz.org/release-group/${match.id}` },
      [fields.album.sourceUrl]: { url: sourceUrl || `https://musicbrainz.org/release-group/${match.id}` },
      [fields.album.releaseDate]: releaseDate ? { date: { start: releaseDate } } : { date: null },
      [fields.album.type]: { select: { name: albumType(type) } },
      [fields.album.status]: { select: { name: selectValue(quick.properties[fields.quick.targetStatus]) || fields.values.wantToListen } },
      [fields.album.priority]: { select: { name: selectValue(quick.properties[fields.quick.priority]) || fields.values.mediumPriority } },
      [fields.album.reason]: richText(textValue(quick.properties[fields.quick.reason])), [fields.album.addedBy]: { people },
      ...(cover ? { [fields.album.cover]: { files: [{ type: "external", name: "cover.jpg", external: { url: cover } }] } } : {}),
    };
    const created = await createPage(env, env.ALBUM_DATA_SOURCE_ID, properties, cover); albumId = created.id;
  } else if (apple) {
    // Refresh imported metadata from the authoritative Apple source without
    // touching personal status, priority, notes, or listening history.
    await patchPage(env, albumId, {
      [fields.album.title]: title(albumTitle), [fields.album.sourceUrl]: { url: sourceUrl },
      [fields.album.releaseDate]: releaseDate ? { date: { start: releaseDate } } : { date: null },
      [fields.album.type]: { select: { name: albumType(type) } },
      ...(cover ? { [fields.album.cover]: { files: [{ type: "external", name: "cover.jpg", external: { url: cover } }] } } : {}),
    }, cover);
  }
  await patchPage(env, quick.id, {
    [fields.quick.processStatus]: { select: { name: fields.values.imported } },
    [fields.quick.importedAlbum]: { relation: [{ id: albumId }] }, [fields.quick.confirm]: { checkbox: false },
    [fields.quick.matchedTitle]: richText(albumTitle), [fields.quick.matchedArtist]: richText(artistName),
    [fields.quick.matchedYear]: { number: Number(releaseDate.slice(0, 4)) || null },
    [fields.quick.matchedMusicBrainz]: { url: `https://musicbrainz.org/release-group/${match.id}` },
    [fields.quick.matchNote]: richText(duplicate.results?.[0]
      ? "Linked to an album already in the library."
      : userConfirmed ? "Imported using the confirmed MusicBrainz candidate." : "Imported automatically after a unique title and artist match."),
  });
}

async function processPage(env: WorkerEnv, id: string) {
  const quick = await getPage(env, id);
  const fields = schemaForPage(env, quick.properties);
  if (normId(quick.parent.data_source_id ?? "") !== normId(env.QUICK_IMPORT_DATA_SOURCE_ID)) return;
  const state = selectValue(quick.properties[fields.quick.processStatus]);
  if ([fields.values.imported, fields.values.ignored].includes(state)) return;
  const titleInput = textValue(quick.properties[fields.quick.title]);
  const mbInput = urlValue(quick.properties[fields.quick.musicBrainzUrl]) || (/musicbrainz\.org\/release-group\//i.test(titleInput) ? titleInput : "");
  const appleInput = urlValue(quick.properties[fields.quick.appleUrl]) || (/music\.apple\.com\//i.test(titleInput) ? titleInput : "");
  const confirmed = quick.properties[fields.quick.confirm]?.checkbox === true;
  const confirmedCandidateId = confirmed
    ? releaseGroupId(urlValue(quick.properties[fields.quick.matchedMusicBrainz]))
    : null;
  let album = appleInput || mbInput ? "" : titleInput;
  let artist = textValue(quick.properties[fields.quick.artist]);
  let apple: AppleAlbum | null = null;
  try {
    let match: MbMatch | null = null;
    // Apple Music is the primary metadata source. Resolve it before deciding
    // whether MusicBrainz comes from a direct/confirmed ID or from search.
    if (appleInput) {
      apple = await appleLookup(appleInput);
      if (!apple) throw new Error("The Apple Music URL did not resolve to an album");
      album = apple.title; artist = apple.artist || artist;
    }
    // An explicit URL always wins. Otherwise, confirmation accepts the
    // candidate previously written to the match field.
    const directId = releaseGroupId(mbInput) || confirmedCandidateId;
    if (directId) match = await mbById(directId);
    else {
      if (!album) throw new Error("Enter an Apple Music URL or an album title");
      const candidates = await mbSearch(album, artist); match = reliableMatch(album, artist, candidates);
      if (!match) {
        const top = candidates[0];
        await patchPage(env, id, {
          [fields.quick.processStatus]: { select: { name: fields.values.needsConfirmation } },
          [fields.quick.matchedTitle]: richText(top?.title ?? ""),
          [fields.quick.matchedArtist]: richText(top?.artist ?? ""),
          [fields.quick.matchedYear]: { number: Number(top?.firstReleaseDate.slice(0, 4)) || null },
          [fields.quick.matchedMusicBrainz]: { url: top ? `https://musicbrainz.org/release-group/${top.id}` : null },
          [fields.quick.matchNote]: richText(top
            ? `Candidate: ${top.title} — ${top.artist} (${top.firstReleaseDate.slice(0, 4) || "year unknown"}). Check “Confirm import” if it is correct.`
            : confirmed
              ? "There is no candidate to confirm. Paste the correct Release Group URL into the MusicBrainz URL field."
              : "MusicBrainz did not return a reliable candidate."),
        }); return;
      }
    }
    await importMatch(env, fields, quick, match, apple, appleInput || mbInput, Boolean(confirmedCandidateId));
  } catch (error) {
    await patchPage(env, id, {
      [fields.quick.processStatus]: { select: { name: fields.values.failed } },
      [fields.quick.matchNote]: richText(error instanceof Error ? error.message : "Unknown error"),
    });
    throw error;
  }
}

async function poll(env: WorkerEnv) {
  const pages = new Map<string, Page>();
  for (const fields of schemaCandidates(env)) {
    try {
      const result = await query(env, env.QUICK_IMPORT_DATA_SOURCE_ID, { or: [
        { property: fields.quick.processStatus, select: { is_empty: true } },
        { property: fields.quick.processStatus, select: { equals: fields.values.pending } },
        { property: fields.quick.processStatus, select: { equals: fields.values.failed } },
        { and: [
          { property: fields.quick.processStatus, select: { equals: fields.values.needsConfirmation } },
          { property: fields.quick.confirm, checkbox: { equals: true } },
        ] },
      ] });
      for (const page of result.results ?? []) pages.set(page.id, page);
    } catch { /* The database uses the other built-in language schema. */ }
  }
  for (const page of [...pages.values()].slice(0, 20)) {
    try { await processPage(env, page.id); }
    catch (error) { console.error(JSON.stringify({ event: "poll_item_failed", pageId: page.id, error: String(error) })); }
  }
}

async function verifySignature(raw: string, signature: string, token: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = `sha256=${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("")}`;
  return secretEquals(expected, signature);
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && ["/", "/search"].includes(url.pathname)) {
      const suppliedToken = url.searchParams.get("token") ?? "";
      const requestedEmbedAccess = url.searchParams.has("token");
      const embeddedSearch = requestedEmbedAccess && await validSearchEmbedToken(suppliedToken, env);
      if (requestedEmbedAccess && !embeddedSearch) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
      return searchPage(embeddedSearch);
    }
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "notion-music-importer" });
    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      const suppliedSetupKey = request.headers.get("x-setup-key") ?? "";
      const suppliedSearchToken = request.headers.get("x-search-embed-token") ?? "";
      const [hasSetupAccess, hasSearchAccess] = await Promise.all([
        secretEquals(suppliedSetupKey, env.SETUP_KEY), validSearchEmbedToken(suppliedSearchToken, env),
      ]);
      if (url.pathname === "/api/session") {
        if (!hasSetupAccess) return json({ error: "invalid library key" }, 403);
        return json({ ok: true });
      }
      const embedAllowedPath = ["/api/search", "/api/import"].includes(url.pathname);
      if (embedAllowedPath && !hasSetupAccess && !hasSearchAccess) return json({ error: "invalid library token" }, 403);
      if (!embedAllowedPath && !hasSetupAccess) return json({ error: "invalid library key" }, 403);
      try {
        const body = await readApiBody(request);
        if (url.pathname === "/api/search") {
          const album = stringField(body, "album", 200);
          const artist = stringField(body, "artist", 200);
          if (album.length < 2) return json({ error: "enter at least two characters" }, 400);
          const results = await mbSearch(album, artist);
          return json({ results });
        }
        if (url.pathname === "/api/import") {
          const id = releaseGroupId(stringField(body, "releaseGroupId", 100));
          if (!id) return json({ error: "invalid MusicBrainz release group" }, 400);
          const [fields, match] = await Promise.all([schemaForLibrary(env), mbById(id)]);
          return json(await importSelectedMatch(env, fields, match));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "request failed";
        console.error(JSON.stringify({ event: "search_ui_request_failed", path: url.pathname, error: message }));
        const status = message === "payload too large" ? 413 : 502;
        return json({ error: message === "payload too large" ? message : url.pathname === "/api/import" ? importErrorMessage(error) : "Search could not be completed" }, status);
      }
      return json({ error: "not found" }, 404);
    }
    if (request.method === "POST" && url.pathname === "/refresh-existing") {
      const supplied = request.headers.get("x-setup-key") ?? "";
      if (!(await secretEquals(supplied, env.SETUP_KEY))) return json({ error: "invalid setup key" }, 403);
      return json(await refreshExistingAlbums(env));
    }
    if (request.method === "GET" && url.pathname === "/verification-token") {
      if (!(await secretEquals(url.searchParams.get("setup") ?? "", env.SETUP_KEY))) return json({ error: "invalid setup key" }, 403);
      const token = await env.WEBHOOK_STATE.get("notion_verification_token");
      return token ? json({ verification_token: token }) : json({ error: "verification token not received yet" }, 404);
    }
    if (request.method !== "POST" || url.pathname !== "/notion-webhook") return json({ error: "not found" }, 404);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 256_000) return json({ error: "payload too large" }, 413);
    const { text: raw, truncated } = await readTextLimited(request.body, 256_000);
    if (truncated) return json({ error: "payload too large" }, 413);
    let event: WebhookEvent; try { event = JSON.parse(raw) as WebhookEvent; } catch { return json({ error: "invalid json" }, 400); }
    if (event.verification_token) {
      if (!(await secretEquals(url.searchParams.get("setup") ?? "", env.SETUP_KEY))) return json({ error: "invalid setup key" }, 403);
      await env.WEBHOOK_STATE.put("notion_verification_token", event.verification_token); console.log(JSON.stringify({ event: "verification_token_received" }));
      return json({ received: true, verification_token: event.verification_token });
    }
    const token = await env.WEBHOOK_STATE.get("notion_verification_token"); const signature = request.headers.get("x-notion-signature") ?? "";
    if (!token || !signature || !(await verifySignature(raw, signature, token))) return json({ error: "invalid signature" }, 401);
    if (["page.created", "page.properties_updated"].includes(event.type ?? "") && event.entity?.type === "page" && event.entity.id) ctx.waitUntil(processPage(env, event.entity.id));
    return json({ accepted: true }, 202);
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> { ctx.waitUntil(poll(env)); },
} satisfies ExportedHandler<WorkerEnv>;
