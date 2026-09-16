"""Render-check harness: runs the userscript's real rendering code in a page.

Usage: python demo/build_render_check.py [image] [target-lang]
Needs a running daemon:  lens_scan --serve
"""
import base64, json, os, sys, urllib.request
IMAGE = sys.argv[1] if len(sys.argv) > 1 else "probe.png"
LANG = sys.argv[2] if len(sys.argv) > 2 else "ru"
body = json.dumps({"image": os.path.abspath(IMAGE), "translate_to": LANG}).encode()
req = urllib.request.Request("http://127.0.0.1:8765/v1/ocr", data=body,
                             headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=90) as r:
    result = json.load(r)
blocks = result["translation_render_data"]
print("blocks:", len(blocks), "lines:", sum(len(b["lines"]) for b in blocks))

js = open(os.path.join(os.path.dirname(__file__), "..", "src", "lens-translate.user.js"), encoding="utf-8").read()
# lift the pure rendering helpers out of the userscript so the page runs the real code
consts = js[js.index("  const MIN_FONT_SIZE"):js.index("  GM_addStyle(")]
start = js.index("  const argb = (v) =>")
end = js.index("  function badge(")
core = consts + js[start:end]

img64 = base64.b64encode(open(IMAGE,"rb").read()).decode()
html = """<!doctype html><meta charset=utf-8><title>userscript render check</title>
<style>
.clp-wrap{position:relative!important;display:inline-block}
.clp-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.clp-bg{position:absolute}
.clp-line{position:absolute;display:flex;align-items:center;white-space:pre;line-height:1;
 transform-origin:center center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{margin:0;background:#fff;font:14px system-ui}
</style>
<img id="pic" src="data:image/png;base64,__IMG__">
<script>
const BLOCKS = __BLOCKS__;
__CORE__
const img = document.getElementById('pic');
img.onload = () => { renderBlocks(img, BLOCKS); document.title = 'rendered'; };
if (img.complete) img.onload();
</script>"""
html = html.replace("__IMG__", img64).replace("__BLOCKS__", json.dumps(blocks)).replace("__CORE__", core)
open("userscript_check.html","w",encoding="utf-8").write(html)
print("wrote userscript_check.html", len(html), "bytes")
