#!/usr/bin/env python3
"""AETHERION entire-site HTML integrity and responsive brand contract.
Static checks only; visual layout is covered by tools/site_browser_smoke.cjs.
"""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import collections
import posixpath
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
IGNORE_DIRS = {".git", "node_modules", "vendor", "_site"}
CORE_PAGES = [
    "index.html", "news/index.html", "news/post/index.html", "patch-notes/index.html",
    "status/index.html", "share/index.html", "models/index.html"
]
# App pages: full-screen UI without the marketing header/footer; only references and basics are checked.
APP_PAGES = ["playground/index.html"]

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.sources = []
        self.html_lang = None
        self.main_ids = []
        self.legal = False
        self.brand = False
        self.styles = []
        self.elements = collections.Counter()
        self.viewport = False
        self.nav_labels = []
        self.in_head = False
        self.inline_buttons = []
    def handle_starttag(self, tag, attrs):
        self.elements[tag] += 1
        x = dict(attrs)
        if tag == "html":
            self.html_lang = x.get("lang")
        if "id" in x:
            self.ids.append(x["id"])
        if tag == "main":
            self.main_ids.append(x.get("id"))
        if tag == "nav" and "aria-label" in x:
            self.nav_labels.append(x["aria-label"])
        if tag == "header" and "ae-header" in x.get("class",""):
            self.brand = True
        if tag == "footer" and "ae-footer" in x.get("class",""):
            self.legal = True
        if tag == "a":
            self.links.append(x.get("href",""))
        if tag in ("script","img","iframe"):
            src = x.get("src")
            if src:
                self.sources.append(src)
        if tag == "link":
            href = x.get("href")
            if href:
                self.sources.append(href)
                if x.get("rel") == "stylesheet":
                    self.styles.append(href)
        if tag == "meta" and x.get("name") == "viewport":
            self.viewport = True
        if tag == "button" and x.get("onclick"):
            self.inline_buttons.append(x.get("onclick"))
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

def normalize(from_page, target):
    u = urlsplit(target)
    if u.scheme or u.netloc or target.startswith("//"):
        return None
    if target.startswith("#"):
        base = "/" + from_page.as_posix()
    elif u.path.startswith("/"):
        base = u.path
    else:
        base = "/" + posixpath.join(from_page.parent.as_posix(),u.path)
    base = posixpath.normpath(unquote(base))
    if base == "/":
        return "index.html", u.fragment
    if target.split("?")[0].split("#")[0].endswith("/") or not Path(base).suffix:
        base += "/index.html"
    return base.lstrip("/"),u.fragment

def main():
    errors = []
    pages = {}
    for filename in CORE_PAGES:
        path = ROOT / filename
        if not path.is_file():
            errors.append(f"{filename}: missing HTML page")
            continue
        raw = path.read_text("utf-8")
        dom = Page()
        try:
            dom.feed(raw)
            dom.close()
        except Exception as ex:
            errors.append(f"{filename}: HTML parse error: {ex}")
            continue
        pages[filename] = dom
        if not raw.lstrip().lower().startswith("<!doctype html>"):
            errors.append(f"{filename}: missing doctype")
        if dom.html_lang != "ko":
            errors.append(f"{filename}: expected html[lang=ko], got {dom.html_lang}")
        if not dom.viewport:
            errors.append(f"{filename}: missing responsive viewport")
        if dom.main_ids != ["main"]:
            errors.append(f"{filename}: must have exactly one <main id=main>; got {dom.main_ids}")
        if not dom.brand or not dom.legal:
            errors.append(f"{filename}: missing unified ae-header/ae-footer")
        if not any("/assets/brand.css" in x for x in dom.styles):
            errors.append(f"{filename}: missing brand stylesheet")
        duplicates = [id for id,c in collections.Counter(dom.ids).items() if c > 1]
        if duplicates:
            errors.append(f"{filename}: duplicated element ids {duplicates}")
        if not dom.nav_labels:
            errors.append(f"{filename}: navigation needs accessible label")
        if not any(x == "#main" for x in dom.links):
            errors.append(f"{filename}: accessible skip-to-main missing")
        if not any(x.startswith("/playground/") for x in dom.links):
            errors.append(f"{filename}: universal playground link missing")
        if dom.elements["h1"] < 1:
            errors.append(f"{filename}: missing first-level heading")
        if dom.inline_buttons:
            errors.append(f"{filename}: inline onclick javascript is not permitted")
    for filename in APP_PAGES:
        path = ROOT / filename
        if not path.is_file():
            errors.append(f"{filename}: missing HTML page"); continue
        raw = path.read_text("utf-8"); dom = Page(); dom.feed(raw); dom.close(); pages[filename] = dom
        if dom.html_lang != "ko" or not dom.viewport or dom.main_ids != ["main"]:
            errors.append(f"{filename}: needs html[lang=ko], viewport and one <main id=main>")
        duplicates = [id for id,c in collections.Counter(dom.ids).items() if c > 1]
        if duplicates:
            errors.append(f"{filename}: duplicated element ids {duplicates}")
    for legacy in ("chat", "agent", "lab", "runtime", "legacy"):
        if (ROOT / legacy).exists():
            errors.append(f"/{legacy}/ was retired in v4 and must not come back without updating the audit")
    for filename in pages:
        if re.search(r'href="/(chat|agent|lab|runtime|legacy)/', (ROOT / filename).read_text("utf-8")):
            errors.append(f"{filename}: links to a retired page")
    # All locally referenced files and internal links, incl intra-document targets.
    links_checked=0
    for filename,dom in pages.items():
        from_path=Path(filename)
        for url in dom.links+dom.sources:
            if not url or url.startswith(("data:", "blob:", "mailto:", "tel:", "javascript:")):
                continue
            resolved=normalize(from_path,url)
            if resolved is None:
                continue
            target,fragment=resolved
            source = ROOT / target
            if not source.is_file():
                errors.append(f"{filename}: missing reference {url} -> {target}")
                continue
            links_checked += 1
            if fragment and target in pages:
                if fragment not in pages[target].ids:
                    errors.append(f"{filename}: missing fragment target {url} (#{fragment})")
    if errors:
        print(f"FAIL {len(errors)} site issues:")
        for issue in errors[:150]:
            print(" -",issue)
        return 1
    print(f"PASS {len(pages)} Korean pages; {links_checked} static links/scripts/styles verified, unique DOM IDs, accessible menus and hash targets")
    return 0

if __name__ == "__main__":
    sys.exit(main())
