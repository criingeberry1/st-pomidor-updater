// @ts-check
(function () {
    // --- constants ---
    const MODULE_NAME = 'rentry_proxy_updater';
    const PROXY_PATTERN = /https?:\/\/[a-zA-Z0-9-]+\.(trycloudflare\.com|loca\.lt|ngrok-free\.app|ngrok\.io|ngrok\.app|pinggy\.link|hf\.space|glitch\.me|onrender\.com)[^\s]*/i;
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        rentry_url: 'https://rentry.org/Pomidoranon_proxy/raw',
        append_path: '/proxy/google-ai',
        target_preset: '',
        verbose_logging: false
    });
    let internalLogs = [];

    // --- settings ---
    function getSettings() {
        const context = SillyTavern.getContext();
        if (!context.extensionSettings) context.extensionSettings = {};
        if (!context.extensionSettings[MODULE_NAME]) {
            context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        }
        return context.extensionSettings[MODULE_NAME];
    }

    // --- logging ---
    function log(msg, level = 'info') {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
        const logString = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
        internalLogs.push(logString);
        if (getSettings().verbose_logging) {
            console.log(`[RentryUpdater] ${msg}`);
            const logContainer = $('#rentry-logs-output');
            if (logContainer.length) {
                logContainer.append(`<div class="rentry-log-entry ${level}">${logString}</div>`);
                logContainer.scrollTop(logContainer[0].scrollHeight);
            }
        }
    }

    // --- fetch proxy ---
    async function fetchProxyFromRentry() {
        const settings = getSettings();
        if (!settings.rentry_url) {
            log('Rentry URL не задан', 'error');
            return null;
        }
        const bypassUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(settings.rentry_url)}`;
        log(`HTTP GET (через CORS Proxy Bypass): ${settings.rentry_url}`, 'debug');
        try {
            const response = await fetch(bypassUrl, { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);
            const text = await response.text();

            const snippet = text.substring(0, 150).replace(/\n/g, ' ');
            log(`Ответ получен (${text.length} байт). Текст: "${snippet}..."`, 'debug');

            const match = text.match(PROXY_PATTERN);
            if (match) {
                let proxyUrl = match[0];
                log(`Найден базовый URL: ${proxyUrl}`, 'info');
                if (settings.append_path) {
                    proxyUrl += settings.append_path.startsWith('/') ? settings.append_path : `/${settings.append_path}`;
                    log(`Модифицированный URL: ${proxyUrl}`, 'debug');
                }
                return proxyUrl;
            } else {
                const anyUrlMatch = text.match(/https?:\/\/[a-zA-Z0-9.-]+[^\s]*/i);
                if (anyUrlMatch && !anyUrlMatch[0].includes('rentry.')) {
                    log(`Внимание: найден нестандартный URL (${anyUrlMatch[0]}). Проверь его руками.`, 'error');
                } else {
                    log('Паттерн прокси не найден на странице!', 'error');
                }
                return null;
            }
        } catch (e) {
            log(`Сетевая ошибка при парсинге: ${e.message}`, 'error');
            if (settings.verbose_logging) copyErrorsToClipboard(e.message);
            return null;
        }
    }

    // --- apply proxy ---
    async function applyProxy(proxyUrl) {
        if (!proxyUrl) return;
        const settings = getSettings();
        const context = SillyTavern.getContext();
        $('#openai_reverse_proxy').val(proxyUrl).trigger('input');
        log('DOM элемент #openai_reverse_proxy обновлен', 'info');
        if (settings.target_preset && settings.target_preset.trim() !== '') {
            const pm = context.getPresetManager();
            const presetName = settings.target_preset.trim();
            const preset = pm.getCompletionPresetByName(presetName);
            if (preset) {
                if (preset.reverse_proxy === proxyUrl) {
                    log('Прокси в пресете уже актуален.', 'debug');
                    return;
                }
                preset.reverse_proxy = proxyUrl;
                try {
                    const response = await fetch('/api/presets/save', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({ name: presetName, ...preset })
                    });
                    if (response.ok) {
                        log(`Пресет "${presetName}" успешно сохранен на сервере`, 'info');
                        toastr.success(`Пресет "${presetName}" обновлен!`);
                    } else {
                        throw new Error('Server rejected preset save');
                    }
                } catch (e) {
                    log(`Ошибка сохранения пресета: ${e.message}`, 'error');
                }
            } else {
                log(`Пресет "${presetName}" не найден! Проверь название.`, 'error');
            }
        } else {
            toastr.success('Live Proxy URL обновлен (Пресет не указан)');
        }
    }

    // --- check and update ---
    async function checkAndUpdate() {
        log('Запуск цикла проверки...', 'info');
        const proxyUrl = await fetchProxyFromRentry();
        if (proxyUrl) {
            await applyProxy(proxyUrl);
        }
    }

    // --- download logs ---
    function downloadLogs() {
        const blob = new Blob([internalLogs.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st_proxy_logs_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { window.URL.revokeObjectURL(url); a.remove(); }, 100);
        log('Логи экспортированы', 'debug');
    }

    // --- copy errors ---
    function copyErrorsToClipboard(errorText = null) {
        const errors = errorText ? [errorText] : internalLogs.filter(l => l.includes('[ERROR]'));
        if (errors.length === 0) return toastr.info('No errors to copy');
        navigator.clipboard.writeText(errors.join('\n')).then(() => {
            toastr.success('Errors copied to clipboard');
        }).catch(() => toastr.error('Failed to copy to clipboard'));
    }

    // --- ui ---
    function initUI() {
        const settings = getSettings();
        const context = SillyTavern.getContext();
        const html = `
            <div id="${MODULE_NAME}-settings" class="extension_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Обновить Помидорыча</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: flex; flex-direction: column; gap: 10px;">
                        <label>URL парсинга Rentry:</label>
                        <input id="rp_rentry_url" type="text" class="text_pole" value="${settings.rentry_url}" />
                        <label>Что присобачить к URL (Path):</label>
                        <input id="rp_append_path" type="text" class="text_pole" value="${settings.append_path}" placeholder="/proxy/google-ai" />
                        <label>Целевой пресет (введи название или оставь пустым):</label>
                        <input id="rp_target_preset" type="text" class="text_pole" value="${settings.target_preset}" placeholder="Например: My Proxy Preset" />
                        <label class="checkbox_label">
                            <input id="rp_auto_check" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                            Авто-проверка при загрузке страницы
                        </label>
                        <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;" />
                        <b>Debug & Diagnostics</b>
                        <label class="checkbox_label">
                            <input id="rp_verbose_logging" type="checkbox" ${settings.verbose_logging ? 'checked' : ''}>
                            Комментировать каждый шаг (Verbose Logging)
                        </label>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <div id="rp_btn_force_check" class="menu_button"><i class="fa-solid fa-rotate"></i> Проверить сейчас</div>
                            <div id="rp_btn_dl_logs" class="menu_button"><i class="fa-solid fa-download"></i> Скачать логи</div>
                            <div id="rp_btn_copy_err" class="menu_button"><i class="fa-solid fa-copy"></i> Копировать ошибки</div>
                        </div>
                        <div id="rentry-logs-output" class="rentry-logger-container" style="${settings.verbose_logging ? 'display: block;' : 'display: none;'}"></div>
                    </div>
                </div>
            </div>
        `;
        $('#extensions_settings').append(html);
        $('#rp_rentry_url').on('input', function() { settings.rentry_url = $(this).val(); context.saveSettingsDebounced(); });
        $('#rp_append_path').on('input', function() { settings.append_path = $(this).val(); context.saveSettingsDebounced(); });
        $('#rp_target_preset').on('input', function() { settings.target_preset = $(this).val(); context.saveSettingsDebounced(); });
        $('#rp_auto_check').on('change', function() { settings.enabled = $(this).is(':checked'); context.saveSettingsDebounced(); });
        $('#rp_verbose_logging').on('change', function() {
            settings.verbose_logging = $(this).is(':checked');
            context.saveSettingsDebounced();
            $('#rentry-logs-output').css('display', settings.verbose_logging ? 'block' : 'none');
        });
        $('#rp_btn_force_check').on('click', checkAndUpdate);
        $('#rp_btn_dl_logs').on('click', downloadLogs);
        $('#rp_btn_copy_err').on('click', () => copyErrorsToClipboard());
    }

    // --- lifecycle ---
    $(document).ready(function() {
        const context = SillyTavern.getContext();
        context.eventSource.on(context.event_types.APP_READY, function () {
            try {
                initUI();
                const settings = getSettings();
                log('Расширение инициализировано.', 'debug');
                if (settings.enabled) {
                    setTimeout(checkAndUpdate, 2000);
                }
            } catch (error) {
                console.error("[RentryUpdater] Критическая ошибка при загрузке UI:", error);
                toastr.error(`Rentry Updater Crash: ${error.message}`, "Ошибка расширения", {timeOut: 10000});
            }
        });
    });
})();
