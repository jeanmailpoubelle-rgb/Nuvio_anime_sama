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
| `src/native.js` | Nuvio getStreams/onSettings, source alias/episode mapping and safe diagnostics |
| `src/catalog-context.js` | Public Nuvio catalog identity + episodes, isolated TMDB/Cinemeta fallbacks and Kitsu identities |
| `src/runtime-fetch.js` | Nuvio bridge transport with lazy, bounded binary decoding; standard fetch fallback |
| `src/timers.js` | Shared short native sleeps; cancelable deadlines without long evaluation drain |
| `src/addon.js`, `src/server.js` | Addon HTTP resources and local native artifact hosting |

## Nuvio native plugin

The current upstream `PluginManifestParser` expects an object with `name`, `version`
and nonempty `scrapers`, not the older array-only template. The root manifest uses
that current format. `filename` is relative to its manifest location. The static
native bundle is CommonJS, externally requiring only Nuvio's `cheerio` shim.
Its async functions are transpiled into Promise/generator code for older engines.

The app wraps the module, injects `SCRAPER_SETTINGS`/`TMDB_API_KEY`, then calls
`getStreams(id, mediaType, season, episode)`. Settings use `onSettings()` and the
app's `info`/`text`/`select`/`toggle` layout schema. Current upstream creates a fresh JS runtime
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
stream reader cancels at 64 KiB even if Range is ignored. No whole film is downloaded. The optional bridge adapter uses the same request
arguments as Nuvio 0.5.9/0.5.10, but skips its eager base64 decoding for text. Binary
prefixes decode only the requested bytes. Both asynchronous mobile and synchronous
NuvioTV bridge return types are supported; other runtimes use normal fetch.

## Native loading and catalog compatibility in 1.0.2

The installed 1.0.1 module could open settings while stream calls stopped before
their first request. Nuvio's exact `UrlBridge.kt`, backed by Ktor, reports empty
query/fragment as `?` and `#`. Base validation mistook these for actual components.
The earlier JS harness used Node URL values (`""`) and missed this discrepancy.
Validation now checks the supplied address for real query/fragment delimiters;
relative-site and normalized embed URLs omit the bridge's empty query marker.
Credentials, real query strings/fragments and non-root base paths remain rejected.

For TMDB/IMDb inputs, one public `catalog.nuvio.tv/meta/{type}/{id}.json` request
supplies identity and requested season episodes. This uses the same episode
organization as the user's Nuvio Catalog addon, without a second season lookup
or app API key. App-key/public TMDB and Cinemeta remain isolated outage fallbacks;
Kitsu keeps its direct metadata path. Metadata is never confused with a final
playback URL, and source match/version rules remain in force.

Nuvio's Kotlin `evaluate` also waits for outstanding native callbacks. Its
`clearTimeout` suppresses the callback but cannot cancel the coroutine sleep.
An eleven-second canceled deadline therefore delayed completed results by roughly
ten seconds. Plugin-local timers now share sleeps of at most 100 ms, retaining
deadline semantics while limiting this timer drain. Node keeps native timers.
Uncancelable native HTTP calls can still delay teardown until the app completes
them; the plugin cannot cancel those transport calls through AbortSignal.

### Earlier catalog improvements

The original default path accepted only numeric TMDB IDs and required an injected
TMDB key. Earlier live native testing used an explicit mapping and did not exercise
a fresh installation from ordinary catalog IDs. This left IMDb/Kitsu IDs unsupported
and did not catch metadata failures, translated source titles or count mismatches.

The corrected path normalizes TMDB/IMDb/Kitsu IDs and episode suffixes, uses the
app's TMDB key where available, and can resolve all three input types without one.
Public TMDB pages supply JSON-LD title/year/genre and actual season episode numbers;
Cinemeta supplies IMDb identity metadata; oversized responses are parsed only
through complete fields/episode entries for the requested season, within the bridge cap; Kitsu supplies anime identity and absolute
numbering. No borrowed key or service credential is used. Native auto-matching
adds these identity requests before Anime-Sama discovery; explicit mappings and
addon IDs retain their existing fast paths.

Anime-Sama title aliases come only from the selected card or `#titreAlter` on the
actual detail page. Names of related titles are excluded. Exact normalized aliases
and compatible years remain required; substring matches do not select a spinoff.
Source group ranges map continuous catalog numbers to the right saga. Real array
positions remain authoritative, including missing VF entries. Equal total episode
counts and a first source episode numbered 1 are no longer required. Ambiguous
season arrangements still need an explicit map rather than invented offsets.

A diagnostic toggle logs catalog identity, selected relative path/index, timings
and safe failure codes. Current Nuvio 0.5.9 injects the TMDB key and its polyfills
match the pinned 0.5.10 snapshot; lacking that global is supported as a fallback,
not asserted to be the cause on every device. The UI's repository chips reflect
returned streams, so their absence alone does not identify an installation error.

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

## Verification scope

`npm run test:native:jvm` downloads SHA-256-pinned 0.5.9 Nuvio `JsBindings.kt`,
`UrlBridge.kt`, `DomBridge.kt` and registry source, with the matching Kotlin
QuickJS/Ktor/Ksoup dependencies. It evaluates the actual bundle through those
bridges, measures through full native callback completion, closes the runtime,
and retrieves a bounded HLS segment through a proxy-aware Node HTTP adapter.
The old 1.0.1 artifact reproducibly returns **zero requests/zero streams** under
these bridges; 1.0.2 returns working streams. Both sanitized reports are committed.
This exercises the native library on Linux/JVM, not Android/iOS networking or
device playback. Downloaded dependencies, compiler output and media never enter git.

The separate real-HTTP WASM probe uses one short-lived worker per case and retains its
QuickJS-WASM instance until process exit. This avoids a development-harness runtime
free assertion observed after a large Cinemeta case had already returned its stream.
It verifies actual bundle execution, IDs, bridge response limits, metadata and media
samples; it does not verify WASM destruction or Android/iOS native lifecycle. Unit
cases still dispose their small QuickJS runtimes explicitly. The development-harness
assertion has not been established as a failure in Nuvio's native QuickJS library.
