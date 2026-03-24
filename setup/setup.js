particlesJS.load('particles-js', 'assets/particles.json');

const topProgressBar = document.querySelector('.setup-progress-bar');
const installProgressBar = document.querySelector('.install-progress-bar');
const installProgressLabel = document.querySelector('.install-progress-label');
const stageLabel = document.getElementById('stage-label');
const logContainer = document.getElementById('log-output');
const statusDot = document.getElementById('status-dot');

const steps = document.querySelectorAll('.setup-part');
const stepWidth = 100 / steps.length;
let currentStep = 0;

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
}

function updateStepOverview(step) {
    const setuppart = document.querySelector(`.setup-part#step-${step}`);
    const overview = setuppart.querySelector('.steps-overview');
    overview.innerHTML = '';

    const expandOverview = (overview) => {
        overview.classList.toggle('expanded-after');
    }

    overview.replaceWith(overview.cloneNode(true));
    const newOverview = setuppart.querySelector('.steps-overview');

    const expanded = newOverview.classList.contains('expanded');
    if (!expanded) newOverview.addEventListener('click', () => expandOverview(newOverview));

    steps.forEach((lstep, i) => {
        const stepOverview = document.createElement('div');
        stepOverview.className = 'step-overview';
        stepOverview.setAttribute('data-step', i + 1);
        stepOverview.classList.add('step-overview-' + (i + 1 < step ? 'done' : i + 1 === step ? 'doing' : 'todo'));
        newOverview.appendChild(stepOverview);

        const stepDescription = lstep.getAttribute('data-description');
        const span = document.createElement('span');
        span.innerHTML = `<b>Step ${i + 1} - </b>${stepDescription}`;

        const img = document.createElement('img');
        img.src = `assets/icons/${i + 1 < step ? 'check' : i + 1 === step ? 'circle-doing-now' : 'circle'}.svg`;
        img.alt = i + 1 < step ? 'done' : i + 1 === step ? 'doing' : 'todo';
        img.className = 'overview-icon';
        stepOverview.appendChild(img);
        stepOverview.appendChild(span);
    })
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

setTopProgress(0);

function connect() {
    const ws = new WebSocket('ws://' + location.hostname + ':8765');

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') appendLog(msg.text, msg.level);
        if (msg.type === 'progress') setInstallProgress(msg.pct);
        if (msg.type === 'stage') setStage(msg.stage, msg.label);
        if (msg.type === 'next') {
            appendLog('Installation complete, continuing setup...', 'success');
            goToStep(msg.step);
        }
        if (msg.type === 'redirect') {
            window.location.href = msg.url;
        }
    };

    ws.onclose = () => setTimeout(connect, 2000);
    ws.onerror = () => { stageLabel.textContent = 'Waiting for server...'; };
}

connect();

const accountsContainer = document.querySelector('.accounts-add-list');

function createAccountItem() {
    const accountItem = document.createElement('div');
    accountItem.className = 'account-item';
    accountItem.innerHTML = `
        <div class="account-upload">
            <img src="assets/icons/profile.svg" draggable="false" alt="Account" class="account-icon">
            <img src="assets/icons/upload.svg" draggable="false" alt="Upload" class="upload-icon">
            <input type="file" accept="image/*" class="account-upload-input">
        </div>
        <div class="account-options">
            <input type="text" placeholder="Account Name" class="account-name">
            <select class="account-type">
                <option disabled selected value="">Account Role</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
            </select>
        </div>
        <img src="assets/icons/delete.svg" draggable="false" alt="Delete" class="delete-icon">
    `;

    const deleteBtn = accountItem.querySelector('.delete-icon');
    deleteBtn.addEventListener('click', () => accountItem.remove());

    const uploadInput = accountItem.querySelector('.account-upload-input');
    const accountIcon = accountItem.querySelector('.account-icon');
    const uploadOverlay = accountItem.querySelector('.upload-icon');
    uploadOverlay.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => accountIcon.src = ev.target.result;
        reader.readAsDataURL(file);
    });

    accountsContainer.insertBefore(accountItem, addAccountBtn);
}

const addAccountBtn = document.createElement('button');
addAccountBtn.textContent = 'Add Account';
addAccountBtn.className = 'button-tertiary';
addAccountBtn.style.marginTop = '10px';
addAccountBtn.addEventListener('click', createAccountItem);
accountsContainer.appendChild(addAccountBtn);

function showTooltip(input, message) {
    let tooltip = document.createElement('div');
    tooltip.className = 'input-tooltip';
    tooltip.textContent = message;
    document.body.appendChild(tooltip);
    const rect = input.getBoundingClientRect();
    tooltip.style.position = 'absolute';
    tooltip.style.left = rect.left + window.scrollX + 'px';
    tooltip.style.top = rect.top + window.scrollY - 25 + 'px';
    tooltip.style.backgroundColor = 'rgba(0,0,0,0.8)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '3px 6px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '12px';
    tooltip.style.zIndex = '999';
    setTimeout(() => tooltip.remove(), 2000);
}

function saveAccounts() {
    const accountItems = accountsContainer.querySelectorAll('.account-item');
    const accountsData = [];
    let valid = true;

    if (accountItems.length === 0) {
        showTooltip(addAccountBtn, 'At least one account is required');
        return;
    }

    accountItems.forEach(item => {
        const nameInput = item.querySelector('.account-name');
        const typeInput = item.querySelector('.account-type');
        const img = item.querySelector('.account-icon').src;
        let hasError = false;

        if (!nameInput.value.trim()) {
            showTooltip(nameInput, 'Name is required');
            hasError = true;
        }

        if (!typeInput.value || typeInput.value === "") {
            showTooltip(typeInput, 'Role is required');
            hasError = true;
        }

        if (!hasError) accountsData.push({ name: nameInput.value.trim(), type: typeInput.value, img });
        if (hasError) valid = false;
    });

    if (valid) goToStep(3);
}

createAccountItem();