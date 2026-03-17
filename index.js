// @ts-check
(function () {
    // --- constants ---
    const MODULE_NAME = 'rentry_proxy_updater';
    const CLOUDFLARE_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

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

        log(`Инициализация HTTP GET к ${settings.rentry_url}`, 'debug');

        try {
            const response = await fetch(settings.rentry_url);
            if (!response.ok) throw new Error(`HTTP Status: ${response.status}`);

            const text = await response.text();
            const match = text.match(CLOUDFLARE_PATTERN);

            if (match) {
                let proxyUrl = match[0];
                log(`Найден базовый Cloudflare URL: ${proxyUrl}`, 'info');

                if (settings.append_path) {
                    proxyUrl += settings.append_path.startsWith('/') ? settings.append_path : `/${settings.append_path}`;
                    log(`Модифицированный URL: ${proxyUrl}`, 'debug');
                }
                return proxyUrl;
            } else {
                log('Cloudflare паттерн не найден на странице', 'error');
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

        if (settings.target_preset) {
            const pm = context.getPresetManager();
            const preset = pm.getCompletionPresetByName(settings.target_preset);

            if (preset) {
                if (preset.reverse_proxy === proxyUrl) {
                    log('Прокси в пресете уже актуален. Запись на диск отменена.', 'debug');
                    return;
                }

                preset.reverse_proxy = proxyUrl;
                try {
                    const response = await fetch('/api/presets/save', {
                        method: 'POST',
                        headers: context.getRequestHeaders(),
                        body: JSON.stringify({ name: settings.target_preset, ...preset })
                    });

                    if (response.ok) {
                        log(`Пресет ${settings.target_preset} успешно перезаписан на сервере`, 'info');
                        toastr.success('Proxy URL & Preset updated!');
                    } else {
                        throw new Error('Server rejected preset save');
                    }
                } catch (e) {
                    log(`Ошибка сохранения пресета: ${e.message}`, 'error');
                }
            } else {
                log(`Пресет ${settings.target_preset} не найден в менеджере`, 'error');
            }
        } else {
            toastr.success('Live Proxy URL updated (Preset not selected)');
        }
    }

    // --- check and update ---
    async function checkAndUpdate() {
        log('Запуск цикла проверки прокси...', 'info');
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

        const pm = context.getPresetManager();
        const presetList = pm.getPresetList ? pm.getPresetList() : [];
        let presetOptions = '<option value="">-- Не обновлять пресет (только Live) --</option>';
        presetList.forEach(p => {
            const selected = settings.target_preset === p.name ? 'selected' : '';
            presetOptions += `<option value="${p.name}" ${selected}>${p.name}</option>`;
        });

        const html = `
            <div id="${MODULE_NAME}-settings" class="extension_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Rentry Proxy Architect</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: flex; flex-direction: column; gap: 10px;">

                        <label>URL парсинга Rentry:</label>
                        <input id="rp_rentry_url" type="text" class="text_pole" value="${settings.rentry_url}" />

                        <label>Что присобачить к URL (Path):</label>
                        <input id="rp_append_path" type="text" class="text_pole" value="${settings.append_path}" placeholder="/proxy/google-ai" />

                        <label>Целевой пресет для сохранения:</label>
                        <select id="rp_target_preset" class="text_pole">${presetOptions}</select>

                        <label class="checkbox_label">
                            <input id="rp_auto_check" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                            Авто-проверка при загрузке страницы
                        </label>

                        <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;" />
                        <b>Debug & Diagnostics (Mobile)</b>

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
        $('#rp_target_preset').on('change', function() { settings.target_preset = $(this).val(); context.saveSettingsDebounced(); });
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
