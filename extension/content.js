(() => {
  "use strict";
  const ACTIVE = "data-feed-grin-active";
  const HIDDEN = "data-feed-grin-hidden";
  const HOST_ID = "feed-grin-replacement";
  const POSTS = [
    ".feed-shared-update-v2",
    '[data-urn^="urn:li:activity:"]',
    '[data-id^="urn:li:activity:"]',
    '[data-view-name="feed-full-update"]',
    'article[data-id="main-feed-card"]'
  ].join(",");
  const AD_MARKERS = [
    '[data-ad-id]', '[data-ad-label]', '[data-is-sponsored="true"]',
    '[data-sponsored="true"]', '[data-view-name*="sponsored"]',
    '[data-view-name*="advertisement"]',
    '.feed-shared-update-v2--is-sponsored', '.update-components-promo',
    '[componentkey*="sponsoredContent" i]', '[data-sponsored-tracking-url]'
  ].join(",");
  const SUBTITLE = [
    '.update-components-actor__sub-description',
    '.feed-shared-actor__sub-description',
    '[data-view-name="feed-actor-sub-description"]'
  ].join(",");
  const FEED = '[data-testid="mainFeed"]';
  const PROSE = '[data-testid="expandable-text-box"], [componentkey^="feed-commentary"], .update-components-text, .feed-shared-text';
  const COMMENTS = '[data-testid*="comment" i], [componentkey^="comment-"], .comments-comments-list';
  const AD_WORDS = /\b(?:promoted|sponsored|advertisement|gesponsert|sponsorisé|sponsorisée|sponsorizzato|patrocinado|patrocinada|gesponsord|sponsorowane|promowane|sponsrad|sponsoreret|sponset|mainostettu)\b|реклам|продвига|спонсор|赞助|推廣|推介|広告|プロモーション|스폰서|홍보|إعلان|ممول/iu;
  // Unknown headers remain visible to avoid hiding unrecognized ads.
  const AGE = /^\s*\d+\s*(?:s|m|h|d|w|mo|yr|sec|seconds?|min|minutes?|hr|hours?|day|days|week|weeks|month|months|year|years|ч|мин|сек|д|дн|нед|мес|г|года|лет|hace|Std|Wo|Tg|j|sem|ans?)(?=\s|[.•·]|$)/iu;
  let settings = { enabled: true, hideAds: true, showTrollface: true };
  let ready = false;
  let active = false;
  let host = null;
  let pending = false;
  const hidden = new Set();
  let stats = { feedFound: false, cards: 0, ads: 0, adsHidden: 0, unknown: 0, hidden: 0 };

  function isFeed(url) {
    const pathname = new URL(url, location.href).pathname;
    return /^\/feed(?:\/|$)/i.test(pathname) && !/^\/feed\/update(?:\/|$)/i.test(pathname);
  }
  function restore() {
    for (const element of hidden) element.removeAttribute(HIDDEN);
    hidden.clear();
    stats = { feedFound: false, cards: 0, ads: 0, adsHidden: 0, unknown: 0, hidden: 0 };
    host?.remove();
    host = null;
  }
  function setRoute(url = location.href) {
    active = ready && (settings.enabled || settings.hideAds) && isFeed(url);
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
  function normalize(text = "") {
    return text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/gu, " ").trim();
  }
  function trackingHas(card, key) {
    return [card, ...card.querySelectorAll("[data-view-tracking-scope]")].some((node) => {
      const text = node.getAttribute("data-view-tracking-scope");
      if (!text) return false;
      try {
        const stack = [JSON.parse(text)];
        while (stack.length) {
          const value = stack.pop();
          if (!value || typeof value !== "object") continue;
          if (Array.isArray(value.transporterKeys) && value.transporterKeys.includes(key)) return true;
          stack.push(...Object.values(value).filter((item) => item && typeof item === "object"));
        }
      } catch { /* Incomplete tracking markup stays unclassified. */ }
      return false;
    });
  }
  function findCards(scope) {
    const candidates = new Set([...scope.querySelectorAll(POSTS)].map((post) => post.closest(".occludable-update") || post));
    const feeds = scope.matches(FEED) ? [scope] : [...scope.querySelectorAll(FEED)];
    for (const feed of feeds) {
      for (const post of feed.querySelectorAll('[role="listitem"]')) {
        // A comment's listitem is part of its parent post, not a separate card.
        if (post.closest(COMMENTS)) continue;
        const parent = post.parentElement?.closest('[role="listitem"]');
        if (!parent || !feed.contains(parent)) candidates.add(post);
      }
      const fallback = [...feed.querySelectorAll('[data-lazy-mount-id], article[data-id="main-feed-card"]')];
      for (const post of fallback) {
        if (post.closest(COMMENTS)) continue;
        if ([...candidates].some((other) => other.contains(post) || post.contains(other))) continue;
        if (fallback.some((other) => other !== post && post.contains(other))) continue;
        candidates.add(post);
      }
    }
    return [...candidates].filter((card) => ![...candidates].some((other) => other !== card && other.contains(card)));
  }
  function metadataLabels(card) {
    const nodes = new Set(card.querySelectorAll(SUBTITLE));
    if (card.closest(FEED)) {
      const prose = card.querySelector(PROSE);
      for (const node of card.querySelectorAll('p, span, time, [aria-label]')) {
        if (node.closest(PROSE) || node.closest(COMMENTS)) continue;
        // Inspect the author/header area, not labels or timestamps inside the post.
        if (prose && !(node.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (normalize(node.textContent).length <= 160) nodes.add(node);
      }
    }
    const labels = [];
    for (const node of nodes) {
      labels.push(normalize(node.textContent), normalize(node.getAttribute("aria-label") || ""));
      for (const child of node.querySelectorAll('[aria-hidden="true"], time')) labels.push(normalize(child.textContent));
    }
    return labels.filter(Boolean);
  }
  function classify(card) {
    if (card.matches(AD_MARKERS) || card.querySelector(AD_MARKERS) || trackingHas(card, "sponsored")) return "ad";
    const labels = metadataLabels(card);
    if (labels.some((label) => AD_WORDS.exec(label)?.index === 0)) return "ad";
    if (labels.some((label) => AGE.test(label))) return "organic";
    if (card.closest(FEED) && trackingHas(card, "default") && card.querySelector('a[href*="/in/"], a[href*="/company/"]') && card.querySelector(PROSE)) return "organic";
    return "unknown";
  }
  function reconcile() {
    if (!active) return;
    const main = document.querySelector(FEED) || document.querySelector("main") || document.querySelector('[role="main"]') || document.querySelector(".scaffold-layout__main");
    if (!main) { restore(); return; }
    const cards = findCards(main);
    stats = { feedFound: true, cards: cards.length, ads: 0, adsHidden: 0, unknown: 0, hidden: 0 };
    const nextHidden = new Set();
    for (const card of cards) {
      const type = classify(card);
      if (type === "ad") {
        stats.ads++;
        if (!settings.hideAds) continue;
        stats.adsHidden++;
      } else if (type === "organic") {
        if (!settings.enabled) continue;
      } else { stats.unknown++; continue; }
      stats.hidden++;
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
    settings = { enabled: values.enabled !== false, hideAds: values.hideAds !== false, showTrollface: values.showTrollface !== false };
    ready = true;
    sync();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue !== false;
    if (changes.hideAds) settings.hideAds = changes.hideAds.newValue !== false;
    if (changes.showTrollface) settings.showTrollface = changes.showTrollface.newValue !== false;
    sync();
  });
  new MutationObserver(() => { setRoute(); schedule(); }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["class", "role", "data-view-name", "data-ad-id", "data-ad-label", "data-is-sponsored", "data-sponsored", "aria-label", "data-urn", "data-id", "data-testid", "data-lazy-mount-id", "componentkey", "data-view-tracking-scope", "data-sponsored-tracking-url"]
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "feed-grin-status") return;
    sync();
    respond({ version: chrome.runtime.getManifest().version, enabled: settings.enabled, hideAds: settings.hideAds, onFeed: isFeed(location.href), ...stats });
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
