# Notion Music Importer

A small, self-hosted Cloudflare Worker for a shared Notion music library. Paste an Apple Music album URL, a MusicBrainz Release Group URL, or an album and artist. The Worker finds clean MusicBrainz metadata, artwork, and artist information, then creates or links the album in Notion.

## What it does

- Processes Notion form submissions through a signed webhook.
- Uses a scheduled scan as a reliability fallback.
- Resolves Apple Music album URLs, including URLs with a song `?i=` parameter.
- Matches MusicBrainz Release Groups without guessing ambiguous results.
- Deduplicates artists and albums by MusicBrainz ID.
- Writes one cover image to both the Notion cover and `Cover` file property.
- Keeps tokens in Cloudflare secrets, never in source control.

## Notion template

Import [notion-template/Music Library.md](notion-template/Music%20Library.md), share the resulting page with your integration, and run the template installer. It creates the exact database schemas, relations, select options, intake form, cover gallery, and artist list expected by the Worker:

```bash
cp .dev.vars.example .dev.vars
# Put your Notion integration token in the ignored .dev.vars file.
npm run setup:notion -- --parent-page "PASTE_NOTION_PAGE_URL_HERE"
```

The command prints the three data source IDs needed in `wrangler.jsonc`. See [notion-template/README.md](notion-template/README.md) for the complete import flow or [notion-template/TEMPLATE.md](notion-template/TEMPLATE.md) for the exact schema reference.

## Deploy

Requirements: Node.js 22+, a free Cloudflare account, and a Notion integration with read, insert, and update content capabilities.

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler kv namespace create WEBHOOK_STATE
```

Put the returned KV namespace ID into `wrangler.jsonc`, then replace the three data source placeholders. Store secrets interactively:

```bash
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put SETUP_KEY
npm run types
npm test
npm run check
npm run deploy
```

`wrangler.jsonc` is intentionally ignored by Git. It remains the default configuration used by `wrangler dev`, `wrangler types`, and `wrangler deploy`, so local edits and future redeployments continue to use your live resource IDs without exposing them in commits. Only the placeholder-only `wrangler.example.jsonc` belongs in source control.

In the Notion integration's **Webhooks** tab, subscribe to `page.created` and `page.properties_updated` using:

```text
https://YOUR-WORKER.workers.dev/notion-webhook?setup=YOUR_SETUP_KEY
```

After Notion sends the verification request, open:

```text
https://YOUR-WORKER.workers.dev/verification-token?setup=YOUR_SETUP_KEY
```

Paste the returned token into Notion. Health check:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

## English and Chinese compatibility

The public template uses English field names. The Worker also automatically recognizes the original Chinese template for webhook events, scheduled scans, and existing-album refreshes. No migration is required.

For a different language or renamed properties, store a custom mapping based on `config/legacy-field-map.json`:

```bash
npx wrangler secret put FIELD_MAP_JSON < your-field-map.json
```

## Safe updates

Release ZIP files intentionally exclude `wrangler.jsonc`, `.dev.vars`, generated Worker types, local Wrangler state, and `node_modules`. Extracting a release over an existing project updates source, tests, and documentation without replacing resource IDs or local secrets. Secrets already stored with `wrangler secret put` remain attached to the deployed Worker.

After extraction, run:

```bash
npm install
npm test
npm run check
npx wrangler deploy --keep-vars
```

Do not commit `.dev.vars`, `wrangler.jsonc`, or any file containing tokens.

## Development

Run the same checks used by continuous integration:

```bash
npm ci
npm test
npm run types
npm run check
npm run deploy:dry
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

MIT
