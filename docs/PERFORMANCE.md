# Measured resolution and limits

Checked on 2026-10-15T01:56:13.492Z from the cloud machine through its configured HTTPS
proxy. Measurements include fresh episode-script discovery, all completed host
extraction and playback validation. They exclude opening metadata beforehand and
the separate media segment sample. Network location, signed URLs, remote load and
the success collection window affect each run; these are samples, not guarantees.

## Native default-install verification (1.0.1)

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

## Live results

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

Example visible name:
`Anime-Sama • ANSEmbed • 1080p max · Auto • VOSTFR • avc1.640028, mp4a.40.2 • SDR`.

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

An explicit native source map uses the same path. Automatic native TMDB matching
adds necessary title/season verification before extraction. Episode data it just
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
- **Automatic native catalog matching:** the original v1.0.0 report above used an
  explicit mapping. Version 1.0.1 separately tests fresh-install automatic TMDB,
  IMDb and Kitsu inputs without a key; see `NATIVE-VERIFICATION-1.0.1.json`.
  Ambiguous season splits and remakes can still require explicit mappings.
- Actual Android/iOS playback, casting, external players and Docker image execution
  were not tested. QuickJS/HTTP tests do not establish device playback.

Likely future breakpoints are website selectors/data calls, language folder names,
host packing/encryption, CDN headers and Nuvio bridge/schema changes. Changing the
Anime-Sama hostname alone is covered by the single configuration value and domain
regression tests. Network/geographic denial and new authenticated players remain
outside a domain-setting fix.
