let token = '';
let buildNumber = 504649;
let questsRaw = [];
let running = false;
let stopFlag = false;

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
    d.textContent = s;
    return d.innerHTML;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function doConnect() {
    token = $('tokenInput').value.trim();
    if (!token) { addLog('Token is empty.', 'error'); return; }

    const btn = $('connectBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    setStatus('Connecting...', '#f0b232');
    addLog('Connecting...');

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
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
    if (!token) { addLog('Not connected.', 'warn'); return; }
    $('refreshBtn').disabled = true;
    setStatus('Loading quests...', '#f0b232');

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
            setStatus(`Ready — ${available.length} available`, '#3ba55d');
            $('startBtn').disabled = available.length === 0;
        } else {
            addLog(data.error || 'Failed.', 'error');
        }
    } catch (e) {
        addLog('Error: ' + e.message, 'error');
    }

    $('refreshBtn').disabled = false;
}

function renderQuests(quests) {
    const c = $('questScroll');
    c.innerHTML = '';
    $('questHeader').textContent = `QUESTS  ·  ${quests.length} available`;

    if (!quests.length) {
        c.innerHTML = '<div class="empty-msg">No available quests.</div>';
        return;
    }

    quests.forEach(q => {
        const mins = q.seconds_needed ? Math.floor(q.seconds_needed / 60) : 0;
        let expHtml = '';
        if (q.expires_at) {
            try {
                const days = Math.floor((new Date(q.expires_at) - new Date()) / 86400000);
                if (days >= 0) {
                    let col = '#6a6f7a';
                    if (days < 2) col = '#ed4245';
                    else if (days < 5) col = '#f0b232';
                    expHtml = `<span class="quest-exp" style="color:${col}">· ${days}d left</span>`;
                }
            } catch (e) {}
        }

        const card = document.createElement('div');
        card.className = 'quest-card';
        card.id = `card-${q.id}`;
        card.innerHTML = `
            <input type="checkbox" checked id="cb-${q.id}">
            <div class="quest-info">
                <div class="quest-name">${escHtml(q.name)}</div>
                <div class="quest-meta">
                    <span class="quest-badge" style="color:${q.task_color}">${escHtml(q.task_label)}</span>
                    ${mins ? `<span class="quest-dur">${mins} min</span>` : ''}
                    ${expHtml}
                </div>
            </div>
            <div class="quest-right">
                <span class="quest-status" id="status-${q.id}">Pending</span>
                <div class="quest-pbar"><div class="quest-pbar-fill" id="pbar-${q.id}"></div></div>
            </div>
        `;
        c.appendChild(card);
    });
}

function selectAll() {
    document.querySelectorAll('.quest-card input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = true);
}

function deselectAll() {
    document.querySelectorAll('.quest-card input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function updateCardProgress(qid, done, total) {
    const pbar = document.getElementById(`pbar-${qid}`);
    const status = document.getElementById(`status-${qid}`);
    const card = document.getElementById(`card-${qid}`);
    if (!pbar) return;

    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    pbar.style.width = pct + '%';

    if (done >= total) {
        pbar.className = 'quest-pbar-fill done';
        if (status) { status.textContent = 'Completed'; status.className = 'quest-status done'; }
        if (card) card.className = 'quest-card done';
        const cb = document.getElementById(`cb-${qid}`);
        if (cb) { cb.checked = false; cb.disabled = true; }
    } else {
        pbar.className = 'quest-pbar-fill running';
        if (status) { status.textContent = `${Math.floor(done)}/${Math.floor(total)}s`; status.className = 'quest-status running'; }
        if (card) card.className = 'quest-card running';
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

    for (const quest of selected) {
        if (stopFlag) break;

        if (!quest.is_enrolled) {
            addLog(`Enrolling: ${quest.name}`);
            try {
                const res = await fetch('/api/enroll', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token, build_number: buildNumber,
                        quest_id: quest.id,
                        traffic_metadata_raw: quest.traffic_metadata_raw,
                        traffic_metadata_sealed: quest.traffic_metadata_sealed,
                    }),
                });
                const d = await res.json();
                if (!d.ok) { addLog(`Failed to enroll: ${quest.name}`, 'error'); continue; }
                await sleep(2000);
            } catch (e) {
                addLog(`Enroll error: ${e.message}`, 'error');
                continue;
            }
        }

        if (stopFlag) break;
        addLog(`Starting: ${quest.name}`);

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

    if (stopFlag) {
        setStatus('Stopped by user', '#ed4245');
        addLog('Process aborted.', 'warn');
    } else {
        setStatus('All tasks finished', '#3ba55d');
        addLog('Done.', 'ok');
    }
}

async function runVideo(quest) {
    const qid = quest.id;
    const needed = Number(quest.seconds_needed) || 0;
    let done = Number(quest.seconds_done) || 0;
    const speed = 7;

    while (done < needed) {
        if (stopFlag) return;

        const nextTs = Math.min(needed, done + speed + (Math.random() * 0.4));
        try {
            const res = await fetch('/api/video-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, timestamp: Number(nextTs.toFixed(2)) }),
            });

            if (stopFlag) return;

            if (res.status === 429) {
                const d = await res.json();
                await sleep((d.retry_after || 5) * 1000 + 1000);
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
                    addLog(`Completed: ${quest.name}`, 'ok');
                    return;
                }
            } else {
                addLog(`Progress error: ${d.error || res.status}`, 'error');
            }
        } catch (e) {
            addLog(`Error: ${e.message}`, 'error');
        }

        if (stopFlag) return;
        await sleep(1500);
    }

    if (stopFlag) return;

    try {
        const finalRes = await fetch('/api/video-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, timestamp: needed }),
        });
        const finalData = await finalRes.json();
        if (finalData.ok && !stopFlag) {
            updateCardProgress(qid, needed, needed);
            addLog(`Completed: ${quest.name}`, 'ok');
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

    while (done < needed) {
        if (stopFlag) return;

        try {
            const res = await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, stream_key: sk, terminal: false }),
            });

            if (stopFlag) return;

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
                if (d.data.completed_at || done >= needed) {
                    break;
                }
            }
        } catch (e) {
            addLog(`Error: ${e.message}`, 'error');
        }

        if (stopFlag) return;
        await sleep(20000);
    }

    if (stopFlag) return;

    try {
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, stream_key: sk, terminal: true }),
        });
    } catch (e) {}

    if (!stopFlag) {
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
    }
}

async function runActivity(quest) {
    const qid = quest.id;
    const needed = quest.seconds_needed;
    let done = quest.seconds_done || 0;
    const sk = 'call:0:1';

    while (done < needed) {
        if (stopFlag) return;

        try {
            const res = await fetch('/api/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, stream_key: sk, terminal: false }),
            });

            if (stopFlag) return;

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
                if (d.data.completed_at || done >= needed) {
                    break;
                }
            }
        } catch (e) {
            addLog(`Error: ${e.message}`, 'error');
        }

        if (stopFlag) return;
        await sleep(20000);
    }

    if (stopFlag) return;

    try {
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, build_number: buildNumber, quest_id: qid, stream_key: sk, terminal: true }),
        });
    } catch (e) {}

    if (!stopFlag) {
        updateCardProgress(qid, needed, needed);
        addLog(`Completed: ${quest.name}`, 'ok');
    }
}

function doStop() {
    stopFlag = true;
    addLog('Stopping...', 'warn');
    $('stopBtn').disabled = true;
}