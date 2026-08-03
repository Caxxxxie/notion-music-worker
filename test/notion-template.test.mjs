import test from "node:test";
import assert from "node:assert/strict";
import { albumProperties, artistProperties, dryRunPlan, normalizeNotionId, quickImportProperties } from "../scripts/setup-notion.mjs";

test("extracts a Notion page ID from a page URL", () => {
  assert.equal(
    normalizeNotionId("https://www.notion.so/Music-Library-0123456789abcdef0123456789abcdef?pvs=4"),
    "01234567-89ab-cdef-0123-456789abcdef",
  );
});

test("creates the exact English schemas expected by the Worker", () => {
  assert.deepEqual(Object.keys(artistProperties()), [
    "Name", "MusicBrainz ID", "MusicBrainz", "Type", "Country / region",
    "Active years", "Genre", "Profile", "Added by",
  ]);
  assert.equal(albumProperties("artists").Artist.relation.data_source_id, "artists");
  assert.equal(quickImportProperties("albums")["Imported album"].relation.data_source_id, "albums");
  assert.equal(quickImportProperties("albums")["Import status"].type, "select");
});

test("builds a dry-run installation plan without credentials", () => {
  const plan = dryRunPlan("01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(plan.apiVersion, "2026-03-11");
  assert.equal(plan.databases.albums.Artist.relation.data_source_id, "ARTIST_DATA_SOURCE_ID");
});
