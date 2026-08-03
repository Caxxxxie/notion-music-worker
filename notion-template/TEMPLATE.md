# Notion schema reference

For the ready-to-use installer, start with [README.md](README.md). The tables below document the exact schema created by `npm run setup:notion` and remain useful for manual setup or troubleshooting.

Create one page called **Music Library** and enable **Full width**. Add these databases below it.

## 1. Quick Import

Use a form view as the default input view. Only show `Album`, `Artist`, `Apple Music URL`, `MusicBrainz URL`, `Target status`, `Priority`, `Why add it`, and `Confirm import`.

| Property | Type | Options |
| --- | --- | --- |
| Album | Title | — |
| Artist | Text | — |
| Apple Music URL | URL | — |
| MusicBrainz URL | URL | — |
| Target status | Select | Want to listen, Listening, Listened |
| Priority | Select | High, Medium, Low |
| Why add it | Text | — |
| Confirm import | Checkbox | — |
| Import status | Select | Pending, Needs confirmation, Imported, Ignored, Failed |
| Imported album | Relation | Albums database |
| Submitted by | Person | — |
| Matched album | Text | — |
| Matched artist | Text | — |
| Matched year | Number | — |
| MusicBrainz match | URL | — |
| Match note | Text | — |

## 2. Albums

Use a gallery view named **Covers**, with `Cover` as the card preview. Add a table view for editing.

| Property | Type | Options |
| --- | --- | --- |
| Album | Title | — |
| Artist | Relation | Artists database |
| MusicBrainz ID | Text | — |
| MusicBrainz | URL | — |
| Source URL | URL | — |
| Release date | Date | — |
| Type | Select | Album, EP, Single |
| Status | Select | Want to listen, Listening, Listened |
| Priority | Select | High, Medium, Low |
| Genre | Multi-select | Add colored tags as needed |
| Notes | Text | — |
| Added by | Person | — |
| Cover | Files & media | — |

## 3. Artists

Use a gallery or list view. The `Albums` reciprocal relation can be shown on artist pages.

| Property | Type | Options |
| --- | --- | --- |
| Name | Title | — |
| MusicBrainz ID | Text | — |
| MusicBrainz | URL | — |
| Type | Select | Solo, Band, Various Artists |
| Country / region | Text | — |
| Active years | Text | — |
| Genre | Multi-select | Add colored tags as needed |
| Profile | Text | — |
| Added by | Person | — |
| Albums | Relation | Albums database |

The Worker depends on the exact English property names above unless `FIELD_MAP_JSON` supplies a custom mapping.
