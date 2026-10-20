(() => {
  "use strict";
  const ACTIVE = "data-feed-grin-active";
  const HIDDEN = "data-feed-grin-hidden";
  const HOST_ID = "feed-grin-replacement";
  const POSTS = [
    ".feed-shared-update-v2",
    '[data-urn^="urn:li:activity:"]',
    '[data-id^="urn:li:activity:"]',
    '[data-view-name="feed-full-update"]'
  ].join(",");
  const AD_MARKERS = [
    '[data-ad-id]', '[data-ad-label]', '[data-is-sponsored="true"]',
    '[data-sponsored="true"]', '[data-view-name*="sponsored"]',
    '[data-view-name*="advertisement"]',
    '.feed-shared-update-v2--is-sponsored', '.update-components-promo'
  ].join(",");
  const SUBTITLE = [
    '.update-components-actor__sub-description',
    '.feed-shared-actor__sub-description',
    '[data-view-name="feed-actor-sub-description"]'
  ].join(",");
  const AD_WORDS = /\b(?:promoted|sponsored|advertisement|gesponsert|sponsorisé|sponsorisée|sponsorizzato|patrocinado|patrocinada|gesponsord|sponsorowane|promowane|sponsrad|sponsoreret|sponset|mainostettu)\b|реклам|продвига|спонсор|赞助|推廣|推介|広告|プロモーション|스폰서|홍보|إعلان|ممول/iu;
  // Unknown headers remain visible to avoid hiding unrecognized ads.
  const AGE = /^\s*\d+\s*(?:s|m|h|d|w|mo|yr|sec|seconds?|min|minutes?|hr|hours?|day|days|week|weeks|month|months|year|years|ч|мин|сек|д|дн|нед|мес|г|года|лет|hace|Std|Wo|Tg|j|sem|ans?)(?=\s|[.•·]|$)/iu;
  let settings = { enabled: true, showTrollface: false };
  let ready = false;
  let active = false;
  let host = null;
  let pending = false;
  const hidden = new Set();

  function isFeed(url) {
    const pathname = new URL(url, location.href).pathname;
    return /^\/feed(?:\/|$)/i.test(pathname) && !/^\/feed\/update(?:\/|$)/i.test(pathname);
  }
  function restore() {
    for (const element of hidden) element.removeAttribute(HIDDEN);
    hidden.clear();
    host?.remove();
    host = null;
  }
  function setRoute(url = location.href) {
    active = ready && settings.enabled && isFeed(url);
    document.documentElement.toggleAttribute(ACTIVE, active);
    if (!active) restore();
  }
  function makeReplacement() {
    const element = document.createElement("div");
    element.id = HOST_ID;
    const shadow = element.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light; }
      .frame {
        box-sizing: border-box; display: grid; place-items: center;
        min-height: 320px; padding: clamp(16px, 4vw, 40px);
        border-radius: 12px; background: #fff;
      }
      img { display: block; width: min(100%, 360px); height: auto; object-fit: contain; }
    `;
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.setAttribute("role", "region");
    frame.setAttribute("aria-label", "Пользовательская лента скрыта расширением Feed Grin");
    const image = document.createElement("img");
    image.src = chrome.runtime.getURL("assets/replacement.jpg");
    image.alt = "Троллфейс вместо пользовательской ленты LinkedIn";
    image.width = 900;
    image.height = 900;
    image.draggable = false;
    frame.append(image);
    shadow.append(style, frame);
    return element;
  }
  function classify(card) {
    if (card.matches(AD_MARKERS) || card.querySelector(AD_MARKERS)) return "ad";
    const subtitles = [...card.querySelectorAll(SUBTITLE)];
    if (subtitles.some((node) => AD_WORDS.test(`${node.textContent} ${node.getAttribute("aria-label") || ""}`))) return "ad";
    if (subtitles.some((node) => AGE.test(node.textContent.trim()))) return "organic";
    return "unknown";
  }
  function reconcile() {
    if (!active) return;
    const main = document.querySelector("main") || document.querySelector('[role="main"]') || document.querySelector(".scaffold-layout__main");
    if (!main) { restore(); return; }
    const candidates = new Set([...main.querySelectorAll(POSTS)].map((post) => post.closest(".occludable-update") || post));
    const cards = [...candidates].filter((card) => ![...candidates].some((other) => other !== card && other.contains(card)));
    const nextHidden = new Set();
    for (const card of cards) {
      if (classify(card) !== "organic") continue;
      nextHidden.add(card);
      card.setAttribute(HIDDEN, "");
      card.querySelectorAll("video, audio").forEach((media) => {
        if (!media.paused) media.pause();
      });
    }
    for (const card of hidden) if (!nextHidden.has(card)) card.removeAttribute(HIDDEN);
    hidden.clear();
    for (const card of nextHidden) hidden.add(card);
    const first = nextHidden.values().next().value;
    if (settings.showTrollface && first) {
      if (!host) host = makeReplacement();
      if (host.nextElementSibling !== first || host.parentElement !== first.parentElement) first.before(host);
    } else { host?.remove(); host = null; }
  }
  function sync() { setRoute(); reconcile(); }
  function schedule() {
    if (pending || !active) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; sync(); });
  }
  chrome.storage.local.get(settings).then((values) => {
    settings = { enabled: values.enabled !== false, showTrollface: values.showTrollface === true };
    ready = true;
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue !== false;
    if (changes.showTrollface) settings.showTrollface = changes.showTrollface.newValue === true;
    sync();
  });
  new MutationObserver(() => { setRoute(); schedule(); }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["class", "role", "data-view-name", "data-ad-id", "data-ad-label", "data-is-sponsored", "data-sponsored", "aria-label", "data-urn", "data-id"]
  });
  window.navigation?.addEventListener("navigate", (event) => {
    setRoute(event.destination.url);
    schedule();
  });
  window.addEventListener("popstate", sync);
  window.addEventListener("pageshow", sync);
  document.addEventListener("DOMContentLoaded", sync, { once: true });
  window.setInterval(sync, 750);
  document.addEventListener("play", (event) => {
    if (!active || !(event.target instanceof HTMLMediaElement)) return;
    for (const card of hidden) if (card.contains(event.target)) { event.target.pause(); break; }
  }, true);
})();
