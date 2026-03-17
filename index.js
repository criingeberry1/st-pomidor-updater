// @ts-check
(function () {
    const MODULE_NAME = 'rentry_proxy_updater';

    const CLOUDFLARE_PATTERN = /https?:\/\/[a-zA-Z0-9-._]+\.trycloudflare\.com/i;

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        rentry_url: 'https://rentry.org/Pomidoranon_proxy',
        append_path: '/proxy/google-ai',
        target_preset: '', 
        verbose_logging: false
    });

    let internalLogs = [];

    function getSettings() {
        const context = SillyTavern.getContext();
        if (!context.extensionSettings) context.extensionSettings = {};
        if (!context.extensionSettings[MODULE_NAME]) {
            context.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        }
        return context.extensionSettings[MODULE_NAME];
    }

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

    async function fetchProxyFromRentry() {
        const settings = getSettings();
        if (!settings.rentry_url) {
            log('Rentry URL не задан', 'error');
            return null;
        }

        let targetUrl = settings.rentry_url.trim().replace(/\/raw\/?$/i, '').replace(/\/$/, '');
        const nocache = targetUrl.includes('?') ? `&v=${Date.now()}` : `?v=${Date.now()}`;
        const finalUrl = targetUrl + nocache;
        
        log(`Запуск маршрутизации для: ${finalUrl}`, 'info');

        const proxies = [
            { 
                name: 'Jina AI', 
                url: `https://r.jina.ai/${finalUrl}`, 
                type: 'text',
                headers: { 
                    "x-respond-with": "html", 
                    "Cache-Control": "no-cache", 
                    "x-no-cache": "true" 
                }
            },
            { 
                name: 'AllOrigins', 
                url: `https://api.allorigins.win/raw?url=${encodeURIComponent(finalUrl)}`, 
                type: 'text',
                headers: { "Cache-Control": "no-store" }
            }
        ];

        for (const proxy of proxies) {
            log(`[${proxy.name}] Инициализация соединения...`, 'debug');
            try {
                const response = await fetch(proxy.url, { 
                    cache: "no-store", 
                    headers: proxy.headers 
                });
                
                if (!response.ok) {
                    log(`[${proxy.name}] Отказ сервера (HTTP ${response.status})`, 'debug');
                    continue; 
                }

                const text = await response.text();
                if (!text) continue;

                if (text.includes('<title>What</title>') || text.includes('Just a moment...')) {
                    log(`[${proxy.name}] Обнаружена WAF-защита. Идем дальше.`, 'error');
                    continue; 
                }

                const snippet = text.substring(0, 150).replace(/\n/g, ' ');
                log(`[${proxy.name}] УСПЕХ! Ответ получен: "${snippet}..."`, 'info');

                const match = text.match(CLOUDFLARE_PATTERN);

                if (match) {
                    let proxyUrl = match[0];
                    log(`Найден URL: ${proxyUrl}`, 'info');

                    if (settings.append_path) {
                        proxyUrl += settings.append_path.startsWith('/') ? settings.append_path : `/${settings.append_path}`;
                        log(`Модифицированный URL: ${proxyUrl}`, 'debug');
                    }
                    return proxyUrl;
                } else {
                    log(`[${proxy.name}] Паттерн trycloudflare не найден! Включаю DEEP CORE DUMP.`, 'error');
                    internalLogs.push(`\n=== DEEP CORE DUMP [${proxy.name}] ===\n${text}\n=== END DUMP ===\n`);
                    continue; 
                }
            } catch (e) {
                log(`[${proxy.name}] Сетевой сбой: ${e.message}`, 'debug');
            }
        }
        
        log('Критический сбой: Все маршруты заблокированы.', 'error');
        return null;
    }

    async function applyProxy(proxyUrl) {
        if (!proxyUrl) return;
        const settings = getSettings();
        const context = SillyTavern.getContext();

        $('#openai_reverse_proxy').val(proxyUrl).trigger('input');
        log('#openai_reverse_proxy успешно обновлен', 'info');

        if (settings.target_preset && settings.target_preset.trim() !== '') {
            const presetName = settings.target_preset.trim();
            let presetFound = false;

            // @ts-ignore
            if (window.oai_settings && Array.isArray(window.oai_settings.proxy_presets)) {
                // @ts-ignore
                const proxyPreset = window.oai_settings.proxy_presets.find(p => p.name === presetName);
                if (proxyPreset) {
                    proxyPreset.url = proxyUrl;

                    if (proxyPreset.reverse_proxy !== undefined) {
                        proxyPreset.reverse_proxy = proxyUrl;
                    }
                    
                    context.saveSettingsDebounced();
                    presetFound = true;
                    log(`пресет "${presetName}" успешно перезаписан`, 'info');
                }
            }

            if (presetFound) {
                toastr.success(`Пресет прокси "${presetName}" обновлен!`);
            } else {
                log(`пресет"${presetName}" не найден. мне нужно ТОЧНОЕ название.`, 'error');
                toastr.warning(`пресет "${presetName}" не найден.`);
            }
        } else {
            toastr.success('ссылон обновлен в текущих настройках!!');
        }
    }

    async function checkAndUpdate() {
        log('Запуск цикла проверки...', 'info');
        const proxyUrl = await fetchProxyFromRentry();
        if (proxyUrl) {
            await applyProxy(proxyUrl);
        }
    }

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

    function copyErrorsToClipboard(errorText = null) {
        const errors = errorText ? [errorText] : internalLogs.filter(l => l.includes('[ERROR]'));
        if (errors.length === 0) return toastr.info('No errors to copy');

        navigator.clipboard.writeText(errors.join('\n')).then(() => {
            toastr.success('Errors copied to clipboard');
        }).catch(() => toastr.error('Failed to copy to clipboard'));
    }

    function initUI() {
        const settings = getSettings();
        const context = SillyTavern.getContext();

        const html = `
            <div id="${MODULE_NAME}-settings" class="extension_settings">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>обновить помидорыча</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="display: flex; flex-direction: column; gap: 10px;">

                        <label>ссылон на рентри:</label>
                        <input id="rp_rentry_url" type="text" class="text_pole" value="${settings.rentry_url}" />

                        <label>что присобачить к ссылке?:</label>
                        <input id="rp_append_path" type="text" class="text_pole" value="${settings.append_path}" placeholder="/proxy/google-ai" />

                        <label>пресет, который нужно обновить:</label>
                        <input id="rp_target_preset" type="text" class="text_pole" value="${settings.target_preset}" placeholder="Например: помидор пидорас" />

                        <label class="checkbox_label">
                            <input id="rp_auto_check" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                            авто-проверка при загрузке страницы
                        </label>

                        <hr style="border-color: rgba(255,255,255,0.1); width: 100%; margin: 5px 0;" />
                        <b>дебаг</b>

                        <label class="checkbox_label">
                            <input id="rp_verbose_logging" type="checkbox" ${settings.verbose_logging ? 'checked' : ''}>
                            глянуть логи
                        </label>

                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <div id="rp_btn_force_check" class="menu_button"><i class="fa-solid fa-rotate"></i> глянуть ссылон сейчас</div>
                            <div id="rp_btn_dl_logs" class="menu_button"><i class="fa-solid fa-download"></i> скачать логи</div>
                            <div id="rp_btn_copy_err" class="menu_button"><i class="fa-solid fa-copy"></i> Ккопировать ошибки</div>
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
