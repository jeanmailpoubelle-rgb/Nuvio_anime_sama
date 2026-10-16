# Source trace and attribution

Primary private reference, inspected without edits:
`jeanmailpoubelle-rgb/cloudstream-source`, main,
`4c4d7295c01fbb7e9b6cf2f7048d61cd18b5593e` (AnimeSama v6).

All following paths are under `AnimeSama/src/main/kotlin/com/animesama/` there:

| CloudStream source | Port/adaptation |
| --- | --- |
| `AnimeSamaProvider.kt` | Catalog filters, bounded search, independent language probing, VF1/VF2 fallback, fresh player discovery, priorities, headers and validation |
| `AnimeSamaPages.kt` | Selectors, root/group paths, language list, episode labels and zero-based array positions, Vidmoly migration, closed Sibnet filter |
| `JsData.kt` | Safe tokenizer, known-call parser, sparse arrays, Dean Edwards dictionary decoding |
| `SiteUrl.kt`, `AnimeSamaPlugin.kt` | One normalized site address and editable plugin setting |
| `PlaybackData.kt`, `EpisodeLanguage.kt` | Validated relative references and explicit VF/VOSTFR filtering; Nuvio uses its own versioned ID encoding |
| `OrderedLanguageEpisodes.kt` | Real-slot union and unavailable selected-language gaps |
| `SeasonOrderedMap.kt` | Website group position as season order; no CloudStream-specific map subclass needed in Nuvio |
| `ResilientJobs.kt` | Bounded independent host work and cancellation/error isolation |
| `PlayerPages.kt` | Actual player sources, master.txt aliases, alias redirects and playlist checks |
| `Mp4Duration.kt`, `SendvidPreflight.kt` | Bounded MP4 header duration parsing and unavailable-clip rejection |

The module's README, tests, fixtures, live checker and recent Sendvid-fix history
were inspected. There are no other project-local AnimeSama extractor dependencies;
its `loadExtractor` and `extractorApis` fallbacks come from CloudStream's SDK/core.
Shared provider/extractor usage elsewhere in the private repository was searched
before implementing a new helper.

Core fallback references were traced in
[recloudstream/cloudstream](https://github.com/recloudstream/cloudstream/tree/94e955836bdf2932bea248b2eba29652d761cc78/library/src/commonMain/kotlin/com/lagradost/cloudstream3),
commit `94e955836bdf2932bea248b2eba29652d761cc78`:

- `extractors/Voe.kt`: official alias flow and F7 decoder, ported to `voe.js`.
- `extractors/Vidmoly.kt`: embed normalization and iframe header.
- `extractors/Sendvid.kt`: secure-video meta fallback; local v6 MP4 regression remains authoritative.
- `extractors/StreamWishExtractor.kt`, `VidHidePro.kt` (Smoothpre): JWPlayer/packed configurations; browser interception fallback is not available in Nuvio.
- `extractors/helper/JWPlayerHelper.kt`: sources/tracks and HLS configuration conventions.
- `utils/ExtractorApi.kt`, `utils/M3u8Helper.kt`: extractor dispatch, quality and playlists. The port reuses already fetched pages/masters instead of repeating generic extractor requests.

NiceHttp `Requests.kt`, response/header helpers and cancellation were inspected in
[Blatzar/NiceHttp](https://github.com/Blatzar/NiceHttp/tree/f1dee9dfc5b86a24c65bf8c6e8403d336341dd3e),
commit `f1dee9dfc5b86a24c65bf8c6e8403d336341dd3e`. AnimeSama v6 sets no explicit
cookies or login credentials. The new transport keeps TLS verification, propagates
explicit Referer/Origin/User-Agent, follows HTTP redirects and bounds reads/timeouts.

## Nuvio references

The implementation contract was verified from primary application code in
[tapframe/NuvioStreaming](https://github.com/tapframe/NuvioStreaming/tree/779c145a5eb3814c70511f4b8c41e1dbd7b1a091),
commit `779c145a5eb3814c70511f4b8c41e1dbd7b1a091`:

- `PluginModels.kt`, `PluginManifestParser.kt`: repository and stream DTO schema.
- `PluginRuntime.kt`, `JsBindings.kt`, `HostFunctions.kt`: lifecycle, call arguments,
  modules, runtime settings, timers and 60 s outer timeout.
- `FetchBridge.kt`, `UrlBridge.kt`, `DomBridge.kt`: HTTP/binary data, URL and DOM limitations.
- `PluginSettingsDialog.kt`: actual settings layout keys.
- `PluginContentIds.kt`: ID normalization.
- `StreamFetchSupport.kt`, `StreamParser.kt`: native headers and addon proxy headers.
- `AddonPlatform.kt`/Android implementation: 1 MiB default buffered fetch cap.

`test/fixtures/nuvio-polyfills.txt` contains selected timer/fetch/abort/base64/URL/DOM/
require polyfills from that commit for reproducible QuickJS tests. It does not
include app API keys or credentials. The harness supplies Node-backed host functions,
not an actual Android/iOS device or native network stack.

Existing plugin examples and build patterns were inspected in
[yoruix/nuvio-providers](https://github.com/yoruix/nuvio-providers/tree/ed38d1aee0024f56479369c9423fefb278e0b62a),
commit `ed38d1aee0024f56479369c9423fefb278e0b62a` (AnimePahe/Anizone, manifest, build
and documentation), and the tapframe template. No embedded third-party keys were
copied; the application runtime is authoritative over outdated template formats.

## Test fixture provenance and licensing

Reduced catalog/detail/episode HTML and literal episode scripts were adapted from
the primary private repository's `AnimeSama/src/test/resources/` at the pinned
commit. Anime-Sama origins in HTML were replaced with `domain-a.example`; irrelevant
navigation/assets were removed where practical. Stable published embed identifiers
remain as parsing fixtures. Signed media URLs, private cookies, generated video and
temporary debug responses are not included. Tests use synthetic player manifests,
packed JS and MP4 headers; no media file is committed.

The repository is distributed under GPL-3.0-or-later; the GPL text is in `LICENSE`.
CloudStream and Nuvio upstream authors retain their copyrights. The private source
owner supplied and authorized the port; public SDK/runtime adaptations are attributed
above. This project is independent of Anime-Sama and Nuvio.

## Native compatibility follow-up (1.0.1)

Nuvio **0.5.9-beta**, tag `db0c50b503039863909c86405907462bf1752193`, was
inspected after the user's missing-stream report. Its `JsBindings.kt` matches the
previously pinned snapshot. `PluginContentIds.kt`, `PluginRepository.kt`,
`TmdbService.kt` and `DomBridge.kt` establish that IDs can remain nonnumeric when
app conversion is unavailable and that the bridge caches at most eight DOM documents.
The harness now tests the complete automatic path with empty settings as well as
explicit mappings, and runs real HTTP through those QuickJS-compatible interfaces.

Public metadata fallback references:

- TMDB's public title JSON-LD and `.episode_list .episode` season pages, e.g.
  https://www.themoviedb.org/tv/37854 and https://www.themoviedb.org/tv/37854/season/1
- IMDb identity through Cinemeta's public `/meta/series/{imdbId}.json` resource:
  https://v3-cinemeta.strem.io/manifest.json
- Kitsu's public anime resource: https://kitsu.io/api/edge/anime/12

The primary source's `UVOD/.../EnglishMatching.kt` was also inspected for exact-alias
and year-confidence conventions; no API credentials or SDK keys were copied.
Source aliases are parsed from Anime-Sama's actual `#titreAlter` element. The live
One Piece first-season script and the source's group ranges supplied the episode
positions used for verification; no title-specific playback URL is hardcoded.

The bridge performance adapter is based on the six-argument `__native_fetch`
contract in those same Nuvio 0.5.9/0.5.10 files; the matching synchronous return
contract was checked in NuvioMedia/NuvioTV at `4fe12b3f14939101b8988c5961dbdc862072c5fa`.
The default mobile fetch wrapper eagerly decodes `bodyBase64` even for text. A
standalone QuickJS-WASM check took about 50 seconds to decode 500,000 bytes; a
full One Piece automatic resolution initially took 33,732 ms in that harness.
The adapter preserves the native transport while decoding binary only on demand.
Cinemeta's One Piece metadata was 1,358,974 text characters during investigation,
exceeding the app's 1 MiB body limit; complete early metadata/season entries are
read without treating a clipped tail as a complete JSON document.

## Exact native bridge regression (1.0.2)

The user's installed/enabled 1.0.1 opened settings but returned no sources. Running
the exact 0.5.9 `UrlBridge.kt` with **Ktor 3.4.1** reproduced its empty query and
fragment as `?` and `#`; base URL validation failed before the first HTTP request.
This was missed by the earlier Node-backed URL harness. The bridge source, not a
browser URL approximation, is now part of the optional JVM verification.

`test/native-jvm/dependencies.json` pins source/artifact URLs and SHA-256 checksums.
The harness uses dokar3 quickjs-kt **1.0.15**, Ksoup **0.2.6**, the exact URL/DOM
bridges and the complete `JsBindings.kt` startup/settings/call source. Only HTTP
is adapted to Node so the cloud's inherited proxy/CA configuration is respected.
The shared JS regression bridge now also emits Ktor's empty markers.

The same runtime showed that native evaluation waits for canceled timer sleeps.
The plugin's shared short-sleep scheduler removes that avoidable post-result wait.
Settings fields were checked against `PluginSettingsDialog.kt`: boolean controls
must use `toggle`, not `switch`.

The user's Nuvio catalog endpoint was verified directly:
https://catalog.nuvio.tv/meta/series/tmdb:37854.json
and https://catalog.nuvio.tv/meta/series/tt0388629.json returned the same One Piece
identity and episode list. Both now share a single keyless metadata path. Episode
entries come from that response; source group ranges and language slots still come
from the authoritative Anime-Sama parser.

## Stream display follow-up (1.0.3)

`StreamFetchSupport.kt: PluginRuntimeResult.toStreamItem` confirms that native
heading text uses `name`, while the smaller caption joins `quality`, `size` and
`language`. Native `description` is not parsed. The native-only adapter uses that
string caption slot for host/format/adaptive/codec/range text while preserving
the original structured quality and language. No media size is inferred. The
shared provider and addon keep this text in `description`; addon `title` mirrors
it for compatible Stremio clients. NuvioTV's `buildDescription` similarly retains
the string caption slot and language.

## Timerless Android TV follow-up (1.0.4)

NuvioMedia/NuvioTV release **1.0.0**, commit
`9f17e8bf4abc799dc8c832d2894a8b3b166e4353`, registers synchronous `__native_fetch` and no
JS timer/sleep host functions in `app/src/full/java/com/nuvio/tv/core/plugin/PluginRuntime.kt`.
Its dependencies pin QuickJS 1.0.5 and Jsoup 1.17.2. Earlier coverage checked only
the synchronous fetch return shape, missing the absent timers in the full runtime.

`test/fixtures/nuvio-tv-polyfills.txt` is the complete `getStaticPolyfillCode()`
snapshot from that release with runtime key getters, not credentials. Its native
HTTP bridge reads four arguments, returns decoded text without `bodyBase64`, and
maps unknown methods (including HEAD) to GET. The TV JVM
profile generates bindings from the exact URL/DOM registration blocks and call
wrapper in the pinned source; `test/native-jvm/dependencies-tv.json` records every
download's SHA-256. Android-specific HTTP/crypto startup is replaced with the
proxy-aware synchronous HTTP handoff reproducing those legacy limitations; the
plugin does not use CryptoJS. Binary-dependent validation stays unavailable on
that release, with a specific failure code and no unsafe text-to-binary guess.

`test/fixtures/nuvio-tv-modern-polyfills.txt` retains the previously inspected
`4fe12b3f14939101b8988c5961dbdc862072c5fa` (`1.1.0-beta.6`) timerless snapshot with
its six-argument binary-capable bridge. Deterministic tests cover both TV shapes
alongside the phone runtime; the live TV report targets the user's 1.0.0 release.

Compatibility findings refer to this identified runtime source snapshot; they do
not establish playback on an uninspected installed APK or physical Android TV.

## One Piece ongoing saga follow-up (1.0.5)

The user's Nuvio Catalog selection `tt0388629:23:1180` was compared with the live
Anime-Sama title, `saison11/vostfr/`, `saison12/vostfr/` and their episode scripts
on 2026-10-16. Nuvio's S23 lists global episodes 1156–1180; Anime-Sama's Saga 12
declares an open-ended range beginning at 1156. Its inline `finirListeOP(1156)`
renumbers the real slots instead of using the default `finirListe(1)` labels.
Saga 11 also calls `finirListeOP(1134)` after seven named recap specials.

The reference `AnimeSamaPages.kt`/`JsData.kt` known-call parser was rechecked; it
does not yet recognize this helper. The Nuvio port extends that same literal-only
approach without executing remote JavaScript. Reduced numbering-only fixtures
preserve both live call sequences; player data in deterministic tests is synthetic.
Native matching accepts numeric and open-ended declared ranges, then requires
the actual source episode number and preserves all intervening special positions.

The exact native JVM harness now accepts season/episode arguments and records
sanitized selected relative references. Its One Piece suite asserts the group and
zero-based position, not just the presence of any playable video. TV stops after
a successful host per requested edition, avoiding a measured 12-second wait on
a dead secondary player after ANSEmbed had already succeeded. Phone extraction
remains concurrent, and missing VF editions remain unavailable.
