particlesJS.load('particles-js', 'assets/particles.json');

const topProgressBar = document.querySelector('.setup-progress-bar');
const installProgressBar = document.querySelector('.install-progress-bar');
const installProgressLabel = document.querySelector('.install-progress-label');
const stageLabel = document.getElementById('stage-label');
const logContainer = document.getElementById('log-output');
const statusDot = document.getElementById('status-dot');
const questionContainer = document.getElementById('question-container');

const passwordInput = document.getElementById('password-input');
const savePasswordBtn = document.getElementById('save-password-btn');

const steps = document.querySelectorAll('.setup-part');
const stepWidth = 100 / steps.length;
let currentStep = 0;

let gotSetupStateFromHttp = false;

let access_token = null;

const BACKEND = `http://${location.hostname}:8000/api`;

function setTopProgress(stepIndex) {
    topProgressBar.style.width = ((stepIndex + 1) * stepWidth) + '%';
}

function setInstallProgress(pct) {
    installProgressBar.style.width = pct + '%';
    installProgressLabel.textContent = pct + '%';
}

function goToStep(index) {
    steps[currentStep].classList.remove('active');
    currentStep = index;
    steps[currentStep].classList.add('active');
    setTopProgress(currentStep);
    updateStepOverview(currentStep + 1);
    saveSetupState(currentStep);
    if (index === 4) loadExistingAccounts();

    if (index > 1) {
        const favicon = document.querySelector('link[rel="icon"]');
        favicon.href = '/assets/favicons/setup.svg';
    } else {
        const favicon = document.querySelector('link[rel="icon"]');
        favicon.href = '/assets/favicons/downloading.svg';
    }
}

function saveSetupState(step) {
    fetch(`${BACKEND}/setup/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_step: step, completed: true }),
    }).catch(() => {});
}

function updateStepOverview(step) {
    const setupPart = document.querySelector(`.setup-part#step-${step}`);
    if (!setupPart) return;
    const overview = setupPart.querySelector('.steps-overview');
    if (!overview) return;

    overview.innerHTML = '';

    const expanded = overview.classList.contains('expanded');
    if (!expanded) {
        overview.addEventListener('click', () => {
            overview.classList.toggle('expanded-after');
        }, { once: false });
    }

    steps.forEach((lstep, i) => {
        const stepOverview = document.createElement('div');
        stepOverview.className = 'step-overview';
        stepOverview.setAttribute('data-step', i + 1);
        const stateClass = i + 1 < step ? 'done' : i + 1 === step ? 'doing' : 'todo';
        stepOverview.classList.add('step-overview-' + stateClass);

        const stepDescription = lstep.getAttribute('data-description');
        const span = document.createElement('span');
        span.innerHTML = `<b>Step ${i + 1} - </b>${stepDescription}`;

        const img = document.createElement('img');
        img.src = `assets/icons/${i + 1 < step ? 'check' : i + 1 === step ? 'circle-doing-now' : 'circle'}.svg`;
        img.alt = stateClass;
        img.className = 'overview-icon';
        stepOverview.appendChild(img);
        stepOverview.appendChild(span);
        overview.appendChild(stepOverview);
    });
}

function setStage(stage, label) {
    stageLabel.textContent = label;
    statusDot.className = 'status-dot ' + stage;
}

function appendLog(text, level) {
    const line = document.createElement('div');
    line.className = 'log-line log-' + (level || 'info');
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-text">${escHtml(text)}</span>`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let ws;

function showQuestion(id, text, options) {
    goToStep(1);
    gotSetupStateFromHttp = false;

    questionContainer.innerHTML = '';
    questionContainer.style.display = 'flex';

    const box = document.createElement('div');
    box.className = 'question-box';

    const q = document.createElement('p');
    q.className = 'question-text';
    q.textContent = text;
    box.appendChild(q);

    const btns = document.createElement('div');
    btns.className = 'question-buttons';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'button-primary';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
            questionContainer.style.display = 'none';
            ws.send(JSON.stringify({ type: 'answer', id, value: opt.value }));
        });
        btns.appendChild(btn);
    });

    box.appendChild(btns);
    questionContainer.appendChild(box);
}

setTopProgress(0);

function connect() {
    ws = new WebSocket('ws://' + location.hostname + ':8765');
    const favicon = document.querySelector('link[rel="icon"]');
    favicon.href = '/assets/favicons/downloading.svg';

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') appendLog(msg.text, msg.level);
        if (msg.type === 'progress') setInstallProgress(msg.pct);
        if (msg.type === 'stage') setStage(msg.stage, msg.label);
        if (msg.type === 'question') showQuestion(msg.id, msg.text, msg.options);
        if (msg.type === 'next') {
            appendLog('Installation complete, continuing setup…', 'success');
            if (!gotSetupStateFromHttp) goToStep(msg.step + 1);
        }
        if (msg.type === 'redirect') {
            window.location.href = msg.url;
        }
    };

    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => {
        stageLabel.textContent = 'Waiting for server…';
    };
}

connect();

const accountsContainer = document.querySelector('.accounts-add-list');
const persistedAccounts = new Map();

async function loadExistingAccounts() {
    try {
        const res = await fetch(`${BACKEND}/accounts/`, { method: 'GET', headers: { 'Authorization': `Bearer ${access_token}` } });
        if (!res.ok) return;
        const accounts = await res.json();

        for (const [id, el] of persistedAccounts) {
            if (!accounts.find(a => a.id === id)) {
                el.remove();
                persistedAccounts.delete(id);
            }
        }

        for (const acc of accounts) {
            if (!persistedAccounts.has(acc.id)) {
                const item = createAccountItem(acc);
                persistedAccounts.set(acc.id, item);
            }
        }
    } catch (e) {
        console.warn('Could not load existing accounts (backend may not be up yet):', e);
    }
}

function createAccountItem(existing = null) {
    const accountItem = document.createElement('div');
    accountItem.className = 'account-item';

    const avatarSrc = existing?.avatar_b64 || 'assets/icons/profile.svg';

    accountItem.innerHTML = `
        <div class="account-upload">
            <img src="${escHtml(avatarSrc)}" draggable="false" alt="Account" class="account-icon">
            <img src="assets/icons/upload.svg" draggable="false" alt="Upload" class="upload-icon">
            <input type="file" accept="image/*" class="account-upload-input">
        </div>
        <div class="account-options">
            <input type="text" placeholder="Account Name" class="account-name" value="${existing ? escHtml(existing.name) : ''}">
            <select class="account-type">
                <option disabled ${!existing ? 'selected' : ''} value="">Account Role</option>
                <option value="user" ${existing?.role === 'user' ? 'selected' : ''}>User</option>
                <option value="admin" ${existing?.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
        </div>
        <img src="assets/icons/delete.svg" draggable="false" alt="Delete" class="delete-icon">
    `;

    if (existing) accountItem.dataset.backendId = existing.id;

    accountItem.querySelector('.delete-icon').addEventListener('click', async () => {
        const bid = accountItem.dataset.backendId;
        if (bid) {
            try {
                await fetch(`${BACKEND}/accounts/${bid}`, { 
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${access_token}`
                    }
                 });
                persistedAccounts.delete(Number(bid));
            } catch (e) {
                console.warn('Delete failed', e);
            }
        }
        accountItem.remove();
    });

    const uploadInput = accountItem.querySelector('.account-upload-input');
    const accountIcon = accountItem.querySelector('.account-icon');
    const uploadOverlay = accountItem.querySelector('.upload-icon');

    uploadOverlay.addEventListener('click', () => uploadInput.click());

    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            accountIcon.src = ev.target.result;
            const bid = accountItem.dataset.backendId;
            if (bid) await patchAccount(bid, { avatar_b64: ev.target.result });
        };
        reader.readAsDataURL(file);
    });

    const nameInput = accountItem.querySelector('.account-name');
    const typeInput = accountItem.querySelector('.account-type');

    nameInput.addEventListener('blur', async () => {
        const bid = accountItem.dataset.backendId;
        if (bid) await patchAccount(bid, { name: nameInput.value.trim() });
    });

    typeInput.addEventListener('change', async () => {
        const bid = accountItem.dataset.backendId;
        if (bid) await patchAccount(bid, { role: typeInput.value });
    });

    accountsContainer.insertBefore(accountItem, addAccountBtn);
    return accountItem;
}

async function patchAccount(id, fields) {
    try {
        await fetch(`${BACKEND}/accounts/${id}`, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify(fields),
        });
    } catch (e) {
        console.warn('Patch failed', e);
    }
}

const addAccountBtn = document.createElement('button');
addAccountBtn.textContent = 'Add Account';
addAccountBtn.className = 'button-tertiary';
addAccountBtn.style.marginTop = '10px';
addAccountBtn.addEventListener('click', () => createAccountItem());
accountsContainer.appendChild(addAccountBtn);

function showTooltip(input, message) {
    let tooltip = document.createElement('div');
    tooltip.className = 'input-tooltip';
    tooltip.textContent = message;
    document.body.appendChild(tooltip);

    const rect = input.getBoundingClientRect();
    tooltip.style.position = 'absolute';
    tooltip.style.left = rect.left + window.scrollX + 'px';
    tooltip.style.top = rect.top + window.scrollY - 28 + 'px';
    tooltip.style.backgroundColor = 'rgba(0,0,0,0.85)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '4px 8px';
    tooltip.style.borderRadius = '5px';
    tooltip.style.fontSize = '12px';
    tooltip.style.zIndex = '999';

    setTimeout(() => tooltip.remove(), 2200);
}

async function savePassword() {
    const password = passwordInput.value.trim();
    if (!password) return showTooltip(passwordInput, 'Password is required');

    if (password.length < 8) return showTooltip(passwordInput, 'Password must be at least 8 characters long');

    try {
        const pass_response = await fetch(`${BACKEND}/server/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const pass_data = await pass_response.json();

        if (pass_data.detail == null || pass_data.detail == undefined) {
            access_token = pass_data.access_token;

            goToStep(4);
        } else {
            showTooltip(passwordInput, pass_data.detail);
        }
    } catch (e) {
        console.warn('Save password failed', e);
    }
}

async function skipPassword() {
    const response = await fetch('http://localhost:8000/api/server/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });

    const data = await response.json();
    if (data.status === 'success') {
        access_token = data.access_token;
        goToStep(4);
    } else {
        showTooltip(passwordInput, data.detail);
    }
}

async function saveAccounts() {
    const accountItems = accountsContainer.querySelectorAll('.account-item');
    let valid = true;

    if (accountItems.length === 0) {
        showTooltip(addAccountBtn, 'At least one account is required');
        return;
    }

    let hasAdmin = false;
    const upsertPromises = [];

    accountItems.forEach(item => {
        const nameInput = item.querySelector('.account-name');
        const typeInput = item.querySelector('.account-type');
        const avatarSrc = item.querySelector('.account-icon').src;

        let hasError = false;

        if (!nameInput.value.trim()) {
            showTooltip(nameInput, 'Name is required');
            hasError = true;
        }

        if (!typeInput.value || typeInput.value === '') {
            showTooltip(typeInput, 'Role is required');
            hasError = true;
        }

        if (hasError) {
            valid = false;
            return;
        }

        if (typeInput.value === 'admin') hasAdmin = true;

        const bid = item.dataset.backendId;
        const avatar_b64 = avatarSrc.startsWith('data:') ? avatarSrc : null;

        if (bid) {
            upsertPromises.push(
                fetch(`${BACKEND}/accounts/${bid}`, {
                    method: 'PATCH',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${access_token}`
                     },
                    body: JSON.stringify({ name: nameInput.value.trim(), role: typeInput.value, avatar_b64 }),
                }).then(async r => {
                    if (r.ok) {
                        const updated = await r.json();
                        item.dataset.backendId = updated.id;
                        persistedAccounts.set(updated.id, item);
                    }
                })
            );
        } else {
            upsertPromises.push(
                fetch(`${BACKEND}/accounts/`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${access_token}`
                     },
                    body: JSON.stringify({ name: nameInput.value.trim(), role: typeInput.value, avatar_b64 })
                }).then(async r => {
                    if (r.ok) {
                        const created = await r.json();
                        item.dataset.backendId = created.id;
                        persistedAccounts.set(created.id, item);
                    }
                })
            );
        }
    });

    if (!hasAdmin) {
        showTooltip(addAccountBtn, 'At least one admin account is required');
        valid = false;
    }

    if (!valid) return;

    try {
        await Promise.all(upsertPromises);
    } catch (e) {
        console.warn('Some account saves failed:', e);
    }

    goToStep(5);
}

async function restoreSetupState() {
    try {
        const res = await fetch(`${BACKEND}/setup/state`);
        if (!res.ok) return;

        const state = await res.json();
        gotSetupStateFromHttp = true;
        goToStep(state.current_step);
    } catch (e) {}
}

(async () => await restoreSetupState())();

passwordInput.addEventListener('input', validatePassword);

function validatePassword() {
    const password = passwordInput.value.trim();
    
    if (password && password.length >= 8) {
        savePasswordBtn.disabled = false;
    } else if (password) {
        showTooltip(passwordInput, 'Password must be at least 8 characters long');
    } else {
        savePasswordBtn.disabled = true;
    }
}