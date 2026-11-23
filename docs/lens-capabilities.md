# What Lens can do, and what of it a client of our own can reach

Research note, 2026-11-23. Read against Chromium `main` on that date
(`chrome/browser/ui/lens/`, `components/lens/`, `third_party/lens_server_proto/`)
and checked against the live service where it says **verified**.

It is written for someone who has not seen this userscript. All you need to know
about it is this: it posts a protobuf to Google Lens's private endpoint with the
public Chrome API key, gets OCR text and a translation back, and draws the
translation over the image. The question here is what *else* Chrome's Lens does
and which of it a client with no Chrome, no OAuth and no extension can do. The
same answers hold for the Python and Rust ports and for a Kotlin app; where a
userscript differs, it says so.

## The one thing that decides everything

Lens is two different things stitched together:

1. **A protobuf API** at `lensfrontend-pa.googleapis.com`. It returns
   *structured data about the image*: text with geometry, a translation,
   detected objects, a formula. That is what this script has used so far.
2. **An ordinary Google results page** (`www.google.com/search`). Everything a
   user thinks of as "search" — visual matches, "find this product", prices,
   the knowledge panel, the AI answer — is HTML on that page. The protobuf
   response does not contain any of it. Not one field.

The link between them is two ids: the client uploads the image to (1), then
opens (2) with `vsrid` (which upload) and `gsessionid` (which session). Google's
side joins them. So "product search" can only mean "open the right results page"
— there are no product listings to parse out of a response.

That makes visual search cheap for us — upload, build a URL, open it — and
anything that wants products as *data* expensive and fragile, because that
means scraping Google's HTML.

## Endpoints

| URL | Body | What it is for |
|---|---|---|
| `POST https://lensfrontend-pa.googleapis.com/v1/gsessionid` | `LensOverlayServerClusterInfoRequest` | Opens a session: `server_session_id`, `search_session_id`, `routing_info`. **Verified with the API key alone.** |
| `POST https://lensfrontend-pa.googleapis.com/v1/crupload[?gsessionid=<server_session_id>]` | `LensOverlayServerRequest` | Objects request (whole image) or interaction request (a region, an object, a text query). The query parameter is the *server* session id. |
| `POST https://lensfrontend-pa.googleapis.com/v1/uploadChunk` | `LensOverlayUploadChunkRequest` | Chunked upload of a large PDF / page content for contextual search. |
| `GET https://translate-pa.googleapis.com/v1/supportedLanguages?country=&display_language=&client=lens-overlay` | — | The language list Chrome's translate picker shows. |
| `GET https://www.google.com/search?...` | — | The results page. Opened in Chrome's side panel, or a new tab for shopping. |
| `POST https://lens.google.com/v3/upload?ep=ccm&re=df&s=4&st=<ms>` | multipart `encoded_image` | The older, non-overlay "Search image with Google" route. Redirects to a results page. |
| `*.clients6.google.com/v1/...` | same | The same three Lens paths behind identity delegation (SAPISID cookie hash), used when the AI Mode composebox flag is on. Not needed by us. |

All `lensfrontend-pa` requests carry `Content-Type: application/x-protobuf` and
`X-Goog-Api-Key`. When Chrome is signed in it adds `Authorization: Bearer` and
`X-Developer-Key`; that is optional (`CreateOAuthHeadersAndContinue` falls back
to the key alone), and everything below was verified without it.

## The session flow Chrome uses

From `LensOverlayQueryController` and `LensOverlayRequestIdGenerator`.
Replayed end to end against the live service on 2026-11-23 with the public key
and no cookies (a throwaway script on chrome-lens-py's generated Python
protobufs): every step answered 200.

1. **Cluster info.** POST `/v1/gsessionid` with `enable_search_session_id = true`.
   Keep all three fields. They expire after `cluster-info-lifetime-seconds`
   (1800 s); after that Chrome resets the request id and starts over.
2. **Objects request** (what this script sends today), now to
   `crupload?gsessionid=<server_session_id>`. Request id: fresh random `uuid`,
   `sequence_id = 1`, `image_sequence_id = 1`, 16 random bytes of
   `analytics_id`, `routing_info` copied from step 1. The response carries text,
   translation and `overlay_objects` (id + geometry per detected object — the
   test manga panel came back with four).
3. **Interaction request** for whatever the user picked, same endpoint and
   session. Request id: same `uuid`, `sequence_id + 1`, new `analytics_id`.
   `interaction_request_metadata.type` is
   - `REGION_SEARCH` (4) with `selection_metadata.region` — the box, normalised
     — and `image_crop` holding the **cropped pixels** plus a `zoomed_crop`
     (crop box, parent width/height, zoom). Optional `query_metadata.text_query`
     makes it multimodal.
   - `TAP` (1) with `selection_metadata.object.object_id` from step 2.
   - a contextual type (`WEBPAGE_QUERY`, `PDF_QUERY`) with only a text query,
     when page content was uploaded.

   The response is small: `encoded_response` (an opaque string Chrome feeds to
   search suggestions) and, for a region, `text` re-read from the crop.
4. **The results URL**, built as soon as the interaction request is *sent*, not
   when it returns. Request id for the URL: same `uuid` and `analytics_id`,
   `sequence_id + 1` again (`RequestIdUpdateMode::kSearchUrl`). Then
   `BuildLensSearchURL`:

   ```
   https://www.google.com/search
     ?q=<text or empty>
     &lns_mode=un            (mu with text)
     &udm=26                 (24 with text; 28 = shopping tab; 50 = AI Mode)
     &lns_fp=1
     &lns_surface=42
     &gsessionid=<search_session_id>      <- the *search* one, not the server one
     &vsrid=<base64url(LensOverlayRequestId), no padding>
     &source=chrome.cr.<entry point>      (ctxi = image context menu, menu, tbic ...)
     &vsint=<base64url(LensOverlayVisualSearchInteractionData)>   (logging; optional)
     &plla=<gen204 id>, qsubts=<ms>, cud=<ms>                     (logging; optional)
     &hl=<ui language>&cs=<dark mode> ...  (common params)
   ```

**Verified 2026-11-23: the upload and the page do not need to share a client.**
The upload was made by a Python script through a proxy in another country,
with the key and no cookies. The URL was then opened in an ordinary signed-in
Chrome on a different IP, and it showed the picture in the search box, an
AI Overview of it and "Visual matches". The `udm=50` variant opened AI Mode with
the picture attached and answered "what manga is this?" correctly. The `TAP`
variant opened the same kind of page. So the ids are the whole contract, and a
userscript only has to open the URL.

What does *not* render it: a headless Chrome, a fresh browser profile, or the
desktop app's embedded browser. All of them got the "unusual traffic" reCAPTCHA.
The page has to open in the user's own browser.

## Capabilities

"Userscript" assumes `GM_xmlhttpRequest` (no CORS limit, sends the user's own
Google cookies with `anonymous: false`) plus the ability to open a tab or a
popup window. A Kotlin/Python client is the same, with a WebView or the system
browser in place of the tab.

Effort: S = a day or less, M = a few days, L = a week or more.

| # | Capability | What Chrome does | Carried by | Reachable here? | Effort | Risk |
|---|---|---|---|---|---|---|
| 1 | OCR, text with geometry | Text layer you can select | objects response `text` | **Yes — done** | — | — |
| 2 | Translate the image in place | Translate chip | objects request with `TRANSLATE` filter | **Yes — done** | — | — |
| 3 | Search the whole image | "Search with Google Lens" | region interaction for the full frame + `udm=26` URL; or `lens.google.com/v3/upload` | **Yes — verified** end to end | S | Low on upload; the results page is Google's and can change its params, but Chrome ships them so they are stable for months |
| 4 | Search a region the user draws | Drag a box in the overlay | `REGION_SEARCH` + `image_crop` + `udm=26` URL | **Yes**, same as 3 with a crop. Needs a selection UI on the cover | M | Low |
| 5 | Search a detected object | Tap a pulsing dot ("gleam") | objects response `overlay_objects` → `TAP` interaction + URL | **Yes.** The objects already arrive in every response we get today; nothing extra to fetch | S–M | Low |
| 6 | Image + text ("add to your search") | Type in the searchbox with a region selected | `REGION_SEARCH` + `text_query`; URL with `q`, `lns_mode=mu`, `udm=24` | **Yes** | S on top of 4 | Low |
| 7 | Products / shopping | A "Shopping" tab on the results page; Chrome opens `udm=28` in a new tab and strips `stick` (`MaybeStripParamsForShopping`) | the same results URL with `udm=28` | **Only as a tab of the visual results page.** No product data exists in any protobuf, and `udm=28` asked for directly with a fresh `vsrid` opens an empty Google Shopping page that never sees the picture (verified 2026-11-23) | S to open; L and fragile to scrape | Scraping Google HTML breaks without warning; not recommended |
| 8 | Search selected text | Select words in the text layer → results | `BuildTextOnlySearchURL`: `q=<text>&lns_mode=text&lns_fp=1&lns_surface=42`; no upload at all | **Yes, trivially.** We already have every word and its box | S (plus a text selection UI) | None |
| 9 | Translate selected text on the results page | Translate chip on a selection | URL param `stick` = base64url(gzip(`StickinessSignals{TRANSLATE_LITE, intent "Translate", arg "Text"}`)) | Yes | S | Low value: we already translate in place |
| 10 | Solve a formula | "Homework" — tap a formula | the objects response marks words with `formula_metadata` (LaTeX); URL param `stick` = `StickinessSignals{EDUCATION_INPUT, math_solver_query.math_input_equation}` | **Yes.** `TextLayout_Word_FormulaMetadata` is already in our field table | S–M | Medium: depends on the server sending formula metadata, which it does only for some images |
| 11 | Re-read a small region at full resolution | Region search returns text for the crop | `interaction_response.text` | **Yes** — useful for fine print the downscale lost | S | Low |
| 12 | Language list | Translate picker | `translate-pa…/supportedLanguages` | Yes (needs the key) | S | Low; we already derive labels from `Intl` |
| 13 | Search a video frame | "Search video frame" context menu (`ep=cvfs`) | capture the frame, then 3/4 | **Yes** — the script already classifies `<video>` | S on top of 3 | Low |
| 14 | Ask AI Mode about the image | Composebox in the Lens panel | the objects upload we already send + URL with `udm=50&q=` | **Yes — verified** (`udm=50`, `lns_mode=mu`, `q=` the question) | S on top of 3 | Medium: AI Mode is new and its URL contract moves faster |
| 15 | Contextual search over the page / PDF | Searchbox that "knows" the page | `Payload.content` (inner text, HTML, annotated page content, PDF), chunked via `uploadChunk`; then a text-only interaction or `udm=50` | Yes for inner text and PDF bytes we can fetch; annotated page content is a Chrome-internal format | M | Privacy: uploads page text; must be opt-in |
| 16 | Suggestions while typing | Omnibox-style suggestions seeded by the image | `encoded_response` from the interaction → the suggest service | Possible but not worth it | M | Medium |

## AI Mode and contextual search

The newer flows follow the same pattern. Nothing new comes back from the API;
what is new is *what gets uploaded*.

`LensQueryFlowRouter` sends every query either to the classic
`LensOverlayQueryController` (above) or, when side-panel unification is on, to a
"contextual tasks" session (`components/contextual_search/.../composebox_query_controller.cc`).
The second one does this:

1. Cluster info, as before.
2. Uploads to the same `crupload?gsessionid=` as an objects request, but with
   `Payload.content`: `webpage_url`, `webpage_title` and `content_data[]` —
   inner text, inner HTML, annotated page content, or PDF bytes (ZSTD
   compressed). Large ones go through `uploadChunk`. An image still goes in
   `objects_request.image_data`. Three upload modes: full page (screenshot +
   page content), viewport only, selected region only (URL, title and DOM
   stripped — the mode used for the image context menu).
3. Opens a results URL built in `components/search_engines/util.cc`
   (`GetUrlForAim`, `GetUrlForMultimodalSearch`, `GetUrlForContextualSrp`):
   `udm=50` for AI Mode, `q`, `gsessionid`, and either `vsrid` (one context)
   or `cinpts` = base64url(`LensOverlayContextualInputs`, one request id per
   context), plus `lns_surface=42`, `aep`, `aai` (base64url `AddedInputs`),
   `amc=1`, `source=chrome.crn.<entry>`.

The AI answer is the Google AI Mode page at that URL. There is no protobuf
answer to parse.

`aim_communication.proto` and `search_communication.proto` are **not server
RPCs**. They are `postMessage` traffic between Chrome and the AI Mode / results
page loaded in its side panel (handshake, submit-query, "inject this chip",
open a link, which inputs are attached). A client that opens the page in a tab
has no use for them. That is good, since they are also the two files that
drag in `third_party/omnibox_proto`.

Signed-out use is allowed by default (`kLensSidePanelUnification`
`allow-signed-out=true`). When the composebox identity-delegation flag is on,
Chrome calls the `clients6.google.com` hosts with a SAPISID cookie hash; with
it off, Chrome falls back to OAuth or the key alone. We only need the key.

What this means for us:

- **Ask AI Mode about the image**: the objects request we already send *is*
  the upload. Keep its request id, make the session ids before it, and open
  `udm=50&q=<question>&vsrid=…&gsessionid=…`. Cost: S on top of the session
  flow.
- **Ask about the page around it**: add `Payload.content` with the page's
  inner text (and URL/title) to an upload. M. It sends page text to Google,
  which the script has never done, so it has to be opt-in and say so.
- `udm=50` does show the uploaded picture to a browser that did not upload it
  (verified, see the session flow above).

## Authentication, cookies, consent

- The `lensfrontend-pa` API takes the public Chrome key and nothing else. The
  objects, interaction and cluster-info requests all answered 200 with no
  cookies and no OAuth.
- Chrome's own fetches are `cookies_allowed: YES` from the user's store, so a
  userscript sending cookies is not doing anything Chrome does not.
- **The results page is a normal Google page**: it uses the browser's own
  cookies, consent state and anti-abuse checks. Opened in the user's browser
  that is invisible. Fetched from a server or a fresh WebView it is not:
  cookie-less clients in the EU get bounced to `consent.google.com` (seen on
  `lens.google.com/v3/upload`), and an unfamiliar IP gets the "unusual traffic"
  CAPTCHA. That is one more reason to *open* results rather than fetch them.
- Do not try to automate past either page.

## Protos: this repo against Chromium `main`

Everything this script reads is unchanged. The differences:

- `lens_overlay_server.proto`: `LensOverlayServerRequest.process_image_for_aim = 7`.
- `lens_overlay_interaction_request_metadata.proto`: `is_aim_fulfillment_context = 5`.
- `lens_overlay_contextual_inputs.proto`: `upload_type`, `drive_id`,
  `is_viewport_image` and the `LensOverlayContextualInputUploadType` enum.
- `lens_overlay_lens_file.proto`: `annotated_page_content_uri`, `file_uri`,
  `screenshot_uri`.
- `lens_overlay_visual_search_interaction_data.proto`: edition 2023 → 2024, no
  field change.
- New files, absent here: `added_inputs`, `aim_communication`, `aim_icon`,
  `aim_query`, `aim_thumbnail`, `modality_chip_props`, `search_communication`.
  chrome-lens-py already carries `added_inputs`, `aim_icon`, `aim_query`,
  `aim_thumbnail` and `modality_chip_props`; it leaves out `aim_communication`
  and `search_communication` because they import `third_party/omnibox_proto`.

For the session flow above this repo needs `LensOverlayServerClusterInfoRequest`
/ `Response`, `LensOverlayRoutingInfo`, `LensOverlayInteractionRequest`,
`LensOverlayInteractionRequestMetadata` (+ its nested selection types),
`ImageCrop`, `ZoomedCrop`, `ClientImage` and `OverlayObject` in the `WANTED` set
of `scripts/gen-fields.ts`. No new `.proto` file is needed for capabilities 3–13.

## Source map

| File | What to read it for |
|---|---|
| `chrome/browser/ui/lens/lens_overlay_url_builder.cc` | `BuildLensSearchURL`, `BuildTextOnlySearchURL`, the `stick` builders, `udm` / `lns_mode` values, shopping-in-new-tab |
| `chrome/browser/ui/lens/lens_overlay_query_controller.cc` | the whole flow: cluster info, objects, interaction, page content, chunking, OAuth fallback, `gsessionid` on `crupload` |
| `components/lens/lens_overlay_request_id_generator.cc` | how `sequence_id`, `image_sequence_id`, `long_context_id` and `analytics_id` move per request kind |
| `components/lens/lens_url_utils.cc` | `source=` values per entry point, common params, the `lens.google.com` query string |
| `components/lens/lens_features.cc` | every endpoint URL and lifetime as a feature param |
| `components/lens/lens_request_construction.cc` | OAuth / variations headers |
