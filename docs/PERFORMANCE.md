# Measured resolution and limits

Measurements come from the cloud machine through its configured HTTPS proxy.
Each report records its date and measurement boundaries. Network location,
upstream load and the collection window affect each run; timings are samples.

## Combined catalog seasons and faster lookup (1.0.6)

Checked 2026-10-16. Nuvio Catalog combines Jujutsu Kaisen into one season of 59
episodes, while the source has 24/23/12 regular episodes and an intervening film.
The old direct-season lookup returned `SOURCE_EPISODE_UNAVAILABLE` for S1E25.
The mapper now walks the necessary canonical source prefix, keeping films, OAVs,
Kai and named specials outside regular TV numbering. Selected-language gaps,
dead slots and catalog row gaps cannot compress the numbering. Declared source
saga ranges still take precedence; ordinary multi-season catalogs stay direct.

All 16 cases below passed with the exact pinned native phone/TV bridges and the
published bundle hash recorded in the reports. Each asserts the source season
and actual player-array slot, then retrieves an HTTP 206, 4096-byte media sample.
All Jujutsu cases returned **both VF and VOSTFR**, including ANSEmbed 1080p streams.
One Piece E1180 still returned its source Saga 12 VOSTFR stream.

| Selection | Verified source position | TV streams | TV complete (ms) | Phone streams | Phone complete (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Jujutsu first episode E1 | saison1, slot 0 | 2 | 8923 | 3 | 8900 |
| Jujutsu end of source season 1 E24 | saison1, slot 23 | 2 | 5871 | 2 | 5747 |
| Jujutsu Hidden Inventory E25 | saison2, slot 0 | 2 | 5036 | 4 | 5607 |
| Jujutsu end of source season 2 E47 | saison2, slot 22 | 2 | 4213 | 3 | 13794 |
| Jujutsu start of source season 3 E48 | saison3, slot 0 | 2 | 5324 | 5 | 16219 |
| Jujutsu last published episode E59 | saison3, slot 11 | 2 | 4966 | 5 | 17115 |
| Jujutsu IMDb Hidden Inventory E25 | saison2, slot 0 | 2 | 3874 | 2 | 7469 |
| One Piece ongoing saga regression E1180 | saison12, slot 24 | 1 | 9015 | 4 | 15660 |

These are Linux/JVM runtime tests using Node HTTP through the cloud proxy, not
physical-device playback. Times include native startup, matching and extraction;
separate media samples are excluded. Slow native HTTP callbacks can still delay
phone completion after results are ready. The reports retain both timestamps.

Source identity now uses a validated direct-title page before ordinary search.
The benchmark alternated 1.0.5 and 1.0.6 with identical input metadata and a fresh
provider on every sample (three per title/implementation):

| Title | Previous GETs | New GETs | Previous median (ms) | New median (ms) |
| --- | ---: | ---: | ---: | ---: |
| JUJUTSU KAISEN | 2 | 1 | 814 | 266 |
| One Piece | 2 | 1 | 773 | 393 |

This removes one sequential search-page request for matching slugs. It measures
only source-title lookup, not a full stream resolution or Nuvio's catalog-wide
search. Nonmatching slugs use search after the direct probe and can be slower.
Title/alias/year validation remains required; this is not an unchecked slug guess.

For Jujutsu E25 on TV: **14 requests** = 1 catalog + 1 validated source title +
2 preceding-season canonical requests + 4 target-season edition requests +
6 player/playlist validation requests. No film or later season is fetched.
Canonical target discovery and episode scripts are reused within the same call;
only the preceding seasons needed to establish the offset are added. When source
ranges already identify the episode, that prefix discovery is unnecessary.
One Piece E1180 saves the search GET too (10 TV requests in this run).

Nuvio creates fresh plugin contexts for each selection and has no persistent plugin
storage API in these inspected releases. Prefix metadata is cached within an
invocation; the companion server can reuse its longer-lived provider cache.
Signed playback URLs are never cached to speed up a later selection.

Reports: [TV](JUJUTSU-TV-VERIFICATION-1.0.6.json),
[phone](JUJUTSU-MOBILE-VERIFICATION-1.0.6.json),
[lookup benchmark](LOOKUP-BENCHMARK-1.0.6.json),
[general browsing/extraction/concurrency](LIVE-VERIFICATION-1.0.6.json).
The deterministic suite passes **78 tests**, including boundary translation,
ordinary seasons, declared ranges, missing canonical pages, holes, late VF,
inserted specials, unpublished episodes and identity-validation fallbacks.
A source whose canonical prefix is missing, reordered or inconsistently numbered
fails safely; an explicit source mapping remains available for such layouts.

## One Piece ongoing sagas and TV latency (1.0.5)

Checked 2026-10-16 against the user's Nuvio Catalog and live Anime-Sama pages.
The catalog selection **S23 E1180** belongs to source **Saga 12**, beginning at
1156 with no declared end number. The old resolver returned
`SOURCE_SEASON_NOT_FOUND`; its episode parser also missed `finirListeOP(1156)`
and labeled the 25 slots as 1–25. Both are corrected using published range/call
literals and actual array positions, without a title-specific season override.

The boundary check includes Saga 11's seven recap specials: **E1155 is slot 73**,
and **E1156 is Saga 12 slot 0**. All selections below assert source group and
position, then retrieve an HTTP 206, 4096-byte HLS segment. All return ANSEmbed
1080p VOSTFR; phone cases may include other validated hosts too.

| Selection | Discovered players | TV streams | TV complete (ms) | Phone result ready (ms) | Phone complete (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| One Piece TMDB S23E1180 | 4 | 1 | 7081 | 7742 | 16739 |
| One Piece IMDb S23E1180 | 4 | 1 | 4811 | 6151 | 15746 |
| One Piece season-local S23E25 | 4 | 1 | 4848 | 5424 | 16063 |
| One Piece Kitsu S1E1180 | 4 | 1 | 3657 | 5582 | 14882 |
| One Piece end of Egghead S22E1155 | 2 | 1 | 4832 | 6532 | 15551 |
| One Piece start of Elbaf S23E1156 | 3 | 1 | 5032 | 6288 | 15361 |

Times include catalog matching, language probes and native startup. These use
exact pinned NuvioTV 1.0.0 / Nuvio phone 0.5.9 runtime bridges on Linux/JVM with
Node HTTP through the cloud proxy, not physical devices. Phone/native HTTP cannot
be canceled by JS: unfinished native calls added roughly 9–11 s after the result
was ready in these samples. That completion time is reported explicitly.

During development the mapping-corrected TV path took 18,712 ms for S23E1180:
after its healthy ANSEmbed result it blocked 12 s on `lpayer.embed4me.com`.
The final TV scheduler skips further hosts once that edition works. It still
tries other requested editions independently and continues to fallbacks after
failure. The Jujutsu S1E1 TV regression returned **both VF and VOSTFR 1080p**
in 4,950 ms. The TV's inability to interrupt an already blocking native request
remains a limitation if a preferred host itself stalls.

For native S23E1180 TMDB, **11 TV requests** = 8 catalog/source/language-discovery
requests + 3 ANSEmbed extraction/validation requests. Player data is reused from
the same invocation: no second episode-script GET. Discovery adds no network
stage for the mapping correction. Once the relative episode reference is known,
the retained-ID path remains one fresh script request + host extraction.

Reports: [One Piece TV](ONE-PIECE-TV-VERIFICATION-1.0.5.json),
[One Piece phone](ONE-PIECE-MOBILE-VERIFICATION-1.0.5.json),
[TV S1E1 regressions including VF](NATIVE-TV-VERIFICATION-1.0.5.json),
[general live browsing/extraction/concurrency](LIVE-VERIFICATION-1.0.5.json).
The general suite passed its VF, VOSTFR, recent/older series and film cases;
its known dead/placeholder case correctly returned no stream. Deterministic tests
cover future-slot rejection, conflicting/overlapping ranges, holes, new releases,
independent TV editions and bounded concurrent phone extraction (69 tests total).

Published group labels, helper call names and catalog episode numbering can
change upstream. Unrecognized or conflicting mappings remain unavailable rather
than selecting another numbered source slot. Signed media URLs are not saved in
reports or cached by the provider.

## Android TV and phone verification (1.0.4)

NuvioTV release **1.0.0** provides synchronous text-only native HTTP but no JS timer functions.
The published 1.0.3 artifact returned **zero streams in all four TV cases**, with
only 1–2 mapping requests before failure. Replaying 1.0.4 through the same pinned
QuickJS 1.0.5, TV polyfills, Java URL/Jsoup and synchronous bridge contract returned:

| S1E1 selection | TV time (ms) | TV streams | TV requests | Phone time (ms) | Phone streams |
| --- | ---: | ---: | ---: | ---: | ---: |
| One Piece TMDB | 8032 | 1 | 12 | 4485 | 1 |
| One Piece IMDb | 5721 | 1 | 12 | 4724 | 1 |
| One Piece Kitsu | 4866 | 1 | 12 | 3403 | 1 |
| Jujutsu Kaisen TMDB | 9995 | 2 | 14 | 5186 | 4 |

All eight working cases additionally retrieved HTTP 206, 4096-byte HLS segments.
TV Jujutsu returned ANSEmbed 1080p VF/VOSTFR; One Piece returned 720p VOSTFR.
Measurements include native runtime startup and full evaluation but exclude the
separate media sample. These use Linux/JVM and Node HTTP, not TV hardware; network
variability and runtime warm-up affect timings. Reports:
[`TV before`](NATIVE-TV-REGRESSION-1.0.3.json),
[`TV after`](NATIVE-TV-VERIFICATION-1.0.4.json),
[`phone regression`](NATIVE-MOBILE-VERIFICATION-1.0.4.json).

The TV scheduler checks deadlines between HTTP stages without sleeping or spinning.
Legacy HEAD probes use one-byte ranges, and binary-only validations stay unavailable
with an explicit error code because this app release cannot return original bytes.
Because TV fetch blocks the JS thread, it finishes each prioritized host before
starting another. The existing success window can therefore return fewer hosts
than phone concurrency does. A blocking TV HTTP request remains bounded by the
app's timeout; the plugin cannot interrupt it at its nominal JS deadline.
Mobile/Node retain concurrent extraction and real timers. Domain configuration,
stream metadata and playback headers are shared across both paths.

## Exact native bridge verification (1.0.2)

The user's 1.0.1 installation loaded settings but issued no stream requests.
The exact Nuvio 0.5.9 Kotlin URL bridge reproduced that failure: empty query and
fragment strings become `?` and `#`, causing the old base validation to reject
the default address. Replaying the committed 1.0.1 artifact under that bridge
returned **0 requests and 0 streams** in all four cases. See
[`NATIVE-JVM-REGRESSION-1.0.1.json`](NATIVE-JVM-REGRESSION-1.0.1.json).

Version 1.0.2 was then checked with dokar3 QuickJS 1.0.15, exact Nuvio startup/URL/DOM
source, Ktor/Ksoup, real HTTP, empty settings, no key, and full runtime completion:

| Native S1E1 selection | Resolve time (ms) | Streams | Requests | After-result wait (ms) |
| --- | ---: | ---: | ---: | ---: |
| One Piece TMDB | 5000 | 1 | 12 | 82 |
| One Piece IMDb | 3508 | 1 | 12 | 79 |
| One Piece Kitsu | 3711 | 1 | 12 | 78 |
| Jujutsu Kaisen TMDB | 6163 | 3 | 27 | 1177 |

Each case additionally retrieved an HTTP 206, 4096-byte media segment. Each JVM
runtime closed successfully. See
[`NATIVE-JVM-VERIFICATION-1.0.2.json`](NATIVE-JVM-VERIFICATION-1.0.2.json).
This runs native QuickJS on Linux/JVM with Node HTTP, not phone playback.

Nuvio Catalog now supplies title and season episodes in one request; the One Piece
TMDB path saves a separate season metadata request. Kitsu retains its direct path.
Canceled six/eleven-second native timer sleeps previously held evaluation open:
a preliminary browser-URL-adapted One Piece test captured a stream at 6131 ms but
did not finish until 15780 ms. Shared sleeps of at most 100 ms remove that timer
tail. In-flight native HTTP cannot be canceled through Nuvio's JS AbortSignal and
can still hold evaluation open: the separate WASM Jujutsu sample had a 5854 ms
after-result wait for HTTP. This is reported, not counted as fast completion.

## Earlier WASM default-install verification (1.0.1)

These historical WASM measurements used a Node-backed URL bridge that incorrectly
modeled empty native query/fragment markers. They establish extraction behavior
in that harness, **not compatibility with the installed 1.0.1 native plugin**.
The exact-bridge reproduction above supersedes that compatibility claim.
The original report below tested native resolution through an explicit mapping.
After the missing-stream report, the **actual automatic native entry** was tested
with empty settings, no injected key and no source map in QuickJS using the 0.5.9
bridge interfaces and real HTTP. Each case ran in its own short-lived worker.

| Native selection | Total time (ms) | Streams | Requests |
| --- | ---: | ---: | ---: |
| One Piece S1E1 TMDB | 5640 | 1 | 13 |
| One Piece S1E1 IMDb | 4204 | 1 | 12 |
| One Piece E1 Kitsu | 3723 | 1 | 12 |
| Jujutsu Kaisen S1E1 TMDB | 6520 | 2 | 28 |

Every case also returned an HTTP 206, 4096-byte media segment sample. One Piece
returned ANSEmbed 720p VOSTFR; its published VF episode-1 players returned 404.
The report contains no signed URLs: `NATIVE-VERIFICATION-1.0.1.json`.

The first unoptimized native One Piece check in this WASM harness took 33,732 ms.
The final TMDB case took 5640 ms. The bridge adapter removes eager binary
base64 decoding of text responses, preserving headers, request deadlines and lazy
bounded binary prefixes. Network variability and WASM overhead limit this comparison;
it is not a timing guarantee for a phone. Worker lifetimes do not validate runtime
teardown or actual native device playback; see ARCHITECTURE.md for that scope.

## General extraction regression (1.0.2)

`npm run test:live` passed again after the native fix: Jujutsu S1 VF/VOSTFR and
S3, One Piece saga 2, One Piece's first film, Your Name and Akashic Records E1
all returned working streams with HTTP 206 segment samples. The known-dead Akashic
E2 remained unavailable. Concurrent VF/VOSTFR resolutions returned 3/5 streams
in 2303 ms, and the complete HTTP catalog → metadata → stream flow returned
one title, 60 videos and five streams. The unchanged Node fast path remains healthy.

## Initial live results (1.0.0)

| Test | Players | Successful streams | Resolve time (ms) | Requests |
| --- | ---: | ---: | ---: | ---: |
| Jujutsu Kaisen S1 E1 VOSTFR | 3 | 3 | 3163 | 12 |
| Jujutsu Kaisen S1 E1 VF | 3 | 3 | 2751 | 12 |
| Jujutsu Kaisen S3 E1 (recent season) | 4 | 3 | 2918 | 13 |
| One Piece saga 2 E62 (older) | 1 | 1 | 1379 | 4 |
| One Piece first film | 2 | 1 | 2345 | 5 |
| Your Name film | 2 | 1 | 2825 | 7 |
| Akashic Records E1 | 1 | 1 | 800 | 4 |
| Akashic Records E2 (known dead/placeholder) | 2 | 0 | 2237 | 4 |

All seven working cases additionally fetched an actual HLS variant and a **4096-byte
media segment sample, HTTP 206**. The dead episode returned zero streams deliberately;
it is not counted as a successful playback. Full per-host timing and request
categories are in `LIVE-VERIFICATION.json`, with no signed playback URLs.

The full live search → HTTP addon metadata → HTTP stream flow returned one Jujutsu
card, 60 videos across the four website groups and 5 streams for its first video.
Metadata loaded in 1359 ms; source year 2020 and VF/VOSTFR versions were present.
Latest catalog browsing returned 24 items. The built native bundle, using a Jujutsu
S1 VF explicit source map and no TMDB key, returned 4 streams in 1904 ms.

Two simultaneous VF/VOSTFR resolutions completed together in 2593 ms, returning
3 and 4 links respectively. The grace window can omit slower hosts; counts vary.
Deterministic tests separately verify that same-script discovery is coalesced and
that canceling one caller does not cancel another caller's shared request.

## Actual returned metadata

Sanitized examples from those responses (URLs intentionally not persisted):

| Source | Quality | Version | Audio | Subtitle edition | Codec | Video range |
| --- | --- | --- | --- | --- | --- | --- |
| ANSEmbed | 1080p max / adaptive | VOSTFR | Unknown | French | avc1.640028, mp4a.40.2 | SDR |
| ANSEmbed | 1080p max / adaptive | VF | French | Unknown | avc1.640028, mp4a.40.2 | SDR |
| Smoothpre | 720p max / adaptive | VOSTFR | Unknown | French | avc1.64001f, mp4a.40.2 | SDR |
| Voe HLS | 720p max / adaptive | VF | French | Unknown | avc1.64001f, mp4a.40.2 | SDR |
| Voe direct video | Unknown | VOSTFR | Unknown | French | Unknown | Unknown |

From version 1.0.3, the visible heading is:
`Anime-Sama • VOSTFR • 1080p`.
The smaller technical description is:
`ANSEmbed • HLS • Auto (qualité max) • avc1.640028, mp4a.40.2 • SDR`.
Native Nuvio also adds its structured quality/version fields to that caption.
Earlier verification reports retain the longer names actually returned by those
older builds; the underlying quality and language metadata is unchanged.

Unknown fields are absent from the actual stream object (null in the sanitized
report). `subtitleLanguages: ["fr"]` describes the source VOSTFR edition; it does
not claim a separate subtitle file. No Japanese audio was inferred. Header names
in the report are Referer, Origin and User-Agent; actual responses preserve values.

## CloudStream comparison and eliminated work

This comparison is a **request-path analysis of the inspected v6 source**, not a
stopwatch benchmark of the Android CloudStream runtime. A single active ANSEmbed
HLS player with a multi-variant master follows:

| Implementation | Player discovery | Extractor/validation requests | Sequential stages | Total |
| --- | ---: | ---: | ---: | ---: |
| CloudStream v6 `loadLinks` | 2: fresh season + episode script | 1 embed + 1 master + 1–2 variants | 5 | 5–6 |
| Nuvio retained episode ID | 1: episode script | 1 embed + 1 master + 1 healthy variant | 4 | 4 |
| Nuvio older ID without script | 2: season + episode script | 1 embed + 1 master + 1 healthy variant | 5 | 5 |

The source tries up to two variants concurrently. This implementation validates
the highest rendition first, trying a second only if the first fails. The live
single-player cases used exactly four requests. Core CloudStream fallback extractors
can add another embed fetch and a separate HLS metadata fetch; this port parses
VOE/generic sources from the already fetched page and uses the validation master
for metadata. No Android runtime timing comparison is claimed.

The first unoptimized Nuvio probe of Jujutsu VOSTFR used 20 requests and 8582 ms:
Smoothpre advertised several mirrors and each was validated. The optimized recorded
probe used 12 requests and 3163 ms, returning healthy routes without enumerating
every Smoothpre mirror. This is a request reduction, not a controlled network speed test.

## Actual final request path

```text
stream(episodeId)
  → validate relative references and selected language
  → base + relative episodes.js (one fresh GET per language, shared in flight)
  → read the exact array position, discard closed/duplicate/invalid players
  → bounded parallel extraction (four workers)
      → one embed GET, plus known alias redirects if published
      → parse literal/packed configuration or VOE F7
      → master GET + first healthy variant (metadata from these same responses)
         OR direct-video HEAD / Sendvid bounded range probe
  → collect successes, allow 1.5 s for other hosts, cancel unfinished work
  → preserve headers/version/known metadata; deduplicate; return
```

An explicit native source map uses the same path. Automatic native TMDB/IMDb matching
first loads one Nuvio Catalog response containing identity and season episodes;
fallback services are only contacted if it fails. Episode data it just
fetched is reused for up to five seconds within that invocation, eliminating a
duplicate script fetch; it is never a cache of signed media. The addon fast path
never makes a TMDB or metadata request.

The main bottleneck is remote embed/CDN response time and required media validation,
not parsing. Mirrors and VOE aliases can add stages. Metadata enrichment makes no
extra playback-path requests. Stream resolution is bounded even when no player
works; no retry sleeps or whole-media downloads are used.

## Unsupported, broken or unverified cases

- **Sibnet:** deliberately excluded because the authoritative source marks it closed.
- **Akashic Records E2:** ANSEmbed HTTP 404; Sendvid HTTP-success five-second
  unavailable-video placeholder rejected. No replacement player is invented.
- **lpayer.embed4me.com:** a separate live extraction timed out at the six-second
  request limit; slow instances in mixed episodes were canceled after healthy links.
- **callistanise.com:** no successful link in the recorded sample; unfinished during
  the collection window. Neither newly encountered host is mapped by the inspected
  CloudStream core registry. Its successful extraction is not claimed.
- **Your Name Smoothpre:** its tested HLS variants were unavailable during this run;
  ANSEmbed worked. Different signed routes or networks can behave differently.
- **Vidmoly and packed StreamWish:** published migration/config patterns are ported
  and deterministic parsing is covered, but no successful live sample for these
  hosts was present in the representative tested episodes. Browser-only or
  challenge-dependent fallback code from CloudStream cannot run in this plugin.
- **Subtitles:** real JWPlayer captions are covered by deterministic fixtures;
  the sampled source streams had no downloadable subtitle tracks. Burned-in
  VOSTFR is represented as edition metadata only.
- **Automatic native catalog matching:** 1.0.2 verifies fresh-install TMDB/IMDb/Kitsu
  inputs using the actual Kotlin URL/DOM bridges; earlier browser-URL-adapted WASM
  checks missed the 1.0.1 startup failure. See the current JVM report above.
  Ambiguous season splits and remakes can still require explicit mappings.
- Actual Android/iOS playback, casting, external players and Docker image execution
  were not tested. QuickJS/HTTP tests do not establish device playback.

Likely future breakpoints are website selectors/data calls, language folder names,
host packing/encryption, CDN headers and Nuvio bridge/schema changes. Changing the
Anime-Sama hostname alone is covered by the single configuration value and domain
regression tests. Network/geographic denial and new authenticated players remain
outside a domain-setting fix.
