const DEBUG = true;
let isEnabled = false;
let listenerAdded = false;

function logDebug(...args) {
  if (DEBUG) console.log('[Content]', ...args);
}

// Click handler function
function handleClick(event) {
    // Check if Alt key is pressed
	if (!event.altKey) return;
	
	// Find the link element (might be nested in other elements)
	let target = event.target;
	while (target && target.tagName !== 'A') {
		target = target.parentElement;
	}
	
	// If a link with an href is found
	if (target && target.tagName === 'A' && target.href) {
		event.preventDefault(); // Stop the default Alt+click behavior
		event.stopPropagation();
		
		logDebug("Opening tab from link: ", target.href);
		
		// Send message to background script
		browser.runtime.sendMessage({
			action: 'createDiscardedTab',
			url: target.href
		});
	} else {
		logDebug("No link found");
	}
}

// Add or remove listener based on enabled state
function updateListener(enabled) {
    if (enabled && !listenerAdded) {
        document.addEventListener('click', handleClick, true);
        listenerAdded = true;
        logDebug('Click listener added');
    } else if (!enabled && listenerAdded) {
        document.removeEventListener('click', handleClick, true);
        listenerAdded = false;
        logDebug('Click listener removed');
    }
}

// Check if feature is enabled
browser.storage.local.get(['altClickDiscarded']).then(result => {
    isEnabled = result.altClickDiscarded || false;
    logDebug('Alt-click feature enabled:', isEnabled);
	updateListener(isEnabled);
});

// Listen for setting changes
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.altClickDiscarded) {
        isEnabled = changes.altClickDiscarded.newValue;
        logDebug('Alt-click feature toggled:', isEnabled);
		updateListener(isEnabled);
    }
});