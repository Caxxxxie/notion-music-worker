const page = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Music Library Search</title>
  <style>
    :root { color: #18212b; background: #f4f5f2; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f4f5f2; }
    main { width: min(100% - 32px, 900px); margin: 0 auto; padding: 44px 0 64px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid #cfd7d2; }
    .eyebrow { margin: 0 0 7px; color: #0f766e; font-size: 0.78rem; font-weight: 750; letter-spacing: 0; text-transform: uppercase; }
    h1 { margin: 0; color: #18212b; font-size: 2rem; line-height: 1.05; font-weight: 760; letter-spacing: 0; }
    .connection { margin: 0; color: #596571; font-size: 0.9rem; text-align: right; }
    section { margin-top: 28px; }
    .access { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; padding: 18px; border: 1px solid #cfd7d2; border-radius: 6px; background: #ffffff; }
    label { display: grid; gap: 7px; color: #34404c; font-size: 0.85rem; font-weight: 680; }
    input { width: 100%; min-height: 42px; padding: 9px 11px; border: 1px solid #aeb9b2; border-radius: 4px; background: #ffffff; color: #18212b; font: inherit; outline: none; }
    input:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.16); }
    button { min-height: 42px; border: 1px solid #0f766e; border-radius: 4px; background: #0f766e; color: #ffffff; cursor: pointer; font: inherit; font-weight: 720; }
    button:hover { background: #0b5f59; }
    button:focus-visible, a:focus-visible { outline: 3px solid rgba(15, 118, 110, 0.32); outline-offset: 2px; }
    button:disabled { cursor: wait; opacity: 0.65; }
    .search-grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(180px, 1fr); gap: 14px; }
    .results-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin: 26px 0 10px; }
    h2 { margin: 0; color: #18212b; font-size: 1rem; font-weight: 740; letter-spacing: 0; }
    .status { min-height: 1.3rem; margin: 0; color: #596571; font-size: 0.88rem; text-align: right; }
    .status.error { color: #a32424; }
    .results { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .result { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; align-items: center; gap: 13px; min-height: 82px; padding: 10px; border: 1px solid #cfd7d2; border-radius: 6px; background: #ffffff; }
    .art { width: 58px; height: 58px; border-radius: 4px; background: #dce6df; object-fit: cover; }
    .details { min-width: 0; }
    .details h3 { overflow: hidden; margin: 0; color: #18212b; font-size: 1rem; font-weight: 720; letter-spacing: 0; text-overflow: ellipsis; white-space: nowrap; }
    .details p { overflow: hidden; margin: 4px 0 0; color: #596571; font-size: 0.88rem; text-overflow: ellipsis; white-space: nowrap; }
    .add { width: 36px; min-width: 36px; min-height: 36px; height: 36px; padding: 0; border-color: #a32424; border-radius: 50%; background: #a32424; font-size: 1.4rem; line-height: 1; }
    .add:hover { background: #821a1a; }
    .add.added { font-size: 0.7rem; }
    .empty { padding: 26px 0; color: #596571; font-size: 0.92rem; text-align: center; }
    [hidden] { display: none !important; }
    @media (max-width: 620px) {
      main { width: min(100% - 24px, 900px); padding-top: 28px; }
      header { display: block; }
      .connection { margin-top: 10px; text-align: left; }
      .access, .search-grid { grid-template-columns: 1fr; }
      .results-heading { align-items: start; flex-direction: column; gap: 3px; }
      .status { text-align: left; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">Personal music library</p>
        <h1>Find an album</h1>
      </div>
      <p id="connection" class="connection" aria-live="polite">Locked</p>
    </header>

    <section id="access-panel" class="access" aria-label="Library access">
      <label>Library key<input id="library-key" type="password" autocomplete="current-password" spellcheck="false"></label>
      <button id="unlock" type="button">Unlock</button>
    </section>

    <section id="search-panel" hidden>
      <div class="search-grid">
        <label>Album<input id="album" type="search" autocomplete="off" spellcheck="false" placeholder="Album title"></label>
        <label>Artist<input id="artist" type="search" autocomplete="off" spellcheck="false" placeholder="Optional"></label>
      </div>
      <div class="results-heading">
        <h2>Matches</h2>
        <p id="status" class="status" aria-live="polite"></p>
      </div>
      <ul id="results" class="results" aria-live="polite"></ul>
    </section>
  </main>
  <script>
    (() => {
      const keyInput = document.querySelector("#library-key");
      const unlock = document.querySelector("#unlock");
      const connection = document.querySelector("#connection");
      const accessPanel = document.querySelector("#access-panel");
      const searchPanel = document.querySelector("#search-panel");
      const albumInput = document.querySelector("#album");
      const artistInput = document.querySelector("#artist");
      const status = document.querySelector("#status");
      const results = document.querySelector("#results");
      let key = "";
      let searchTimer;
      let searchRequest;
      let lastSearchAt = 0;

      function setStatus(message, error = false) {
        status.textContent = message;
        status.classList.toggle("error", error);
      }

      async function api(path, body, signal) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", "x-setup-key": key },
          body: body ? JSON.stringify(body) : undefined,
          cache: "no-store",
          signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Request failed");
        return data;
      }

      function imageFor(id) {
        return "https://coverartarchive.org/release-group/" + encodeURIComponent(id) + "/front-250";
      }

      function render(matches) {
        results.replaceChildren();
        if (!matches.length) {
          const item = document.createElement("li");
          item.className = "empty";
          item.textContent = "No matching albums.";
          results.append(item);
          return;
        }
        for (const match of matches) {
          const item = document.createElement("li");
          item.className = "result";
          const image = document.createElement("img");
          image.className = "art";
          image.src = imageFor(match.id);
          image.alt = "";
          image.referrerPolicy = "no-referrer";
          image.addEventListener("error", () => { image.hidden = true; });
          const details = document.createElement("div");
          details.className = "details";
          const name = document.createElement("h3");
          name.textContent = match.title;
          const metadata = document.createElement("p");
          metadata.textContent = [match.artist, match.firstReleaseDate.slice(0, 4), match.primaryType].filter(Boolean).join(" / ");
          details.append(name, metadata);
          const add = document.createElement("button");
          add.className = "add";
          add.type = "button";
          add.textContent = "+";
          add.title = "Add to library";
          add.setAttribute("aria-label", "Add " + match.title + " to library");
          add.addEventListener("click", () => importMatch(match, add));
          item.append(image, details, add);
          results.append(item);
        }
      }

      async function search() {
        const album = albumInput.value.trim();
        const artist = artistInput.value.trim();
        if (album.length < 2) {
          results.replaceChildren();
          setStatus(album ? "Enter at least two characters." : "");
          return;
        }
        searchRequest?.abort();
        searchRequest = new AbortController();
        setStatus("Searching");
        try {
          const data = await api("/api/search", { album, artist }, searchRequest.signal);
          render(data.results || []);
          setStatus((data.results || []).length ? "" : "No results");
        } catch (error) {
          if (error.name === "AbortError") return;
          setStatus(error.message || "Search is unavailable.", true);
        }
      }

      function scheduleSearch() {
        clearTimeout(searchTimer);
        const wait = Math.max(450, 1100 - (Date.now() - lastSearchAt));
        searchTimer = setTimeout(() => {
          lastSearchAt = Date.now();
          search();
        }, wait);
      }

      async function importMatch(match, button) {
        button.disabled = true;
        setStatus("Adding " + match.title);
        try {
          const data = await api("/api/import", { releaseGroupId: match.id });
          button.textContent = "OK";
          button.classList.add("added");
          button.title = data.alreadyExists ? "Already in library" : "Added to library";
          button.setAttribute("aria-label", button.title);
          setStatus(data.alreadyExists ? "Already in your library." : "Added to your library.");
        } catch (error) {
          button.disabled = false;
          setStatus(error.message || "Could not add this album.", true);
        }
      }

      unlock.addEventListener("click", async () => {
        const supplied = keyInput.value;
        if (!supplied) { keyInput.focus(); return; }
        unlock.disabled = true;
        connection.textContent = "Checking access";
        key = supplied;
        try {
          await api("/api/session");
          keyInput.value = "";
          accessPanel.hidden = true;
          searchPanel.hidden = false;
          connection.textContent = "Ready";
          albumInput.focus();
        } catch (error) {
          key = "";
          connection.textContent = error.message || "Access denied";
          keyInput.focus();
        } finally {
          unlock.disabled = false;
        }
      });
      keyInput.addEventListener("keydown", event => { if (event.key === "Enter") unlock.click(); });
      albumInput.addEventListener("input", scheduleSearch);
      artistInput.addEventListener("input", scheduleSearch);
    })();
  </script>
</body>
</html>`;

export function searchPage(): Response {
  return new Response(page, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; connect-src 'self'; img-src https://coverartarchive.org data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
