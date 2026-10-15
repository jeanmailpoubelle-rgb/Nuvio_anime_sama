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
