"use strict";
const enabled = document.getElementById("enabled");
const hideAds = document.getElementById("hideAds");
const showTrollface = document.getElementById("showTrollface");
const status = document.getElementById("status");
let statusRequest = 0;
async function refreshStatus() {
  const request = ++statusRequest;
  if (!enabled.checked && !hideAds.checked) { status.textContent = "Скрытие ленты выключено"; return; }
  let message;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      message = "Откройте ленту LinkedIn для проверки";
    } else {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "feed-grin-status" });
      if (!result.onFeed) message = "Скрытие работает на странице ленты LinkedIn";
      else if (!result.feedFound || !result.cards) message = "Карточки пока не найдены. Обновите LinkedIn.";
      else message = result.hideAds
        ? `Скрыто карточек: ${result.hidden}. Из них рекламных: ${result.adsHidden}.`
        : `Скрыто карточек: ${result.hidden}. Реклама сохранена: ${result.ads}.`;
    }
  } catch { message = "Откройте LinkedIn и обновите вкладку, чтобы подключить расширение."; }
  if (request === statusRequest) status.textContent = message;
}
function render(values) {
  enabled.checked = values.enabled !== false;
  hideAds.checked = values.hideAds !== false;
  showTrollface.checked = values.showTrollface !== false;
  enabled.disabled = false;
  hideAds.disabled = false;
  showTrollface.disabled = !enabled.checked && !hideAds.checked;
  refreshStatus();
}
async function load() {
  try { render(await chrome.storage.local.get({ enabled: true, hideAds: true, showTrollface: true })); }
  catch { status.textContent = "Не удалось загрузить настройки. Откройте окно ещё раз."; }
}
async function save() {
  enabled.disabled = true;
  hideAds.disabled = true;
  showTrollface.disabled = true;
  try {
    const values = { enabled: enabled.checked, hideAds: hideAds.checked, showTrollface: showTrollface.checked };
    await chrome.storage.local.set(values);
    render(values);
  } catch { await load(); status.textContent = "Не удалось сохранить настройки. Попробуйте ещё раз."; }
}
enabled.addEventListener("change", save);
hideAds.addEventListener("change", save);
showTrollface.addEventListener("change", save);
load();
