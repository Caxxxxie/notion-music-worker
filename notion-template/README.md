# Install the Notion template

The Markdown file creates the parent page; the setup command creates the database schemas and relations that a file import cannot preserve.

1. In Notion, choose **Settings** > **Import** > **Text & Markdown** and import `Music Library.md`.
2. Share the imported page with the same Notion integration used by the Worker. The integration needs read, insert, and update content capabilities.
3. Copy `.dev.vars.example` to `.dev.vars` and put the integration token in `NOTION_TOKEN`. `.dev.vars` is ignored by Git.
4. Copy the imported page's Notion URL.
5. From the project directory, run:

```bash
npm run setup:notion -- --parent-page "PASTE_NOTION_PAGE_URL_HERE"
```

The command creates:

- **Quick Import**, including an **Add an album** form.
- **Albums**, including an artist relation and **Covers** gallery.
- **Artists**, including the reciprocal album relation and **Directory** list.
- Every field and select option expected by the Worker.

## Embed interactive search

After the Worker is deployed, open the imported **Music Library** page and replace the placeholder under **Interactive search** with an Embed block. Paste your own Worker URL with `/search`, for example:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/search
```

The embedded page asks for the same `SETUP_KEY` configured for the Worker. It searches MusicBrainz as you type and creates the chosen album in the existing library. The Worker allows Notion domains to frame this page, but the template cannot include a working URL in advance because each deployment has its own subdomain.

At the end, the command prints the three data source IDs to place in the ignored `wrangler.jsonc` file. The installer never prints or writes the Notion token.

Notion currently creates form questions automatically but does not expose question visibility through its API. Open the **Add an album** form once and keep these questions visible: `Album`, `Artist`, `Apple Music URL`, `MusicBrainz URL`, `Target status`, `Priority`, `Why add it`, and `Confirm import`. Hide the remaining Worker-managed fields for a cleaner form.

To inspect the generated schemas without contacting Notion, add `--dry-run`.
