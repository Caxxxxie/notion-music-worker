import legacyFieldMap from "../config/legacy-field-map.json" with { type: "json" };
import type { WorkerEnv } from "./env";

export type Schema = {
  quick: {
    title: string; artist: string; appleUrl: string; musicBrainzUrl: string;
    targetStatus: string; priority: string; reason: string; confirm: string;
    processStatus: string; importedAlbum: string; submittedBy: string;
    matchedTitle: string; matchedArtist: string; matchedYear: string;
    matchedMusicBrainz: string; matchNote: string;
  };
  album: {
    title: string; artist: string; musicBrainzId: string; musicBrainzUrl: string;
    sourceUrl: string; releaseDate: string; type: string; status: string;
    priority: string; reason: string; addedBy: string; cover: string;
  };
  artist: {
    name: string; musicBrainzId: string; musicBrainzUrl: string; type: string;
    region: string; activeYears: string; bio: string; addedBy: string;
  };
  values: {
    pending: string; needsConfirmation: string; imported: string; ignored: string;
    failed: string; wantToListen: string; mediumPriority: string;
  };
};

export const ENGLISH_SCHEMA: Schema = {
  quick: {
    title: "Album", artist: "Artist", appleUrl: "Apple Music URL",
    musicBrainzUrl: "MusicBrainz URL", targetStatus: "Target status",
    priority: "Priority", reason: "Why add it", confirm: "Confirm import",
    processStatus: "Import status", importedAlbum: "Imported album",
    submittedBy: "Submitted by", matchedTitle: "Matched album",
    matchedArtist: "Matched artist", matchedYear: "Matched year",
    matchedMusicBrainz: "MusicBrainz match", matchNote: "Match note",
  },
  album: {
    title: "Album", artist: "Artist", musicBrainzId: "MusicBrainz ID",
    musicBrainzUrl: "MusicBrainz", sourceUrl: "Source URL",
    releaseDate: "Release date", type: "Type", status: "Status",
    priority: "Priority", reason: "Notes", addedBy: "Added by", cover: "Cover",
  },
  artist: {
    name: "Name", musicBrainzId: "MusicBrainz ID", musicBrainzUrl: "MusicBrainz",
    type: "Type", region: "Country / region", activeYears: "Active years",
    bio: "Profile", addedBy: "Added by",
  },
  values: {
    pending: "Pending", needsConfirmation: "Needs confirmation",
    imported: "Imported", ignored: "Ignored", failed: "Failed",
    wantToListen: "Want to listen", mediumPriority: "Medium",
  },
};

export const LEGACY_SCHEMA = legacyFieldMap as Schema;

function customSchema(env: WorkerEnv): Schema | null {
  if (!env.FIELD_MAP_JSON) return null;
  const overrides = JSON.parse(env.FIELD_MAP_JSON) as Partial<Schema>;
  return {
    ...ENGLISH_SCHEMA,
    ...overrides,
    quick: { ...ENGLISH_SCHEMA.quick, ...overrides.quick },
    album: { ...ENGLISH_SCHEMA.album, ...overrides.album },
    artist: { ...ENGLISH_SCHEMA.artist, ...overrides.artist },
    values: { ...ENGLISH_SCHEMA.values, ...overrides.values },
  };
}

export function schemaFor(env: WorkerEnv): Schema {
  return customSchema(env) ?? ENGLISH_SCHEMA;
}

export function schemaCandidates(env: WorkerEnv): Schema[] {
  const custom = customSchema(env);
  return custom ? [custom] : [ENGLISH_SCHEMA, LEGACY_SCHEMA];
}

export function schemaForPage(env: WorkerEnv, properties: Record<string, unknown>): Schema {
  return schemaCandidates(env).find(candidate =>
    candidate.quick.title in properties && candidate.quick.processStatus in properties,
  ) ?? schemaFor(env);
}
