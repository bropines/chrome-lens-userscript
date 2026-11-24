# When it does not work

Finding out why, on a desktop and on a phone - and what differs between userscript hosts.

A userscript on a phone fails quietly. There is no console to open, the host
reports one word for every kind of network failure, and "network error" covers a
transport that never sent the request, a domain the device is blocking, and a
phone that is simply offline. Four things, cheapest first.

## 1. Run the diagnostics

**Put `#lens-debug` on the end of the URL** and the report opens. It needs no
button and no menu, which is the point: the hover button is exactly what is
missing when something is wrong, and `GM_registerMenuCommand` has nowhere to
appear on a phone at all - no mobile browser has a userscript menu, whatever
the host reports. The report carries a **Settings** button too, so the panel is
reachable when the gear is not.

It is also in **Settings → Actions → Run diagnostics**, and in the userscript
menu on a host that has one. It reports what host is running the script and what it grants, then probes
the Lens endpoint and a control host through both transports:

```
host: AdGuard 4.9.16
script: 2.2.0
context: page (AdGuard-style)
xmlhttpRequest: yes, getValue: yes, setValue: yes, registerMenuCommand: NO
page: https://example.com

gm -> lens       via AdGuard: network error, 12 ms
fetch -> lens    HTTP 404, 210 ms
gm -> control    HTTP 204, 180 ms
fetch -> control HTTP 204, 160 ms
```

A `HTTP` of any kind means the request left the device and came back. That is
exactly what "network error" cannot tell you, and two things had to be right
before it could be trusted:

- **The probe sends the real request**, not a convenient `GET`. A `GET` to the
  Lens endpoint is answered `404` with no CORS headers at all, so a page `fetch`
  cannot read it and reports the same `Failed to fetch` a blocked domain would.
  The real `POST` comes back with `Access-Control-Allow-Origin` set.
- **A status is an answer wherever it arrives.** AdGuard routes every non-2xx
  through `onerror` rather than `onload`, so a plain `404` looks like a network
  failure unless the status is read off it.

The last line reads the four results:

- **Lens answers one way but not the other** — that host's transport is broken,
  and the script is already working around it.
- **Lens answers neither way, the control does** — this device is blocking
  `lensfrontend-pa.googleapis.com`. Search the AdGuard activity log for
  `googleapis`, and check DNS filtering and the HTTPS filtering exclusions.
- **Nothing answers** — no working connection from this page.

**Copy** puts the whole report on the clipboard, which is the useful thing to
attach to a bug report.

## 2. Real DevTools, over USB

Anything past the transport needs the browser's own console, and on Android it
is one cable away:

1. On the phone: **Settings → About phone**, tap **Build number** seven times,
   then **Developer options → USB debugging**.
2. Plug it into a computer and accept the prompt.
3. In desktop Chrome open `chrome://inspect/#devices`, find the tab, press
   **inspect**. That is a full DevTools — Console, Network, the lot — attached
   to the page on the phone.

Which context the errors land in depends on the host, and the diagnostics report
says which: `context: page` means the ordinary console has them, `sandbox` means
the console's context dropdown does. AdGuard has shipped both.

The Network tab settles the question the diagnostics can only infer: whether the
`POST` to `crupload` left at all, and what it came back with.

## 3. A console on the page itself

No cable, when a report is not enough. AdGuard documents no debugging of its
own - `GM_log` and nothing else - so what people do on Android is install a
second userscript that loads [eruda](https://github.com/liriliri/eruda) and
gives the page a real console, network log and DOM inspector as a floating
button. There is [a gist written for exactly this](https://gist.github.com/jasonsyoung/2661ab375efda4301fc6c1016abfdaaa),
and [Andure](https://github.com/leohku/andure) does the same through AdGuard's
HTTPS filtering, opening on a shake of the phone. Any host that runs this
script runs those.

## 4. What the host thinks it did

AdGuard's **Recent activity** is a DNS log, so a domain missing from it means no
lookup happened, which means nothing was sent — that is how the AdGuard
transport failure here was found. It is not an HTTP log, so a domain *present*
in it does not prove the request succeeded.

## What differs between hosts

Four things, and all of them are handled by the script rather than by the reader:

- **The userscript menu may not exist.** `GM_registerMenuCommand` is absent from [AdGuard's documented API](https://adguard.com/kb/general/userscripts/) and missing from some builds, though 1.2.7 does have it. Nothing here name-checks a version: the commands are registered with the host when it takes them and drawn in the settings panel regardless.
- **Binary bodies are not portable.** Every host implements `GM_xmlhttpRequest`, but none documents which shapes of request body it marshals, and AdGuard has [been loose about `responseType`](https://github.com/AdguardTeam/CoreLibs/issues/1983). The request is sent as a typed array first; a `400`, which is exactly what a mangled protobuf produces, buys one retry as a binary string, and whichever shape returns `200` is used from then on. Responses are read as an ArrayBuffer, a Blob, or `charset=x-user-defined` text, whichever the host produced.
- **A host's transport can fail outright.** On AdGuard for Android it did: `GM_xmlhttpRequest` reported a network error without the request ever leaving the device. So under the two rungs above there is a third — a plain `fetch`. The Lens endpoint answers a CORS preflight (`POST`, `content-type`, `x-goog-api-key`, any origin), so a page-context request reaches it. It is last rather than first because it is the leakier path: the browser attaches an `Origin` header that cannot be removed, telling Google which site the image came from, where `GM_xmlhttpRequest` sends none. Whichever rung answers is remembered, so the dead ones are tried once per page and not again.

An image host is different: there `fetch` is blocked by the very CORS that `GM_xmlhttpRequest` exists to dodge, so that path never remembers a transport and always tries the host's own first.

- **Storage may only be asynchronous.** Tampermonkey, Violentmonkey and AdGuard have `GM_getValue`/`GM_setValue`. Greasemonkey 4 and Safari's Userscripts publish only `GM.getValue`/`GM.setValue`, which return promises, so there is no reading a setting synchronously. Those values are loaded once at startup and the script reapplies them when they arrive (for a few milliseconds it runs on the defaults); writes go to the host straight away. Only a host with neither falls back to `localStorage`, which on AdGuard is the *page's* — so settings would then be per-site — and that is now the last resort rather than what Safari quietly got.
