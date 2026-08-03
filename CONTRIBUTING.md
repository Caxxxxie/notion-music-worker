# Contributing

Thanks for helping improve Notion Music Importer.

## Development setup

1. Install Node.js 22 or newer.
2. Run `npm ci`.
3. Copy `wrangler.example.jsonc` to the ignored `wrangler.jsonc` and replace its placeholders.
4. Run `npm run types` after changing bindings or configuration.

Before opening a pull request, run:

```bash
npm test
npm run check
npm run deploy:dry
```

Keep changes focused and include tests for parsing, matching, or template behavior. Never commit Notion tokens, setup keys, data source IDs, KV namespace IDs, `.dev.vars`, or `wrangler.jsonc`.

## Pull requests

Describe the user-facing behavior, note any configuration changes, and include the commands used to verify the change. By contributing, you agree that your work is licensed under the MIT License.
