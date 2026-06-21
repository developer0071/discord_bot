// Guild ID hardcoded for demo, normally fetched from user session
const GUILD_ID = 'moonlight_soldiers_demo'; 
const ADMIN_ID = 'demo_admin';
const ADMIN_NAME = 'Admin';
const API_BASE = 'https://api.hunterstar.online';

document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
});

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/api/users/all?guildId=${GUILD_ID}`);
        const users = await response.json();
        
        // Sort by XP descending
        users.sort((a, b) => b.xp - a.xp);
        
        renderUsers(users);
        updateStats(users);
    } catch (err) {
        showToast('Failed to load users', 'error');
        console.error(err);
    }
}

function renderUsers(users) {
    const grid = document.getElementById('usersGrid');
    grid.innerHTML = '';
    
    if (users.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No users found.</div>';
        return;
    }

    users.forEach(user => {
        // Calculate progress to next level
        const currentLevelXp = 50 * user.level * (user.level + 1);
        const nextLevelXp = 50 * (user.level + 1) * (user.level + 2);
        const xpInCurrent = user.xp - currentLevelXp;
        const xpNeeded = nextLevelXp - currentLevelXp;
        const progress = Math.min(100, Math.max(0, (xpInCurrent / xpNeeded) * 100));
        
        const card = document.createElement('div');
        card.className = 'user-card glass-panel';
        card.innerHTML = `
            <div class="user-header">
                <img src="https://ui-avatars.com/api/?name=${user.username}&background=random" class="user-avatar" alt="Avatar">
                <div class="user-identity">
                    <h3>${user.username}</h3>
                    <div class="user-id">ID: ${user.userId}</div>
                </div>
                <div class="level-badge">Lvl ${user.level}</div>
            </div>
            
            <div class="xp-info">
                <div class="xp-labels">
                    <span>Total XP: <span class="xp-value">${user.xp.toLocaleString()}</span></span>
                    <span>${Math.floor(progress)}%</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            </div>
            
            <div class="user-actions">
                <button class="btn-action" onclick="openModal('${user.userId}', 'boost')"><i class="fa-solid fa-arrow-up"></i> Boost</button>
                <button class="btn-action" onclick="openModal('${user.userId}', 'addxp')"><i class="fa-solid fa-plus"></i> Add XP</button>
                <button class="btn-action btn-danger" onclick="confirmReset('${user.userId}')"><i class="fa-solid fa-rotate-right"></i> Reset</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function updateStats(users) {
    document.getElementById('totalMembers').innerText = users.length;
    
    let totalXp = 0;
    let highestLvl = 0;
    
    users.forEach(u => {
        totalXp += u.xp;
        if (u.level > highestLvl) highestLvl = u.level;
    });
    
    document.getElementById('totalXpAwarded').innerText = totalXp.toLocaleString();
    document.getElementById('highestLevel').innerText = highestLvl;
}

// Search functionality
document.getElementById('searchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.user-card');
    
    cards.forEach(card => {
        const username = card.querySelector('h3').innerText.toLowerCase();
        if (username.includes(term)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
});

// Modal Logic
function openModal(userId, action) {
    document.getElementById('modalUserId').value = userId;
    document.getElementById('modalAction').value = action;
    
    const title = document.getElementById('modalTitle');
    const xpGroup = document.getElementById('xpAmountGroup');
    const xpInput = document.getElementById('xpAmountInput');
    
    xpInput.value = '';
    document.getElementById('reasonInput').value = '';
    
    if (action === 'boost' || action === 'addxp') {
        title.innerText = action === 'boost' ? 'Boost Rank / Add XP' : 'Add Custom XP';
        xpGroup.style.display = 'block';
    }
    
    document.getElementById('actionModal').classList.add('active');
}

function closeModal() {
    document.getElementById('actionModal').classList.remove('active');
}

async function confirmAction() {
    const userId = document.getElementById('modalUserId').value;
    const action = document.getElementById('modalAction').value;
    const amount = document.getElementById('xpAmountInput').value;
    const reason = document.getElementById('reasonInput').value;
    
    if ((action === 'boost' || action === 'addxp') && !amount) {
        showToast('Please enter an amount', 'error');
        return;
    }
    
    const btn = document.getElementById('confirmActionBtn');
    btn.disabled = true;
    btn.innerText = 'Processing...';
    
    try {
        const response = await fetch(`${API_BASE}/api/boost/${GUILD_ID}/${userId}/boost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                xpAmount: parseInt(amount),
                adminId: ADMIN_ID,
                adminName: ADMIN_NAME,
                reason: reason
            })
        });
        
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);
        
        showToast(`Successfully added ${amount} XP!`, 'success');
        closeModal();
        loadUsers(); // Refresh
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm';
    }
}

async function confirmReset(userId) {
    if (!confirm('Are you sure you want to completely reset this user\'s XP and Level? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/boost/${GUILD_ID}/${userId}/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: ADMIN_ID,
                adminName: ADMIN_NAME
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        showToast('User stats reset successfully', 'success');
        loadUsers(); // Refresh
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Toasts
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-circle-exclamation';
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div>${message}</div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
