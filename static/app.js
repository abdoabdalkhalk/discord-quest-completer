let token = '';
let buildNumber = 504649;
let questsRaw = [];
let running = false;
let stopFlag = false;

const $ = (id) => document.getElementById(id);

function toggleToken() {
    const inp = $('tokenInput');
    const btn = $('showBtn');
    if (inp.type === 'password') {
        inp.type = 'text';
        btn.textContent = 'Hide';
    } else {
        inp.type = 'password';
        btn.textContent = 'Show';
    }
}

function setStatus(text, mode) {
    const dot = $('statusDot');
    const lbl = $('statusText');
    dot.className = 'status-indicator-dot';
    
    if (mode === 'active') dot.classList.add('active');
    else if (mode === 'busy') dot.classList.add('busy');
    else if (mode === 'error') dot.classList.add('error');
    
    lbl.textContent = text;
}

function addLog(msg, level = 'info') {
    const box = $('logBox');
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = document.createElement('div');
    line.className = 'log-line';
    
    line.innerHTML = `
        <span class="log-timestamp">[${ts}]</span>
        <span class="log-badge ${level}">${level.toUpperCase()}</span>
        <span>${escHtml(msg)}</span>
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
        addLog('Authentication token is required.', 'error');
        return;
    }

    const btn = $('connectBtn');
    btn.disabled = true;
    btn.textContent = 'Authenticating...';
    setStatus('Authenticating with Discord...', 'busy');
    addLog('Connecting to Discord Gateway...');

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
            addLog(`Active Discord Client Build: ${buildNumber}`, 'info');
            
            const pill = $('userPill');
            pill.textContent = data.user.username;
            pill.classList.add('connected');
            
            setStatus('Connected to Discord', 'active');
            await doRefresh();
        } else {
            addLog(data.error || 'Authentication rejected.', 'error');
            setStatus('Authentication failed', 'error');
        }
    } catch (e) {
        addLog(`Network exception: ${e.message}`, 'error');
        setStatus('Connection error', 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Connect';
}

async function doRefresh() {
    if (!token) {
        addLog('No active session.', 'warn');
        return;
    }
    
    $('refreshBtn').disabled = true;
    setStatus('Querying active quests...', 'busy');

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
            setStatus(`Ready (${available.length} available)`, 'active');
            $('startBtn').disabled = available.length === 0;
        } else {
            addLog(data.error || 'Unable to fetch quests.', 'error');
            setStatus('Fetch error', 'error');
        }
    } catch (e) {
        addLog(`Fetch error: ${e.message}`, 'error');
        setStatus('Error', 'error');
    }

    $('refreshBtn').disabled = false;
}

function renderQuests(quests) {
    const c = $('questScroll');
    c.innerHTML = '';
    $('questHeader').textContent = `MISSION QUEUE (${quests.length})`;

    if (!quests.length) {
        c.innerHTML = '<div class="empty-state">No completable quests found.</div>';
        return;
    }

    quests.forEach(q => {
        const mins = q.seconds_needed ? Math.floor(q.seconds_needed / 60) : 0;
        let expHtml = '';
        if (q.expires_at) {
            try {
                const days = Math.floor((new Date(q.expires_at) - new Date()) / 86400000);
                if (days >= 0) {
                    expHtml = `<span class="time-tag">· ${days}d left</span>`;
                }
            } catch (e) {}
        }

        const card = document.createElement('div');
        card.className = 'card-item';
        card.id = `card-${q.id}`;
        card.innerHTML = `
            <input type="checkbox" checked class="checkbox-custom" id="cb-${q.id}">
            <div class="card-meta-wrap">
                <div class="card-title-text">${escHtml(q.name)}</div>
                <div class="card-tags">
                    <span class="badge-tag" style="color:${q.task_color}; border-color:${q.task_color}40">${escHtml(q.task_label)}</span>
                    ${mins ? `<span class="time-tag">${mins} min</span>` : ''}
                    ${expHtml}
                </div>
            </div>
            <div class="card-metrics">
                <span class="metric-status" id="status-${q.id}">Queued</span>
                <div class="progress-track"><div class="progress-bar-inner" id="pbar-${q.id}"></div></div>
            </div>
        `;
        c.appendChild(card);
    });
}

function selectAll() {
    document.querySelectorAll('.card-item input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = true);
}

function deselectAll() {
    document.querySelectorAll('.card-item input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function updateCardProgress(qid, done, total) {
    const pbar = document.getElementById(`pbar-${qid}`);
    const status = document.getElementById(`status-${qid}`);
    const card = document.getElementById(`card-${qid}`);
    if (!pbar) return;

    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    pbar.style.width = pct + '%';

    if (done >= total) {
        pbar.className = 'progress-bar-inner done';
        if (status) {
            status.textContent = '100% Completed';
            status.className = 'metric-status done';
        }
        if (card) card.className = 'card-item done';
        const cb = document.getElementById(`cb-${qid}`);
        if (cb) {
            cb.checked = false;
            cb.disabled = true;
        }
    } else {
        pbar.className = 'progress-bar-inner running';
        if (status) {
            status.textContent = `${Math.floor(done)}/${Math.floor(total)}s`;
            status.className = 'metric-status running';
        }
        if (card) card.className = 'card-item running';
    }
}

async function doStart() {
    if (running) return;

    const selectedIds = [];
    document.querySelectorAll('.card-item input[type="checkbox"]:checked:not(:disabled)').forEach(cb => {
        selectedIds.push(cb.id.replace('cb-', ''));
    });

    if (!selectedIds.length) {
        addLog('No missions selected.', 'warn');
        return;
    }

    running = true;
    stopFlag = false;
    $('startBtn').disabled = true;
    $('stopBtn').disabled = false;
    $('refreshBtn').disabled = true;
    $('connectBtn').disabled = true;

    addLog(`Executing queue: ${selectedIds.length} mission(s)...`, 'info');
    setStatus(`Processing ${selectedIds.length} mission(s)...`, 'busy');

    const selected = questsRaw.filter(q => selectedIds.includes(q.id));

    for (const quest of selected) {
        if (stopFlag) break;

        if (!quest.is_enrolled) {
            addLog(`Auto-enrolling: ${quest.name}`, 'info');
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
                    addLog(`Enrollment failed: ${quest.name}`, 'error');
                    continue;
                }
                await sleep(1500);
            } catch (e) {
                addLog(`Enroll error: ${e.message}`, 'error');
                continue;
            }
        }

        addLog(`Started: ${quest.name}`, 'info');

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
    setStatus('Execution completed', 'active');
    addLog('Queue processing finished.', 'ok');
}

async function runVideo(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;
    const step = 6.5;

    while (done < needed && !stopFlag) {
        const nextTs = Math.min(needed, done + step + (Math.random() * 0.5));
        
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
                addLog(`Rate limited. Backing off ${d.retry_after || 5}s...`, 'warn');
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
            addLog(`Stream error: ${e.message}`, 'error');
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
    addLog('Execution cancelled by user.', 'warn');
    $('stopBtn').disabled = true;
}