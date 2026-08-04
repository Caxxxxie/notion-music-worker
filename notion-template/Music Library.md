# Music Library

A private library for albums you want to hear, are currently listening to, and have finished.

## Add music

Use the **Add an album** form after setup. Paste an Apple Music album URL, a MusicBrainz Release Group URL, or enter an album and artist.

## Interactive search

After deploying your Worker, add an Embed block here with your own `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/search?token=YOUR_SEARCH_EMBED_TOKEN` URL. The dedicated token unlocks search and adding selected albums automatically. Anyone who can view this page can copy the URL and add albums to the library.

## Browse

The setup command adds an album cover gallery, an artist directory, and the Quick Import database below this content.

## Notes

Status, priority, genre, and personal notes stay in Notion. Music metadata and cover art come from Apple Music and MusicBrainz.
