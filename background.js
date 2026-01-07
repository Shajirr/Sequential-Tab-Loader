const DEBUG = true;

function logDebug(...args) {
  if (DEBUG) console.log('[Background]', ...args);
}

logDebug('Sequential Tab Loader background script loaded');

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
let altClickMode = 'none'; // Options: 'none', 'discarded', 'queue'
const loadingTabs = new Set(); // Track tabs currently loading

// Tab Creation Queue data
let tabCreationQueue = []; // Separate queue for delayed tab creation
let isCreatingTab = false; // Flag to prevent concurrent tab creation
const tabCreationQueueTabs = new Set(); // Track tabs created from the creation queue

// Track which tabs have the content script injected
const injectedTabs = new Set();

// Delay function for asynchronous waiting
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Helper function to wait for tab load
function waitForTabLoad(tabId, timeoutMs = 45000) {
    return new Promise(resolve => {
        let isResolved = false;
        let cleanup;

        // 1. Success Listener
        const updateListener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                cleanup();
                resolve('completed');
            }
        };

        // 2. Tab Closed Listener (Prevents stuck queue if user closes tab)
        const removeListener = (tid) => {
            if (tid === tabId) {
                cleanup();
                resolve('removed');
            }
        };

        // 3. Timeout Failsafe (Prevents infinite hang)
        const timer = setTimeout(() => {
            cleanup();
            resolve('timeout');
        }, timeoutMs);

        cleanup = () => {
            if (isResolved) return;
            isResolved = true;
            clearTimeout(timer);
            browser.tabs.onUpdated.removeListener(updateListener);
            browser.tabs.onRemoved.removeListener(removeListener);
        };

        browser.tabs.onUpdated.addListener(updateListener);
        browser.tabs.onRemoved.addListener(removeListener);
    });
}

// Create context menu items for the browser action
browser.menus.create({
    id: "resume-loading",
    title: "Resume loading",
    contexts: ["browser_action"]
});

browser.menus.create({
    id: "keep-discarded",
    title: "Keep tabs discarded (disable queue)",
    contexts: ["browser_action"],
    visible: loadBehavior === 'queue-active' // Only show when queue is active
});

browser.menus.create({
    id: "load-next-tab",
    title: "Load next tab",
    contexts: ["browser_action"]
});

browser.menus.create({
    id: "empty-queue",
    title: "Empty the queue",
    contexts: ["browser_action"]
});

browser.menus.create({
    id: "list-queue-urls",
    title: "List pending creation queue URLs",
    contexts: ["browser_action"],
    visible: false // Hidden by default, shown in updateBadge if needed
});

// Update menu visibility when loadBehavior changes
function updateContextMenu() {
    browser.menus.update("keep-discarded", {
        visible: loadBehavior === 'queue-active'
    }).catch(() => {}); // Ignore errors if menu doesn't exist yet
}

// Inject content script into a tab
async function injectContentScript(tabId, tabUrl) {
    // Skip special pages and already-injected tabs
    if (!tabUrl || 
        tabUrl.startsWith('about:') || 
        tabUrl.startsWith('moz-extension:') ||
        tabUrl.startsWith('chrome:') ||
        injectedTabs.has(tabId)) {
        return;
    }
    
    try {
        await browser.tabs.executeScript(tabId, {
            file: 'content.js'
        });
        injectedTabs.add(tabId);
        logDebug(`Injected content script into tab ${tabId}`);
    } catch (error) {
        // Silently ignore errors (e.g., restricted pages)
        logDebug(`Failed to inject into tab ${tabId}:`, error.message);
    }
}

// Inject into currently active tab on startup/setting change
async function injectIntoActiveTab() {
    if (altClickMode === 'none') return;
    
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            await injectContentScript(tabs[0].id, tabs[0].url);
        }
    } catch (error) {
        logDebug('Error injecting into active tab:', error);
    }
}

// Handle menu item clicks
browser.menus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "resume-loading") {
		// Change behavior to queue-active if it's stay-discarded
        if (loadBehavior === 'stay-discarded') {
            try {
                await browser.storage.local.set({ loadBehavior: 'queue-active' });
                logDebug('Changed loadBehavior to queue-active');
            } catch (error) {
                console.error('Failed to change loadBehavior:', error);
            }
        }
		
		// Resume if stuck
        if (!isPaused && loadBehavior === 'queue-active') {
            // reset isProcessing flag
            if (isProcessing) {
                isProcessing = false; // Reset the flag if stuck
            }
            // Resume creation queue if stuck
            if (tabCreationQueue.length > 0 && !isCreatingTab) {
                 processTabCreationQueue();
            }
            // Reset states to restart queue
            activeLoads = 0;
            loadingTabs.clear();
            //console.debug("Reset activeLoads and loadingTabs");
            // Restart queue processing
            if (loadingDelay == 0) {
                processQueue(); 
            } else {
                processQueueDelay();
            }
        }
    } else if (info.menuItemId === "keep-discarded") {
        // Change behavior to stay-discarded
        try {
            await browser.storage.local.set({ loadBehavior: 'stay-discarded' });
            logDebug('Changed loadBehavior to stay-discarded');
        } catch (error) {
            console.error('Failed to change loadBehavior:', error);
        }
    } else if (info.menuItemId === "load-next-tab") {
        if (isProcessing) {
            isProcessing = false; // Reset the flag if stuck
        }
        if (tabQueue.length > 0) {
            const skippedTab = tabQueue.shift(); // Skip the first tab
            //console.debug(`Skipped tab ${skippedTab.id}`);
            updateBadge();
            if (!isPaused && loadBehavior === 'queue-active') {
                if (loadingDelay == 0) {
                    processQueue();
                } else {
                    processQueueDelay();
                }
            }
        } else if (tabCreationQueue.length > 0 && !isCreatingTab) {
            // Kickstart creation queue if it was stuck
            processTabCreationQueue();
        }
    } else if (info.menuItemId === "empty-queue") {
        isProcessing = false; // Reset the flag
		isCreatingTab = false; // Reset tab creation flag
        tabQueue = []; // Clear the regular queue
		tabCreationQueue = []; // Clear the tab creation queue
		tabCreationQueueTabs.clear(); // Clear tracking set
        activeLoads = 0; // Reset active loads
        loadingTabs.clear(); // Clear loading tabs
        logDebug("Both queues emptied, activeLoads and loadingTabs reset");
        updateBadge();
    } else if (info.menuItemId === "list-queue-urls") {
        // Dump creation queue to a new tab via Blob URL
        if (tabCreationQueue.length > 0) {
            const urlList = tabCreationQueue.map(t => t.url).join('\n');
            const content = `--- PENDING CREATION QUEUE URLS ---\n\n${urlList}`;
            
            // Create a Blob containing the text
            const blob = new Blob([content], { type: 'text/plain' });
            // Create a unique URL pointing to that Blob
            const blobUrl = URL.createObjectURL(blob);
            
            // Open the Blob URL in a new tab
            browser.tabs.create({ url: blobUrl }).then(() => {
                // Clean up the URL after a delay to free memory
                setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            });
        }
    }
});

// Initialize settings from storage
async function initializeSettings() {
    try {
        const result = await browser.storage.local.get(['maxConcurrentTabs', 'queueLimit', 'loadBehavior', 'isPaused', 'discardingDelay', 'loadingDelay', 'altClickMode']);
        maxConcurrentTabs = parseInt(result.maxConcurrentTabs, 10) || 1;
        queueLimit = parseInt(result.queueLimit, 10) || 25;
        loadBehavior = result.loadBehavior || 'queue-active';
        isPaused = result.isPaused || false;
        discardingDelay = parseInt(result.discardingDelay, 10) || 0;
        loadingDelay = parseInt(result.loadingDelay, 10) || 0;
        altClickMode = result.altClickMode || 'none';
        if (altClickMode !== 'none') {
            injectIntoActiveTab();
        }
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
        }
		updateBadge();
		updateContextMenu();
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
	if (changes.altClickMode) {
        altClickMode = changes.altClickMode.newValue;
        if (altClickMode !== 'none') {
            injectIntoActiveTab();
        }
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
	let badgeText, badgeColor;
	
    // Only show the menu if the tab creation queue is not empty
    browser.menus.update("list-queue-urls", {
        visible: tabCreationQueue.length > 0
    }).catch(() => {});
	
	if (isPaused) {
        // Paused state takes priority
        badgeText = 'II';
        badgeColor = '#ff9500'; // Orange
    } else if (loadBehavior === 'stay-discarded') {
        // Stay discarded state
        badgeText = 'X';
        badgeColor = '#808080'; // Gray
		//badgeColor = '#5C9FD6'; // Ice blue
    } else if (altClickMode === 'queue' && tabQueue.length === 0 && tabCreationQueue.length > 0) {
        // Tab creation queue is active (regular queue is empty)
        badgeText = tabCreationQueue.length.toString();
        badgeColor = '#2196F3'; // Blue
    } else {
        // Regular queue active state
        badgeText = tabQueue.length.toString();
        badgeColor = '#4CAF50'; // Light green
    }
	
	browser.browserAction.setBadgeText({ text: badgeText });
    browser.browserAction.setBadgeBackgroundColor({ color: badgeColor });

    logDebug(`Queue length: ${tabQueue.length}, Active loads: ${activeLoads}, Creation queue: ${tabCreationQueue.length}`);
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
        // Resume creation queue if pending
        if (tabCreationQueue.length > 0 && !isCreatingTab) {
             processTabCreationQueue();
        }
        if (loadingDelay == 0){
            processQueue();
        } else {
            processQueueDelay();
        }
    }
});

// Handle new tabs
browser.tabs.onCreated.addListener(async (tab) => {
	// Skip if the addon is paused
	if (isPaused) {
        return;
    }
	// Skip pinned tabs and active tab
    if (tab.pinned || tab.active) {
        return;
    }
	// Skip tabs from the creation queue
    if (tabCreationQueueTabs.has(tab.id)) {
        return;
    }
    try {
        if (discardingDelay > 0) {
            await delay(discardingDelay);
        }
		
        // Only discard if not already discarded
        if (!tab.discarded) {
            await browser.tabs.discard(tab.id);
        }
		
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
        logDebug(`Note: tab ${tab.id} handled elsewhere or closed:`, error.message);
    }
});

// Handle tab updates
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	// If page is navigating or reloading, mark as not injected
    if (changeInfo.status === 'loading') {
        if (injectedTabs.has(tabId)) {
            injectedTabs.delete(tabId);
            logDebug(`Tab ${tabId} navigating, clearing injection status`);
        }
    }
	// If this is the active tab and injection is enabled, inject when complete
	if (changeInfo.status === 'complete' && tab.active && altClickMode !== 'none') {
        injectContentScript(tabId, tab.url);
    }

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
            await waitForTabLoad(tab.id, 60000);

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

// Process the tab creation queue sequentially
async function processTabCreationQueue() {
    if (isCreatingTab || tabCreationQueue.length === 0) return;
	
    isCreatingTab = true;
	logDebug(`Starting tab creation queue processing. Queue length: ${tabCreationQueue.length}`);
    
    try {
        while (tabCreationQueue.length > 0) {
            // Check pause state to allow interrupting
            if (isPaused) break;
            const tabInfo = tabCreationQueue[0]; // Peek first (don't remove until success)
            logDebug(`Creating tab from queue: ${tabInfo.url} (${tabCreationQueue.length} remaining)`);

            let newTab;
            try {
                // Create the tab (not discarded)
                newTab = await browser.tabs.create({
                    url: tabInfo.url,
                    active: false,
                    openerTabId: tabInfo.openerTabId
                });
				
				// Mark this tab as from creation queue
				tabCreationQueueTabs.add(newTab.id);
            } catch (e) {
                logDebug("Failed to create tab (invalid URL?), skipping:", e);
                tabCreationQueue.shift(); // Remove problematic item
                updateBadge();
                continue;
            }

            // Successfully created, now we can remove from queue
            tabCreationQueue.shift();
			updateBadge(); // Update badge as queue shrinks 
            logDebug(`Tab ${newTab.id} created, waiting for load...`);
            
            // Wait for the tab to finish loading
            await waitForTabLoad(newTab.id, 45000);
            logDebug(`Tab ${newTab.id} finished wait sequence`);
			// Clean up the tracking
            tabCreationQueueTabs.delete(newTab.id);
            
            // Short delay to be safe
            await delay(200);
        }
		logDebug('Tab creation queue processing complete');
    } catch (error) {
        console.error('Error in tab creation queue processing:', error);
    } finally {
        isCreatingTab = false;
		updateBadge();
    }
}
// Message listener
browser.runtime.onMessage.addListener((message, sender) => {
    if (message.action === 'createDiscardedTab') {
        logDebug('Handling click for:', message.url);
        
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            const activeTab = tabs[0];
			
			// Mode 2: Tab Creation Queue (Sequential tab creation)
            if (altClickMode === 'queue') {
				// Add to tab creation queue
                tabCreationQueue.push({
                    url: message.url,
                    openerTabId: activeTab.id
                });
                logDebug(`Added to tab creation queue. Queue length: ${tabCreationQueue.length}`);
				updateBadge();
                processTabCreationQueue();
			} 
			// Mode 1: Open Discarded (Immediate creation, add to loading queue)
			else if (altClickMode === 'discarded') {
				// Original behavior: create discarded tab
				// The browser.tabs.onCreated listener will handle adding it to tabQueue.
				browser.tabs.create({
					url: message.url,
					discarded: true,
					active: false,
					//index: activeTab.index + 1,
					openerTabId: activeTab.id
				})
			}
        });
    }
});

// Handle tab activation to remove activated tabs from queue, as well as content script injection
browser.tabs.onActivated.addListener(async (activeInfo) => {
    const tabId = activeInfo.tabId;
	
	// Content script injection
	if (altClickMode !== 'none') {
		try {
			const tab = await browser.tabs.get(activeInfo.tabId);
			await injectContentScript(activeInfo.tabId, tab.url);
		} catch (error) {
			logDebug('Error handling tab activation:', error);
		}
	}

	// Handle tab activation to remove activated tabs from queue
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
	injectedTabs.delete(tabId);
	tabCreationQueueTabs.delete(tabId);
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