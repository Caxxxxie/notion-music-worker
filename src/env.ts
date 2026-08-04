export type WorkerSecrets = {
  NOTION_TOKEN: string;
  SETUP_KEY: string;
  SEARCH_EMBED_TOKEN?: string;
  FIELD_MAP_JSON?: string;
};

// Wrangler generates configured bindings; classic Worker secrets are declared here by name only.
export type WorkerEnv = Env & WorkerSecrets;
