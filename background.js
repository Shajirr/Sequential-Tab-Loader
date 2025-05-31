// State management for tab queue and add-on behavior
let tabQueue = [];
let activeLoads = 0;
let maxConcurrentTabs = 1; // Default: one tab at a time
let queueLimit = 25; // Default: queue limit
let loadBehavior = 'queue-active'; // Default: queue active
let isPaused = false; // Pause state
const loadingTabs = new Set(); // Track tabs currently loading

// Initialize settings from storage
async function initializeSettings() {
    try {
        const result = await browser.storage.local.get(['maxConcurrentTabs', 'queueLimit', 'loadBehavior', 'isPaused']);
        maxConcurrentTabs = parseInt(result.maxConcurrentTabs, 10) || 1;
        queueLimit = parseInt(result.queueLimit, 10) || 25;
        loadBehavior = result.loadBehavior || 'queue-active';
        isPaused = result.isPaused || false; // Load persisted pause state
        // console.debug('Settings initialized:', { maxConcurrentTabs, queueLimit, loadBehavior, isPaused });
        updateBadge();
        // Set initial tooltip based on pause state
        browser.browserAction.setTitle({
            title: `Sequential Tab Loader (${isPaused ? 'Paused' : 'Active'})`
        });
    } catch (error) {
        console.error('Failed to initialize settings:', error);
    }
}
initializeSettings();

// Update settings on storage changes
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.maxConcurrentTabs) {
        maxConcurrentTabs = parseInt(changes.maxConcurrentTabs.newValue, 10);
        // console.debug('Updated maxConcurrentTabs:', maxConcurrentTabs);
    }
    if (changes.queueLimit) {
        queueLimit = parseInt(changes.queueLimit.newValue, 10);
        if (tabQueue.length > queueLimit) {
            tabQueue = tabQueue.slice(0, queueLimit);
            updateBadge();
        }
        // console.debug('Updated queueLimit:', queueLimit);
    }
    if (changes.loadBehavior) {
        loadBehavior = changes.loadBehavior.newValue;
        if (loadBehavior === 'stay-discarded') {
            tabQueue = [];
            activeLoads = 0;
            loadingTabs.clear();
            updateBadge();
        }
        // console.debug('Updated loadBehavior:', loadBehavior);
    }
    if (changes.isPaused) {
        isPaused = changes.isPaused.newValue;
        updateBadge();
        browser.browserAction.setTitle({
            title: `Sequential Tab Loader (${isPaused ? 'Paused' : 'Active'})`
        });
        // console.debug('Updated isPaused:', isPaused);
    }
    if (!isPaused && loadBehavior === 'queue-active') {
        processQueue();
    }
});

// Update browser action badge
function updateBadge() {
    const badgeText = isPaused ? 'II' : tabQueue.length.toString();
    browser.browserAction.setBadgeText({ text: badgeText });
    browser.browserAction.setBadgeBackgroundColor({
        color: isPaused ? '#ff9500' : '#4CAF50' // Orange for paused, light green for active
    });
    // console.debug('Badge updated:', { badgeText, isPaused });
}

// Toggle pause state on browser action click
browser.browserAction.onClicked.addListener(async () => {
    isPaused = !isPaused;
    try {
        await browser.storage.local.set({ isPaused });
        // console.debug('Saved isPaused state:', isPaused);
    } catch (error) {
        console.error('Failed to save isPaused state:', error);
    }
    updateBadge();
    browser.browserAction.setTitle({
        title: `Sequential Tab Loader (${isPaused ? 'Paused' : 'Active'})`
    });
    // console.debug('Pause state toggled:', isPaused);
    if (!isPaused && loadBehavior === 'queue-active') {
        processQueue();
    }
});

// Handle new tabs
browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.pinned || tab.active || isPaused) {
        // console.debug(`Skipping tab ${tab.id}: pinned=${tab.pinned}, active=${tab.active}, isPaused=${isPaused}`);
        return;
    }
    try {
        await browser.tabs.discard(tab.id);
        // console.debug(`Tab ${tab.id} discarded`);
        if (loadBehavior === 'queue-active' && tabQueue.length < queueLimit) {
            tabQueue.push(tab);
            updateBadge();
            // console.debug(`Tab ${tab.id} queued, queue length: ${tabQueue.length}`);
            if (!isPaused) {
                processQueue();
            }
        }
        // For stay-discarded, tab is discarded but not queued
    } catch (error) {
        console.error(`Failed to discard tab ${tab.id}:`, error);
    }
});

// Handle tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete' || !loadingTabs.has(tabId)) {
        return;
    }
    loadingTabs.delete(tabId);
    activeLoads--;
    updateBadge();
    // console.debug(`Tab ${tabId} completed loading, activeLoads: ${activeLoads}`);
    if (!isPaused && loadBehavior === 'queue-active') {
        processQueue();
    }
});

// Process the queue
function processQueue() {
    if (isPaused || loadBehavior !== 'queue-active') {
        return;
    }
    while (activeLoads < maxConcurrentTabs && tabQueue.length > 0) {
        const tab = tabQueue.shift();
        activeLoads++;
        loadingTabs.add(tab.id);
        updateBadge();
        // console.debug(`Processing tab ${tab.id}, activeLoads: ${activeLoads}`);
        browser.tabs.reload(tab.id).catch((error) => {
            console.error(`Failed to reload tab ${tab.id}:`, error);
            loadingTabs.delete(tab.id);
            activeLoads--;
            updateBadge();
            processQueue();
        });
    }
}

// Clean up on tab removal
browser.tabs.onRemoved.addListener((tabId) => {
    const wasLoading = loadingTabs.delete(tabId);
    if (wasLoading) {
        activeLoads--;
    }
    const queueLengthBefore = tabQueue.length;
    tabQueue = tabQueue.filter(tab => tab.id !== tabId);
    if (queueLengthBefore !== tabQueue.length) {
        updateBadge();
    }
    // console.debug(`Tab ${tabId} removed, queue length: ${tabQueue.length}`);
    if (!isPaused && loadBehavior === 'queue-active') {
        processQueue();
    }
});