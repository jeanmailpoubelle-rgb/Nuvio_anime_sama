# Architecture and contracts

## Shared implementation

| File | Responsibility |
| --- | --- |
| `config.json`, `src/config.js` | Single site default, validation and runtime overrides |
| `src/url.js`, `src/ids.js` | Relative source paths, safe HTTP URLs and version-locked episode identities |
| `src/js-data.js` | Literal JS tokens, sparse player arrays, known calls, dictionary decoding; no eval |
| `src/pages.js` | Catalog, detail, season, episode labels and ordered language union |
| `src/provider.js` | Catalog/search/details/episodes/streams and fresh discovery |
| `src/cache.js`, `src/concurrency.js`, `src/http.js` | LRU/TTL, shared in-flight work, per-caller cancellation, bounded requests |
| `src/extractors/player-pages.js` | Generic/JWPlayer configuration, subtitles and safe redirects |
| `src/extractors/voe.js` | CloudStream VOE F7 text decoder |
| `src/extractors/hls.js`, `mp4.js` | Manifest metadata and bounded MP4 header parsing |
| `src/extractors/dispatcher.js` | Host routing, independent deadlines, validation and header inheritance |
| `src/streams.js` | Accurate labels, structured metadata, deduplication and addon header hints |
| `src/native.js` | Nuvio getStreams/onSettings and conservative/explicit TMDB mapping |
| `src/addon.js`, `src/server.js` | Addon HTTP resources and local native artifact hosting |

## Nuvio native plugin

The current upstream `PluginManifestParser` expects an object with `name`, `version`
and nonempty `scrapers`, not the older array-only template. The root manifest uses
that current format. `filename` is relative to its manifest location. The static
native bundle is CommonJS, externally requiring only Nuvio's `cheerio` shim.
Its async functions are transpiled into Promise/generator code for older engines.

The app wraps the module, injects `SCRAPER_SETTINGS`/`TMDB_API_KEY`, then calls
`getStreams(id, mediaType, season, episode)`. Settings use `onSettings()` and the
app's `text`/`select` layout schema. Current upstream creates a fresh JS runtime
per invocation; module-global caches cannot persist across native selections.
The companion server's provider and caches persist for that server process.

The native parser retains name/title, quality, language, provider, type, headers
and subtitle objects `{url, language, name?, headers?}`. It ignores unknown metadata
fields. The plugin therefore includes known codec/video-range details in its name
as well as structured extension fields. Native headers become the app's playback
request headers. No `Range` probe header is copied to playback.

The app has a 60 s plugin-level timeout. Our stream resolver has its own shorter
request/host/overall budgets and a success collection window. Its fetch bridge
currently buffers at most 1 MiB per fetch and does not forward AbortSignal. The
bounded Sendvid probe requests 64 KiB and only inspects that prefix, but on a native
bridge that ignores Range the bridge may buffer up to its own cap first. Node's
stream reader cancels at 64 KiB even if Range is ignored. No whole film is downloaded.

## Catalog addon

`GET /manifest.json` declares catalog/meta/stream resources and `as:` IDs.
The full-content catalog uses `series` cards, including named films. This avoids
per-card detail requests just to distinguish single films from multi-film groups.
A standalone film is a single selectable video; groups remain in website order.

Resources:

```text
/catalog/series/as-all/search=Jujutsu&skip=0.json
/catalog/series/as-vf/skip=48.json
/meta/series/as%3Ajujutsu-kaisen.json
/stream/series/<encoded-episode-id>.json
```

The native repository is served at `/plugin/manifest.json` with its bundle at
`/plugin/providers/anime-sama.js`. These are separate install contracts.
CORS and JSON MIME types are supplied; stream responses prohibit HTTP caching.
Playback headers also populate `behaviorHints.proxyHeaders.request`, which current
Nuvio reads for addon streams. External subtitles retain their own request headers.

A locked VF/VOSTFR metadata response uses the union of real source episode slots,
then filters playback references by track. Missing track entries remain unavailable
and never play the opposite version. There is no synthetic episode count for an
unreadable group. Movie/TV classification and episode release dates are not guessed.

## Request review

The fast path uses retained script context instead of repeating search, details or
season discovery. The JS query suffix is retained, with no-cache request headers
on fresh discovery. Normal network redirects are handled by fetch. Known player
alias JS redirects are traversed only on pages explicitly titled Redirect, at
most three fetched pages. VOE fallback reuses fetched HTML instead of downloading
the same page through a second extractor. Packed scripts are decoded as text.

HLS mirrors are tried until one works. A master is fetched once; the best variant
is validated, with one alternative if that fails. The same response supplies
quality, codecs, VIDEO-RANGE and explicit language tags. No metadata-only request
is made on the playback path. Masters retain their rendition associations. If only a lower variant validates and
there are no external rendition groups, return that validated variant directly.

Metadata and version data have bounded TTL caches; fresh playback discovery uses
only in-flight coalescing. Cache keys include the configured origin. Signed URLs,
media responses, cookies and host embed pages are not persisted. Duplicate filtering
includes version and playback headers to avoid merging incompatible choices.

## Maintenance risks

The site can change `panneauAnime`, literal `epsN` arrays, `episodes.js`, episode-label
calls, catalog selectors or group ordering. Host config/packing/VOE F7 can also
change independently. Newly introduced authenticated/challenged/browser-only hosts
need a specific extractor; there is no page-JS execution or challenge solver.
TMDB episode organization can differ from source sagas: prefer addon IDs or explicit
mappings. Updating Nuvio's bridge may require refreshing runtime fixtures and field
mapping. A single domain setting fixes origin changes, not changed website markup.
