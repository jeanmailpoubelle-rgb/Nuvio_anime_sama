# Anime-Sama for Nuvio

A standalone native Nuvio stream plugin **and** companion catalog addon, sharing
one Anime-Sama provider and extractor layer. Ported from the owner's CloudStream
Anime-Sama v6 implementation in `jeanmailpoubelle-rgb/cloudstream-source`.

Nuvio's native plugin contract is `getStreams(tmdbId, mediaType, season, episode)`.
It does not expose search, catalog, metadata or episode hooks. The companion addon
supplies those features through Nuvio's supported Stremio protocol. Both integrations
are implemented here; neither depends on a running CloudStream installation.

## Install the native plugin

1. Open **Nuvio → Settings → Plugins → Add repository**.
2. Paste this manifest URL:

   ```text
   https://raw.githubusercontent.com/jeanmailpoubelle-rgb/Nuvio_anime_sama/main/manifest.json
   ```

3. Refresh the repository and enable **Anime-Sama**.

The repository is public, so Nuvio can download the plugin directly from GitHub.
The plugin runs locally on your device: no Node installation or personal server
is required. Use a Nuvio build that supports native plugins.

The native plugin resolves streams for titles opened from Nuvio's existing
catalogs. To browse Anime-Sama's own search, catalogs and episode lists, use the
optional companion addon below.

## Run the companion catalog addon (optional)

The addon requires a reachable server running Node **22 or newer**:

```sh
npm ci
npm start
```

Under **Nuvio → Addons → Add addon**, add this URL, replacing `your-server` with
the machine running the addon:

```text
http://your-server:3000/manifest.json
```

The server must remain reachable for addon browsing and playback. The public
GitHub manifest above belongs under **Plugins**; this server URL belongs under
**Addons**. For local plugin development, the same server also serves the native
repository at `/plugin/manifest.json`.

`PORT` and `HOST` optionally change the listening socket. Use an HTTPS reverse
proxy for a remotely accessible installation. `/health` reports server readiness.
A production `Dockerfile` is also included:

```sh
docker build -t nuvio-anime-sama .
docker run --rm -p 3000:3000 nuvio-anime-sama
```

No content or media files are hosted by this repository.

## Change the Anime-Sama domain

For the native plugin, open **Anime-Sama's plugin settings** in Nuvio and edit
**Adresse du site Anime-Sama**. Save the new website home address; no source edit,
rebuild or server is needed. Leave the field empty to follow the bundled default.

For the companion addon, set the `ANIME_SAMA_BASE_URL` environment variable and
restart the server. Device settings and addon server overrides are independent.

To change the shared source default, edit **one value** in
[`config.json`](config.json):

```json
"animeSamaBaseUrl": "https://new-domain.example"
```

After changing that source default, restart the addon and run `npm run build`
before distributing the updated native bundle. The bundled copy is generated;
never edit it by hand. There are no other source copies of the current Anime-Sama
hostname.

Title and episode IDs contain relative paths and array positions, never the site
origin or signed playback URLs. Site requests, episode-script URLs, Referers and
cache namespaces derive from the configured base. Host playback Referer/Origin
intentionally refer to the actual host, not the Anime-Sama domain. External artwork
CDNs retain their own published URLs. Domain A → B regression tests verify this.

## Features and source behavior

- Search and paginated anime/VF catalogs; latest episodes, additions, classics,
  favorites and the Europe/Paris daily schedule.
- Source titles, descriptions, genres, artwork, year and website-order groups.
  Films, named film collections, OAVs, specials, Kai and continuous saga numbering
  keep their source ordering. Single films are selectable named videos within the
  source catalog's series cards, avoiding extra requests to classify every card.
- VF, VOSTFR and published VF1/VF2/VQC paths. VF catalog entries lock the French
  track; configuration can lock VOSTFR or VF globally. An unavailable track has an
  empty playback ID and makes no network requests. Known missing episode slots
  remain visible rather than shifting array positions or switching language.
- ANSEmbed, Smoothpre/compatible JWPlayer, Vidmoly, Sendvid, VOE F7 and compatible
  packed StreamWish pages. Unknown hosts can use the same safe generic player
  parser. Closed `sibnet.ru` hosts remain excluded, exactly as in CloudStream v6.
- Independent bounded extraction; failed/slow hosts cannot cancel healthy hosts.
  Mirrors are fallback routes; duplicate URLs with identical version/headers are
  removed. Different language or playback-header requirements remain distinct.
- Actual HLS/DASH validation, playback Referer/Origin/User-Agent, source subtitle
  tracks, and bounded Sendvid MP4 duration checks rejecting unavailable-video clips.

## Stream speed and metadata

An addon-selected episode stores its relative script path, language and zero-based
array index. Playback resolves as:

```text
selected episode ID
→ configured base + retained relative episodes.js path (fresh GET)
→ published URLs at the exact array position
→ up to four independent host extractors
→ embed GET → parse/decode → validate HLS master + one healthy variant
→ inherit metadata → deduplicate → playable streams
```

No search, title metadata or season-page reload occurs on that path. Older IDs
without a retained script perform one season-page discovery request. Fresh episode
data is coalesced across simultaneous callers; it is not reused as a signed-link
cache. Canceling one caller does not cancel another caller's shared discovery.
Metadata uses bounded LRU/TTL caches. Signed media URLs and host HTML are never
cached by the provider, and HTTP stream responses use `Cache-Control: no-store`.

The default budgets in `config.json` are 6 s per request, 8.5 s per host and 11 s
for stream resolution. Once one host succeeds, the provider collects other results
for up to 1.5 s, then cancels unfinished work. Thus a slower healthy host can be
omitted on a particular run; increase `successGraceMs` to favor completeness.
On current Nuvio, fetch ignores JS AbortSignal: timers still bound results and
prevent new stages, while the app cancels native requests when it destroys that
plugin runtime. Node/browser transports also abort their underlying requests.

Stream objects expose `provider`, `quality`, `language`, `type`, `headers`, and
real subtitle objects in Nuvio's supported fields. They additionally retain
`source`, `version`, `audioLanguages`, `subtitleLanguages`, `codecs`, `videoRange`
and available `qualities` for consumers that support them. The main line is short:
**Anime-Sama • VF • 1080p** or **Anime-Sama • VOSTFR • 720p**. Host, stream type,
adaptive status, codecs and video range appear in the smaller secondary text.
The native adapter uses Nuvio's string-valued caption slot for these details;
quality/language remain intact and no file size is invented. Addon responses use
their actual `description`/`title` fields. Masters with external audio/subtitle rendition groups stay intact. If the top
rendition is denied, a validated lower video variant without external groups can
be returned directly to avoid selecting that denied rendition again.

Quality is the maximum **validated** rendition; the secondary text labels adaptive
streams `Auto (qualité max)`.
Known source VF implies French audio; VOSTFR establishes French subtitle edition,
**not Japanese audio**. Burned-in edition subtitles are not invented downloadable
subtitle files. Unknown quality, audio, codec, HDR and subtitle tracks are omitted.
See [actual sanitized examples and performance](docs/PERFORMANCE.md).

## Native catalog matching

The native plugin accepts TMDB, IMDb and Kitsu anime-catalog IDs, including episode
suffixes. No manual mapping or hosted addon is required for ordinary catalog use.
TMDB/IMDb identities use the public [Nuvio Catalog](https://catalog.nuvio.tv/configure)
metadata endpoint, supplying title and season episodes together in one request.
This works with that addon installed, including its localized configurations.
If the service is unavailable, the resolver falls back to TMDB API/public metadata
or Cinemeta. Kitsu uses its public anime metadata. No API key is bundled.

Matching checks source titles **and the site's own aliases**, with compatible years.
Published episode numbers and declared saga ranges map continuous anime numbering;
a source/catalog count difference does not discard episodes that actually exist.
Missing versions remain unavailable, and ambiguous groups still fail safely.
Complex season splits can use an explicit mapping below.

After upgrading, open **Settings → Plugins**, refresh this repository and confirm
**Anime-Sama 1.0.3** is enabled, then reopen the episode. Repository tabs on the
stream screen only appear when that repository returns streams. If links remain
missing, enable **Diagnostic** in Anime-Sama's plugin settings to log the catalog ID,
matching stages and failure codes without signed links or credentials.

Versions 1.0.0/1.0.1 rejected the native URL bridge's empty `?` and `#` markers as
an invalid website address, before issuing any network request. Version 1.0.2
fixes this startup failure. Its regression check runs the exact pinned Nuvio URL
and DOM bridges in Kotlin QuickJS, as well as the deterministic JS tests.
The settings diagnostic toggle is now rendered correctly. Nuvio's **Tester le
fournisseur** uses The Matrix (TMDB 603), so zero streams there is expected for an
anime provider; verify with an actual anime episode.

One Piece S1 E1 VOSTFR is live verified through the automatic native path. Its
published VF episode-1 players returned HTTP 404 during that check; select VOSTFR
or Toutes les versions to use the working edition. The plugin never switches a
VF-only selection to VOSTFR silently.

For deterministic, faster native resolution, enter a **Correspondances TMDB (JSON)**
setting. This path skips TMDB, search, details and season discovery entirely:

```json
{
  "tv:95479": {
    "seasons": {
      "1": {
        "path": "/catalogue/jujutsu-kaisen/saison1/",
        "indexOffset": 0,
        "languages": ["vostfr", "vf"]
      }
    }
  },
  "movie:372058": {
    "group": "/catalogue/your-name/film/",
    "index": 0,
    "languages": ["vostfr", "vf"]
  }
}
```

For TV, array index = requested episode − 1 + `indexOffset`. For movies, `index`
is zero-based. Paths identify groups **without** a trailing language. These are
explicit source mappings, so verify their ordering when adding a saga or film.
Explicit Jujutsu S1 mapping and automatic One Piece/Jujutsu matching have separate
live checks. The native verification runs with empty settings, no manual mapping
and no injected key in QuickJS with the Nuvio 0.5.9-compatible bridge.

## Development and verification

```sh
npm run check                 # build + lint + deterministic tests
npm run test:live -- --output docs/LIVE-VERIFICATION.json
npm run test:native:live -- --output docs/NATIVE-VERIFICATION-1.0.2.json
npm run test:native:jvm -- --output docs/NATIVE-JVM-VERIFICATION-1.0.2.json
npm audit --omit=dev
```

The JVM test additionally requires Java 21 and Python 3. It downloads checksum-pinned
Kotlin/runtime dependencies and Nuvio source snapshots into ignored `.tmp/`.
It measures full native evaluation through callback completion and closes each
native runtime. No personal server is needed to install or use the plugin.

The live commands perform real upstream HTTP requests and bounded media samples.
It reports counts/timings/metadata without signed URLs or private state. Reports
are evidence of HTTP access, not Android/iOS device playback. Tests execute the
actual generated bundle in QuickJS with a pinned snapshot of Nuvio's runtime
polyfills, including its constrained Cheerio bridge.

- [Architecture, contracts and maintenance](docs/ARCHITECTURE.md)
- [CloudStream reuse and pinned references](docs/REFERENCES.md)
- [Performance, examples and known limitations](docs/PERFORMANCE.md)
- [Sanitized live HTTP results](docs/LIVE-VERIFICATION.json)
- [Current native JVM verification](docs/NATIVE-JVM-VERIFICATION-1.0.2.json)
- [Reproduced 1.0.1 startup failure](docs/NATIVE-JVM-REGRESSION-1.0.1.json)

Source: [`src/`](src/). Generated installable artifact:
[`providers/anime-sama.js`](providers/anime-sama.js). CI verifies it matches source.
All implementation, fixtures, documentation and build files live in this repository.
