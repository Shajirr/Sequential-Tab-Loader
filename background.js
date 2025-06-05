// State management for tab queue and add-on behavior
let tabQueue = [];
let activeLoads = 0;
let isProcessing = false;
let maxConcurrentTabs = 1; // Default: one tab at a time
let queueLimit = 25; // Default: queue limit
let loadBehavior = 'queue-active'; // Default: queue active
let isPaused = false; // Pause state
let discardingDelay = 0; // Default: no delay
let loadingDelay = 0; // Default: no delay
const loadingTabs = new Set(); // Track tabs currently loading

// Delay function for asynchronous waiting
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize settings from storage
async function initializeSettings() {
    try {
        const result = await browser.storage.local.get(['maxConcurrentTabs', 'queueLimit', 'loadBehavior', 'isPaused', 'discardingDelay', 'loadingDelay']);
        maxConcurrentTabs = parseInt(result.maxConcurrentTabs, 10) || 1;
        queueLimit = parseInt(result.queueLimit, 10) || 25;
        loadBehavior = result.loadBehavior || 'queue-active';
        isPaused = result.isPaused || false;
        discardingDelay = parseInt(result.discardingDelay, 10) || 0;
        loadingDelay = parseInt(result.loadingDelay, 10) || 0;
        updateBadge();
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
        //console.debug('Updated maxConcurrentTabs:', maxConcurrentTabs);
    }
    if (changes.queueLimit) {
        queueLimit = parseInt(changes.queueLimit.newValue, 10);
        if (tabQueue.length > queueLimit) {
            tabQueue = tabQueue.slice(0, queueLimit);
            updateBadge();
        }
    }
    if (changes.loadBehavior) {
        loadBehavior = changes.loadBehavior.newValue;
        if (loadBehavior === 'stay-discarded') {
            tabQueue = [];
            activeLoads = 0;
            loadingTabs.clear();
            updateBadge();
        }
    }
    if (changes.isPaused) {
        isPaused = changes.isPaused.newValue;
        updateBadge();
        browser.browserAction.setTitle({
            title: `Sequential Tab Loader (${isPaused ? 'Paused' : 'Active'})`
        });
    }
    if (changes.discardingDelay) {
        discardingDelay = parseInt(changes.discardingDelay.newValue, 10);
    }
    if (changes.loadingDelay) {
        loadingDelay = parseInt(changes.loadingDelay.newValue, 10);
    }
    if (!isPaused && loadBehavior === 'queue-active') {
        if (loadingDelay == 0){
            processQueue();
        } else {
            processQueueDelay();
        }
    }
});

// Update browser action badge
function updateBadge() {
    const badgeText = isPaused ? 'II' : tabQueue.length.toString();
    browser.browserAction.setBadgeText({ text: badgeText });
    browser.browserAction.setBadgeBackgroundColor({
        color: isPaused ? '#ff9500' : '#4CAF50' // Orange for paused, light green for active
    });
    //console.debug(`Queue length: ${tabQueue.length}, Active loads: ${activeLoads}`);
}

// Toggle pause state on browser action click
browser.browserAction.onClicked.addListener(async () => {
    isPaused = !isPaused;
    try {
        await browser.storage.local.set({ isPaused });
    } catch (error) {
        console.error('Failed to save isPaused state:', error);
    }
    updateBadge();
    browser.browserAction.setTitle({
        title: `Sequential Tab Loader (${isPaused ? 'Paused' : 'Active'})`
    });
    if (!isPaused && loadBehavior === 'queue-active') {
        if (loadingDelay == 0){
            processQueue();
        } else {
            processQueueDelay();
        }
    }
});

// Handle new tabs
browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.pinned || tab.active || isPaused) {
        return;
    }
    try {
        if (discardingDelay > 0) {
            await delay(discardingDelay);
        }
        await browser.tabs.discard(tab.id);
        if (loadBehavior === 'queue-active' && tabQueue.length < queueLimit) {
            tabQueue.push(tab);
            //console.debug(`Added tab ${tab.id} to queue`);
            updateBadge();
            if (!isPaused) {
                if (loadingDelay == 0){
                    processQueue();
                } else {
                    processQueueDelay();
                }
            }
        } else if (tabQueue.length >= queueLimit) {
            //console.debug(`Queue full, tab ${tab.id} not added`);
        }
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
    loadingTabs.delete(tabId);
    //console.debug(`Tab ${tabId} finished, activeLoads: ${activeLoads}`);
    updateBadge();

    if (!isPaused && loadBehavior === 'queue-active') {
        if (loadingDelay == 0){
            processQueue();
        } else {
            processQueueDelay();
        }
    }
});

// Process the queue - regular
function processQueue() {
    if (isPaused || loadBehavior !== 'queue-active') {
        return;
    }
    while (activeLoads < maxConcurrentTabs && tabQueue.length > 0) {
        const tab = tabQueue.shift(); // Remove the next tab from the queue
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

// Process the queue sequentially - with delay
async function processQueueDelay() {
    if (isProcessing) return; // Prevent multiple instances
    isProcessing = true;

    try {
        while (tabQueue.length > 0 && activeLoads < maxConcurrentTabs) {
            const tab = tabQueue.shift(); // Remove the next tab from the queue
            activeLoads++;
            //console.debug(`Starting tab ${tab.id}, activeLoads: ${activeLoads}`);
            updateBadge();

            // Reload the tab
            await browser.tabs.reload(tab.id).catch(error => {
                console.error(`Failed to reload tab ${tab.id}:`, error);
            });

            // Wait for the tab to finish loading
            await new Promise(resolve => {
                const listener = (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        browser.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                browser.tabs.onUpdated.addListener(listener);
            });

            activeLoads--;
            //console.debug(`Tab ${tab.id} finished, activeLoads: ${activeLoads}`);

            // Wait for the specified delay before starting the next tab
            if (tabQueue.length > 0) { // Only delay if more tabs are waiting
                await delay(loadingDelay);
            }
        }
    } catch (error) {
        console.error('Error in queue processing:', error);
    } finally {
        isProcessing = false;
        updateBadge();
    }
}

// Handle tab activation to remove activated tabs from queue
browser.tabs.onActivated.addListener(async (activeInfo) => {
    const tabId = activeInfo.tabId;
    try {
        const queueLengthBefore = tabQueue.length;
        tabQueue = tabQueue.filter(tab => tab.id !== tabId);
        if (queueLengthBefore !== tabQueue.length) {
            updateBadge();
        }
        if (loadingTabs.has(tabId)) {
            loadingTabs.delete(tabId);
            activeLoads--;
            updateBadge();
            if (!isPaused && loadBehavior === 'queue-active') {
                if (loadingDelay == 0){
                    processQueue();
                } else {
                    processQueueDelay();
                }
            }
        }
    } catch (error) {
        console.error(`Failed to process tab activation for tab ${tabId}:`, error);
    }
});

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
    if (!isPaused && loadBehavior === 'queue-active') {
        if (loadingDelay == 0){
            processQueue();
        } else {
            processQueueDelay();
        }
    }
});