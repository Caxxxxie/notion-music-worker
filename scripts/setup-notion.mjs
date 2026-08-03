#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_VERSION = "2026-03-11";

const property = {
  title: () => ({ type: "title", title: {} }),
  text: () => ({ type: "rich_text", rich_text: {} }),
  url: () => ({ type: "url", url: {} }),
  date: () => ({ type: "date", date: {} }),
  people: () => ({ type: "people", people: {} }),
  files: () => ({ type: "files", files: {} }),
  checkbox: () => ({ type: "checkbox", checkbox: {} }),
  number: () => ({ type: "number", number: { format: "number" } }),
  multiSelect: () => ({ type: "multi_select", multi_select: { options: [] } }),
  select: (options) => ({
    type: "select",
    select: { options: options.map(([name, color]) => ({ name, color })) },
  }),
  relation: (dataSourceId, syncedPropertyName) => syncedPropertyName
    ? {
        type: "relation",
        relation: {
          data_source_id: dataSourceId,
          type: "dual_property",
          dual_property: { synced_property_name: syncedPropertyName },
        },
      }
    : {
        type: "relation",
        relation: {
          data_source_id: dataSourceId,
          type: "single_property",
          single_property: {},
        },
      },
};

const STATUS_OPTIONS = [
  ["Want to listen", "blue"],
  ["Listening", "yellow"],
  ["Listened", "green"],
];

const PRIORITY_OPTIONS = [
  ["High", "red"],
  ["Medium", "yellow"],
  ["Low", "gray"],
];

export function artistProperties() {
  return {
    "Name": property.title(),
    "MusicBrainz ID": property.text(),
    "MusicBrainz": property.url(),
    "Type": property.select([["Solo", "blue"], ["Band", "purple"], ["Various Artists", "gray"]]),
    "Country / region": property.text(),
    "Active years": property.text(),
    "Genre": property.multiSelect(),
    "Profile": property.text(),
    "Added by": property.people(),
  };
}

export function albumProperties(artistDataSourceId) {
  return {
    "Album": property.title(),
    "Artist": property.relation(artistDataSourceId, "Albums"),
    "MusicBrainz ID": property.text(),
    "MusicBrainz": property.url(),
    "Source URL": property.url(),
    "Release date": property.date(),
    "Type": property.select([["Album", "blue"], ["EP", "purple"], ["Single", "orange"]]),
    "Status": property.select(STATUS_OPTIONS),
    "Priority": property.select(PRIORITY_OPTIONS),
    "Genre": property.multiSelect(),
    "Notes": property.text(),
    "Added by": property.people(),
    "Cover": property.files(),
  };
}

export function quickImportProperties(albumDataSourceId) {
  return {
    "Album": property.title(),
    "Artist": property.text(),
    "Apple Music URL": property.url(),
    "MusicBrainz URL": property.url(),
    "Target status": property.select(STATUS_OPTIONS),
    "Priority": property.select(PRIORITY_OPTIONS),
    "Why add it": property.text(),
    "Confirm import": property.checkbox(),
    "Import status": property.select([
      ["Pending", "gray"],
      ["Needs confirmation", "yellow"],
      ["Imported", "green"],
      ["Ignored", "default"],
      ["Failed", "red"],
    ]),
    "Imported album": property.relation(albumDataSourceId),
    "Submitted by": property.people(),
    "Matched album": property.text(),
    "Matched artist": property.text(),
    "Matched year": property.number(),
    "MusicBrainz match": property.url(),
    "Match note": property.text(),
  };
}

export function normalizeNotionId(value) {
  const match = String(value).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32}/i);
  if (!match) throw new Error("Expected a Notion page URL or 32-character page ID");
  const compact = match[0].replaceAll("-", "").toLowerCase();
  return [compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16), compact.slice(16, 20), compact.slice(20)].join("-");
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

function loadDevVars(filePath = resolve(".dev.vars")) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function notionRequest(token, path, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": API_VERSION,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${body.slice(0, 1_000)}`);
  return body ? JSON.parse(body) : null;
}

async function createDatabase(token, parentPageId, name, description, properties) {
  const database = await notionRequest(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: richText(name),
      description: richText(description),
      is_inline: true,
      initial_data_source: { properties },
    }),
  });
  const full = database.data_sources?.[0]?.id
    ? database
    : await notionRequest(token, `/databases/${database.id}`);
  const dataSourceId = full.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`Notion did not return a data source for ${name}`);
  console.log(`Created ${name}: ${dataSourceId}`);
  return { databaseId: database.id, dataSourceId };
}

async function createView(token, body) {
  return notionRequest(token, "/views", { method: "POST", body: JSON.stringify(body) });
}

function propertyId(dataSource, name) {
  const id = dataSource.properties?.[name]?.id;
  if (!id) throw new Error(`Missing property ${JSON.stringify(name)} in ${dataSource.id}`);
  return id;
}

function visibleProperties(dataSource, names) {
  return names.map((name) => ({ property_id: propertyId(dataSource, name), visible: true }));
}

async function createViews(token, resources) {
  const [quick, albums, artists] = await Promise.all([
    notionRequest(token, `/data_sources/${resources.quick.dataSourceId}`),
    notionRequest(token, `/data_sources/${resources.albums.dataSourceId}`),
    notionRequest(token, `/data_sources/${resources.artists.dataSourceId}`),
  ]);

  const viewRequests = [
    {
      label: "Quick Import form",
      body: {
        database_id: resources.quick.databaseId,
        data_source_id: resources.quick.dataSourceId,
        name: "Add an album",
        type: "form",
        configuration: {
          type: "form",
          is_form_closed: false,
          anonymous_submissions: false,
          submission_permissions: "none",
        },
      },
    },
    {
      label: "Albums gallery",
      body: {
        database_id: resources.albums.databaseId,
        data_source_id: resources.albums.dataSourceId,
        name: "Covers",
        type: "gallery",
        configuration: {
          type: "gallery",
          properties: visibleProperties(albums, ["Album", "Artist", "Status", "Priority", "Release date"]),
          cover: { type: "property", property_id: propertyId(albums, "Cover") },
          cover_size: "medium",
          cover_aspect: "cover",
          card_layout: "list",
        },
      },
    },
    {
      label: "Artists list",
      body: {
        database_id: resources.artists.databaseId,
        data_source_id: resources.artists.dataSourceId,
        name: "Directory",
        type: "list",
        configuration: {
          type: "list",
          properties: visibleProperties(artists, ["Name", "Type", "Country / region", "Active years"]),
        },
      },
    },
  ];

  for (const request of viewRequests) {
    try {
      const view = await createView(token, request.body);
      console.log(`Created ${request.label}: ${view.url ?? view.id}`);
    } catch (error) {
      console.warn(`Could not create ${request.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function dryRunPlan(parentPageId) {
  return {
    apiVersion: API_VERSION,
    parentPageId,
    databases: {
      artists: artistProperties(),
      albums: albumProperties("ARTIST_DATA_SOURCE_ID"),
      quickImport: quickImportProperties("ALBUM_DATA_SOURCE_ID"),
    },
  };
}

async function install(token, parentPageId) {
  const artists = await createDatabase(
    token,
    parentPageId,
    "Artists",
    "Artists linked to albums in the music library.",
    artistProperties(),
  );
  const albums = await createDatabase(
    token,
    parentPageId,
    "Albums",
    "Imported releases with MusicBrainz metadata and cover art.",
    albumProperties(artists.dataSourceId),
  );
  const quick = await createDatabase(
    token,
    parentPageId,
    "Quick Import",
    "Submit an Apple Music URL, MusicBrainz release group, or album and artist.",
    quickImportProperties(albums.dataSourceId),
  );

  const resources = { quick, albums, artists };
  await createViews(token, resources);

  const vars = {
    QUICK_IMPORT_DATA_SOURCE_ID: quick.dataSourceId,
    ALBUM_DATA_SOURCE_ID: albums.dataSourceId,
    ARTIST_DATA_SOURCE_ID: artists.dataSourceId,
  };
  console.log("\nAdd these values to the ignored wrangler.jsonc file:");
  console.log(JSON.stringify(vars, null, 2));
}

function usage() {
  return `Usage:
  npm run setup:notion -- --parent-page <NOTION_PAGE_URL_OR_ID>
  npm run setup:notion -- --parent-page <NOTION_PAGE_URL_OR_ID> --dry-run

The installer reads NOTION_TOKEN from the environment or the ignored .dev.vars file.`;
}

function parseArgs(argv) {
  let parentPage = "";
  let dryRun = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--parent-page" || argument === "--parent-page-id") parentPage = argv[++index] ?? "";
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--help" || argument === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parentPage) throw new Error("Missing --parent-page");
  return { parentPageId: normalizeNotionId(parentPage), dryRun, help: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.dryRun) {
    console.log(JSON.stringify(dryRunPlan(args.parentPageId), null, 2));
    return;
  }
  const localVars = loadDevVars();
  const token = process.env.NOTION_TOKEN || localVars.NOTION_TOKEN;
  if (!token || token === "REPLACE_WITH_NOTION_INTEGRATION_TOKEN") {
    throw new Error("Set NOTION_TOKEN in the environment or the ignored .dev.vars file");
  }
  await install(token, args.parentPageId);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
