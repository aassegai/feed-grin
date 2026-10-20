"use strict";
const enabled = document.getElementById("enabled");
const showTrollface = document.getElementById("showTrollface");
const status = document.getElementById("status");
function render(values) {
  enabled.checked = values.enabled !== false;
  showTrollface.checked = values.showTrollface === true;
  enabled.disabled = false;
  showTrollface.disabled = !enabled.checked;
  status.textContent = enabled.checked ? "Скрытие ленты включено" : "Скрытие ленты выключено";
}
async function load() {
  try { render(await chrome.storage.local.get({ enabled: true, showTrollface: false })); }
  catch { status.textContent = "Не удалось загрузить настройки. Откройте окно ещё раз."; }
}
async function save() {
  enabled.disabled = true;
  showTrollface.disabled = true;
  try {
    const values = { enabled: enabled.checked, showTrollface: showTrollface.checked };
    await chrome.storage.local.set(values);
    render(values);
  } catch { await load(); status.textContent = "Не удалось сохранить настройки. Попробуйте ещё раз."; }
}
enabled.addEventListener("change", save);
showTrollface.addEventListener("change", save);
load();
