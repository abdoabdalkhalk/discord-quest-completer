let token = '';
let buildNumber = 504649;
let questsRaw = [];
let running = false;
let stopFlag = false;

const $ = (id) => document.getElementById(id);

function toggleToken() {
    const inp = $('tokenInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
}

function setStatus(text, mode) {
    const pulse = $('statusPulse');
    const label = $('statusText');
    pulse.className = 'dock-status-pulse';
    
    if (mode === 'active') pulse.classList.add('active');
    else if (mode === 'busy') pulse.classList.add('busy');
    else if (mode === 'error') pulse.classList.add('error');
    
    label.textContent = text;
}

function addLog(msg, level = 'info') {
    const box = $('logBox');
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = document.createElement('div');
    line.className = 'log-entry';
    
    line.innerHTML = `
        <span class="log-time">${ts}</span>
        <span class="log-level ${level}">${level.toUpperCase()}</span>
        <span class="log-msg">${escHtml(msg)}</span>
    `;
    
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

function clearLog() {
    $('logBox').innerHTML = '';
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function doConnect() {
    token = $('tokenInput').value.trim();
    if (!token) {
        addLog('Token parameter missing.', 'error');
        return;
    }

    const btn = $('connectBtn');
    btn.disabled = true;
    setStatus('Establishing handshake...', 'busy');
    addLog('Connecting to Discord REST Gateway...');

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (data.ok) {
            buildNumber = data.build_number;
            addLog(`Authenticated as ${data.user.username} (${data.user.id})`, 'ok');
            addLog(`Client Target Build: ${buildNumber}`, 'info');
            
            const pill = $('userPill');
            pill.querySelector('.user-name-text').textContent = data.user.username;
            pill.classList.add('connected');
            
            setStatus('Gateway Connected', 'active');
            await doRefresh();
        } else {
            addLog(data.error || 'Handshake rejected.', 'error');
            setStatus('Connection Rejected', 'error');
        }
    } catch (e) {
        addLog(`Network fault: ${e.message}`, 'error');
        setStatus('Network Fault', 'error');
    }

    btn.disabled = false;
}

async function doRefresh() {
    if (!token) {
        addLog('Session not initialized.', 'warn');
        return;
    }
    
    $('refreshBtn').disabled = true;
    setStatus('Synchronizing quest schema...', 'busy');

    try {
        const res = await fetch('/api/quests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, build_number: buildNumber }),
        });
        const data = await res.json();

        if (data.ok) {
            questsRaw = data.quests;
            $('statTotal').textContent = data.total;
            $('statAvail').textContent = data.available;
            $('statDone').textContent = data.completed;

            const available = data.quests.filter(q => !q.is_completed && q.is_completable);
            renderQuests(available);
            setStatus(`Synced · ${available.length} executable`, 'active');
            $('startBtn').disabled = available.length === 0;
        } else {
            addLog(data.error || 'Failed to parse quest schema.', 'error');
            setStatus('Sync Failed', 'error');
        }
    } catch (e) {
        addLog(`Sync error: ${e.message}`, 'error');
        setStatus('Sync Fault', 'error');
    }

    $('refreshBtn').disabled = false;
}

function renderQuests(quests) {
    const deck = $('questScroll');
    deck.innerHTML = '';
    $('questCountBadge').textContent = quests.length;

    if (!quests.length) {
        deck.innerHTML = `
            <div class="empty-state-canvas">
                <div class="empty-icon-ring">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p class="empty-lead">All tasks completed</p>
                <p class="empty-sub">No pending missions available for this account</p>
            </div>
        `;
        return;
    }

    quests.forEach(q => {
        const mins = q.seconds_needed ? Math.floor(q.seconds_needed / 60) : 0;
        let expHtml = '';
        if (q.expires_at) {
            try {
                const days = Math.floor((new Date(q.expires_at) - new Date()) / 86400000);
                if (days >= 0) {
                    expHtml = `<span class="timer-tag">· ${days}d left</span>`;
                }
            } catch (e) {}
        }

        const card = document.createElement('div');
        card.className = 'quest-row-item';
        card.id = `card-${q.id}`;
        card.innerHTML = `
            <input type="checkbox" checked class="custom-checkbox" id="cb-${q.id}">
            <div class="quest-core">
                <div class="quest-title-line">${escHtml(q.name)}</div>
                <div class="quest-tags-line">
                    <span class="type-tag" style="color:${q.task_color}; background:${q.task_color}18; border:1px solid ${q.task_color}35">${escHtml(q.task_label)}</span>
                    ${mins ? `<span class="timer-tag">${mins} min</span>` : ''}
                    ${expHtml}
                </div>
            </div>
            <div class="quest-aside">
                <span class="progress-indicator-text" id="status-${q.id}">Pending</span>
                <div class="progress-track-bg"><div class="progress-fill-bar" id="pbar-${q.id}"></div></div>
            </div>
        `;
        deck.appendChild(card);
    });
}

function selectAll() {
    document.querySelectorAll('.quest-row-item input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = true);
}

function deselectAll() {
    document.querySelectorAll('.quest-row-item input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function updateCardProgress(qid, done, total) {
    const pbar = document.getElementById(`pbar-${qid}`);
    const status = document.getElementById(`status-${qid}`);
    const card = document.getElementById(`card-${qid}`);
    if (!pbar) return;

    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    pbar.style.width = pct + '%';

    if (done >= total) {
        pbar.className = 'progress-fill-bar done';
        if (status) {
            status.textContent = 'Completed (100%)';
            status.className = 'progress-indicator-text done';
        }
        if (card) card.className = 'quest-row-item done';
        const cb = document.getElementById(`cb-${qid}`);
        if (cb) {
            cb.checked = false;
            cb.disabled = true;
        }
    } else {
        pbar.className = 'progress-fill-bar running';
        if (status) {
            status.textContent = `${Math.floor(done)}/${Math.floor(total)}s`;
            status.className = 'progress-indicator-text running';
        }
        if (card) card.className = 'quest-row-item running';
    }
}

async function doStart() {
    if (running) return;

    const selectedIds = [];
    document.querySelectorAll('.quest-row-item input[type="checkbox"]:checked:not(:disabled)').forEach(cb => {
        selectedIds.push(cb.id.replace('cb-', ''));
    });

    if (!selectedIds.length) {
        addLog('No target missions specified.', 'warn');
        return;
    }

    running = true;
    stopFlag = false;
    $('startBtn').disabled = true;
    $('stopBtn').disabled = false;
    $('refreshBtn').disabled = true;
    $('connectBtn').disabled = true;

    addLog(`Initiating sequence for ${selectedIds.length} mission(s)...`, 'info');
    setStatus(`Executing [${selectedIds.length}] tasks`, 'busy');

    const selected = questsRaw.filter(q => selectedIds.includes(q.id));

    for (const quest of selected) {
        if (stopFlag) break;

        if (!quest.is_enrolled) {
            addLog(`Auto-enrolling task: ${quest.name}`, 'info');
            try {
                const res = await fetch('/api/enroll', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token,
                        build_number: buildNumber,
                        quest_id: quest.id,
                        traffic_metadata_raw: quest.traffic_metadata_raw,
                        traffic_metadata_sealed: quest.traffic_metadata_sealed,
                    }),
                });
                const d = await res.json();
                if (!d.ok) {
                    addLog(`Enrollment failed for: ${quest.name}`, 'error');
                    continue;
                }
                await sleep(1500);
            } catch (e) {
                addLog(`Enrollment exception: ${e.message}`, 'error');
                continue;
            }
        }

        addLog(`Processing: ${quest.name}`, 'info');

        if (quest.task_type === 'WATCH_VIDEO' || quest.task_type === 'WATCH_VIDEO_ON_MOBILE') {
            await runVideo(quest);
        } else if (quest.task_type === 'PLAY_ON_DESKTOP' || quest.task_type === 'STREAM_ON_DESKTOP') {
            await runHeartbeat(quest);
        } else if (quest.task_type === 'PLAY_ACTIVITY') {
            await runActivity(quest);
        }
    }

    running = false;
    $('startBtn').disabled = false;
    $('stopBtn').disabled = true;
    $('refreshBtn').disabled = false;
    $('connectBtn').disabled = false;
    setStatus('Sequence Finished', 'active');
    addLog('Execution completed.', 'ok');
}

async function runVideo(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;
    const step = 6.5;

    while (done < needed && !stopFlag) {
        const nextTs = Math.min(needed, done + step + (Math.random() * 0.4));
        
        try {
            const res = await fetch('/api/video-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    build_number: buildNumber,
                    quest_id: qid,
                    timestamp: Number(nextTs.toFixed(2)),
                }),
            });

            if (res.status === 429) {
                const d = await res.json();
                const wait = (d.retry_after || 5) * 1000 + 1000;
                addLog(`Rate limited by Discord. Backing off ${d.retry_after || 5}s...`, 'warn');
                await sleep(wait);
                continue;
            }

            const d = await res.json();
            if (d.ok) {
                const respData = d.data || {};
                const userStatus = respData.user_status || respData;
                const progressObj = userStatus.progress || {};
                const taskProg = progressObj[quest.task_type] || {};

                if (taskProg.value !== undefined) {
                    done = Math.max(done, taskProg.value);
                } else {
                    done = nextTs;
                }

                updateCardProgress(qid, done, needed);

                if (userStatus.completed_at || respData.completed_at || done >= needed) {
                    updateCardProgress(qid, needed, needed);
                    addLog(`Completed 100%: ${quest.name}`, 'ok');
                    return;
                }
            } else {
                addLog(`Progress rejection: ${d.error || res.status}`, 'error');
            }
        } catch (e) {
            addLog(`Stream exception: ${e.message}`, 'error');
        }

        await sleep(2000);
    }

    try {
        const finalRes = await fetch('/api/video-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                build_number: buildNumber,
                quest_id: qid,
                timestamp: needed,
            }),
        });
        const finalData = await finalRes.json();
        if (finalData.ok) {
            updateCardProgress(qid, needed, needed);
            addLog(`Completed 100%: ${quest.name}`, 'ok');
        }
    } catch (e) {}
}

async function runHeartbeat(quest) {
    const qid = quest.id;
    const tt = quest.task_type;
    const needed = quest.seconds_needed;
    let done = quest.seconds_done || 0;
    const pid = Math.floor(Math.random() * 29000) + 1000;
    const sk = `call:0:${pid}`;

    while (done < needed && !stopFlag) {
        try {
            const res = await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    build_number: buildNumber,
                    quest_id: qid,
                    stream_key: sk,
                    terminal: false
                }),
            });

            if (res.status === 429) {
                const d = await res.json();
                await sleep((d.retry_after || 10) * 1000 + 1000);
                continue;
            }

            const d = await res.json();
            if (d.ok && d.data) {
                const pd = d.data.progress || {};
                if (pd[tt]) done = pd[tt].value || done;
                updateCardProgress(qid, done, needed);
                if (d.data.completed_at || done >= needed) break;
            }
        } catch (e) {
            addLog(`Heartbeat error: ${e.message}`, 'error');
        }

        if (!stopFlag) await sleep(20000);
    }

    try {
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                build_number: buildNumber,
                quest_id: qid,
                stream_key: sk,
                terminal: true
            }),
        });
    } catch (e) {}

    updateCardProgress(qid, needed, needed);
    addLog(`Completed: ${quest.name}`, 'ok');
}

async function runActivity(quest) {
    const qid = quest.id;
    const needed = quest.seconds_needed;
    let done = quest.seconds_done || 0;
    const sk = 'call:0:1';

    while (done < needed && !stopFlag) {
        try {
            const res = await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    build_number: buildNumber,
                    quest_id: qid,
                    stream_key: sk,
                    terminal: false
                }),
            });

            if (res.status === 429) {
                const d = await res.json();
                await sleep((d.retry_after || 10) * 1000 + 1000);
                continue;
            }

            const d = await res.json();
            if (d.ok && d.data) {
                const pd = d.data.progress || {};
                if (pd.PLAY_ACTIVITY) done = pd.PLAY_ACTIVITY.value || done;
                updateCardProgress(qid, done, needed);
                if (d.data.completed_at || done >= needed) break;
            }
        } catch (e) {
            addLog(`Activity error: ${e.message}`, 'error');
        }

        if (!stopFlag) await sleep(20000);
    }

    try {
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                build_number: buildNumber,
                quest_id: qid,
                stream_key: sk,
                terminal: true
            }),
        });
    } catch (e) {}

    updateCardProgress(qid, needed, needed);
    addLog(`Completed: ${quest.name}`, 'ok');
}

function doStop() {
    stopFlag = true;
    addLog('Signal interrupt sent.', 'warn');
    $('stopBtn').disabled = true;
}