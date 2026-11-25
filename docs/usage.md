# Using it

Everything the script can do, and every setting, past the short version in the [README](../README.md).

## The basics

Alt+click an image, or use the button that appears when you hover one. Click again to undo. **On a touch screen there is no hover**, and the tap that would summon the button is the same tap a reader uses to turn the page - so there the button is pinned instead, sitting over whichever image fills most of the viewport and following the scroll. **When to show them** in settings forces either behaviour. Settings live in the userscript manager's menu under **Lens Translate: settings** — or, since AdGuard has no such menu, behind the gear that appears next to the hover button. Every command on this page is in that panel under **Actions** as well as in the menu, so every host can reach all of them.

## What you can do

| | how |
|---|---|
| Translate one image | Alt+click it (the modifier is a setting), or the button on hover; tap the pinned button on a touch screen |
| Undo it | the button again |
| **See the original** while looking | **hold the button** for a third of a second - the translation steps aside and comes back when you let go. On a touch screen a long press does the same |
| See every original at once | hold a key: backtick, Shift or Ctrl, chosen under **Hold to see the original** (off by default) |
| **Translate everything in view** | **Alt+Shift+T**, or *Translate all in view* in the menu and the panel. Two at a time, one summary at the end. Ignored while you are typing in a field; the chord is a setting |
| **Copy the translation** or **the original text** | the small `...` button next to the gear (it appears with it), or right-click the main button. The original is whatever Lens could read, including text it could not translate |
| Switch it off on one site | **Off** for this site in General - the button disappears, Alt+click is the page's again and any translations come down |
| **Translate as you read** | **Translate as you scroll** in General, for every site, or **Automatic** for this site alone. A picture is translated once most of it is on screen and the scroll has settled; one that had no text is not asked about again, and one you undid stays undone. Pictures under a size, plainly bare ones (a sky, a flat graphic) and anything past a number of requests a minute are left alone - all settings under Behaviour |
| **Translate the pictures with the page** | translate the page with the browser (Chrome's translate bar, or any browser that marks the page's language) and the pictures follow, into the same language, as you scroll; **Show original** takes them down. **Follow the browser's page translation** under Behaviour turns it off |
| **Copy or save the translated picture** | *Copy the picture* / *Save the picture* in the menu of a translated picture. A copy that the browser refuses is saved instead; on a phone, saving opens the share sheet |
| **Fix a translation by hand** | *Edit the translation* in the same menu: tap a paragraph to change its words, size, colours, hide it or show the original there; drag it to move the text. The edits are kept with the stored answer, so they come back after a reload |
| Clear the cache, undo a whole page, run diagnostics | the menu, or **Quick actions** in General |

## Settings, buttons and shortcuts

The settings window has two lengths. **Simple**, the default, is one page: what is switched on and for this site, the interface, and the handful of settings that matter. **Pro** is every setting there is, in tabs - General, Translation, Search, Appearance, Buttons, Behaviour, Sites, Advanced, About - down the side on a wide screen and as a strip along the top of a sheet on a phone. In pro mode:

- **Search** at the top finds a setting on any tab by its label, its hint or its key.
- A field that is not at its default grows a small **reset** arrow beside its name, and each tab has **Reset this tab**. Nothing is kept until **Save**; closing with unsaved changes asks first.
- **About** exports every setting to a JSON file and imports one back. An import is checked key by key against what each setting can hold: unknown keys and unusable values are skipped and named, and what was understood lands in the form for you to look at before saving.
- **Appearance** holds everything about how a translation is drawn - font family and weight, text, outline and fill colours (blank follows what Lens sampled), outline width, erasing, the readable-size floor, line spacing, sharpness, opacity. Each has a line saying what it buys and what it costs. The defaults are Chromium's behaviour throughout.
- **Buttons** chooses which controls sit over a picture and in what order - drag a row, or use its arrows - from translate, search image, ask AI, select area, detected objects, search text, copy, settings and the menu. Ticked ones are in the row; the list's order is also the menu's. The **main button** can translate (default), search, ask AI, select an area or open the menu, and can be set to repeat whatever you last chose. Holding it shows the original, as before, or does any of those instead. Size, corner, idle opacity, labels and the delays are there too.
- **Behaviour** binds a key chord to each action: press the field's button, then the keys. Only *translate all in view* (Alt+Shift+T) is bound out of the box. Shortcuts are ignored while you type in a field, and a picture shortcut acts on the picture under the cursor or, failing that, the largest in view.
- **Sites** shows this site's rule and every other site that has one.

## Search with the picture

The menu (the `...` button) does more than translate. **Simple** mode, the default, keeps it to what anyone needs:

| | what happens |
|---|---|
| **Search this image** | Google's Lens results open in a new tab: visual matches, exact matches, an AI overview, and a *Products* / *Shopping* tab where there is something to buy |
| **Ask AI about it** | Google AI Mode opens with the picture attached and your question - prefilled, so one tap is enough |
| Copy text | what Lens read, or the translation |

**Pro** mode (*Interface* in settings) adds the precise tools, and shows every setting:

| | what happens |
|---|---|
| **Select an area** | drag a box over the picture - finger, mouse or pen - then search it or ask AI about just that part. The crop is sent at full resolution, so small things stay legible |
| **Detected objects** | the things Lens found are marked on the picture; tap one to search for it |
| **Search selected text** | pick words Lens read and search them on Google - no picture is sent |

Results always open in your own browser, signed in as you are. On a phone, where a new tab may only be opened by a tap, the button turns into an **Open results** link when they are ready. Searching sends the picture to Google, as translating does, and nothing else from the page.

How the picture and the results page find each other is written up in [docs/lens-capabilities.md](lens-capabilities.md), with what Lens can do that this script does not (yet).

The per-site choice is per hostname (`www.` is the same site as the bare name) and is kept in the userscript manager's own storage, not the site's.

Backgrounds work too, with a catch: a CSS `background-image` is only offered when it is painted once. A texture tiled behind the page, a sprite, an icon on a button are all `background-image` and none has text to translate, so a repeating background counts only when its size always fills the box (`cover`, or an explicit size at least as big), and one smaller than **Ignore images under** is ignored. The translation is laid where the browser painted the picture - honouring `background-size`, `-position`, `-origin` and `-clip` - and a layout it cannot follow (tiled, fixed to the viewport, clipped to text) is refused rather than guessed at. The `overlay` renderer cannot follow a background and says so.

## Look

**Popup opacity** in settings (40-100%) lets the picture show through the menu, the settings panel, messages and a tool's bar - their backgrounds only; the text on them stays solid, and below 100% the background is blurred so the words stay readable over a busy picture. Moving the slider changes the open panel as you drag. Next to it, **Theme** (system, light or dark) and **Accent colour** (neutral, blue, violet, green, orange or rose) change the menus and panels, the switches and primary buttons, and the translate button over a picture; a choice shows on the open panel at once and is kept on Save.

## Turning it off

The commands are **settings**, **clear cache**, **undo all on this page**, **toggle on/off**, **translate all visible images**, **toggle on/off for this site**, **toggle auto-translate for this site**, **diagnostics**, and **copy translation** / **copy original text** (those two act on the picture you last used and are only in the host's menu; the panel's copy buttons are in the `...` menu beside the picture). They sit in the host's userscript menu where there is one, and the ones that act rather than switch are under **Quick actions** in the settings panel either way (the switches are switches there) — which is how they are reached on AdGuard, which has no menu. There is also an `enabled` checkbox in settings; with it off, the hover button does nothing and says so.

Hovering an image shows the translate button, and holding the cursor there for another half second brings up the settings and menu buttons next to it.

## Install, in more detail

Every version is also tagged, so `raw/v2.5.0/dist/lens-translate.user.js` is a
working script forever where `main` is only ever the latest one - worth knowing
if an update ever goes wrong on you. Update checks read
[`dist/lens-translate.meta.js`](https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.meta.js),
the same header with no code in it, so a manager polling for a new version does
not download the whole script to find out there is not one.

Or build it yourself: see [Development](development.md).
