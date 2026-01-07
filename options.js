// Handle options page initialization and form submission
document.addEventListener('DOMContentLoaded', async() => {
    try {
        // Load saved settings
        const result = await browser.storage.local.get(['maxConcurrentTabs', 'queueLimit', 'loadBehavior', 'discardingDelay', 'loadingDelay', 'altClickMode']);
        document.getElementById('max-tabs').value = result.maxConcurrentTabs || 1;
        document.getElementById('queue-limit').value = result.queueLimit || 25;
        document.getElementById('load-behavior').value = result.loadBehavior || 'queue-active';
        document.getElementById('discarding-delay').value = result.discardingDelay || 0;
        document.getElementById('loading-delay').value = result.loadingDelay || 0;
		document.getElementById('alt-click-mode').value = result.altClickMode || 'none';

        // Disable max-tabs if loading-delay is not zero
        const maxTabsInput = document.getElementById('max-tabs');
        const loadingDelayInput = document.getElementById('loading-delay');
        const initialDelayValue = parseInt(loadingDelayInput.value, 10);
        maxTabsInput.disabled = (initialDelayValue !== 0);

        // Add event listener to loading-delay to toggle max-tabs disabled state
        loadingDelayInput.addEventListener('input', () => {
            const delayValue = parseInt(loadingDelayInput.value, 10);
            maxTabsInput.disabled = (delayValue !== 0);
        });
    } catch (error) {
        console.error('Failed to load settings:', error);
        alert('Error loading settings. Please try again.');
    }

    // Handle form submission
    document.getElementById('options-form').addEventListener('submit', async(event) => {
        event.preventDefault();
        const maxTabs = parseInt(document.getElementById('max-tabs').value, 10);
        const queueLimit = parseInt(document.getElementById('queue-limit').value, 10);
        const loadBehavior = document.getElementById('load-behavior').value;
        const discardingDelay = parseInt(document.getElementById('discarding-delay').value, 10);
        const loadingDelay = parseInt(document.getElementById('loading-delay').value, 10);
        const altClickMode = document.getElementById('alt-click-mode').value;
		

        // Validate inputs
        if (Number.isNaN(maxTabs) || maxTabs < 1) {
            alert('Maximum concurrent tabs must be at least 1.');
            return;
        }
        if (Number.isNaN(queueLimit) || queueLimit < 3 || queueLimit > 500) {
            alert('Queue limit must be between 3 and 500.');
            return;
        }
        if (!['queue-active', 'stay-discarded'].includes(loadBehavior)) {
            alert('Invalid tab loading behavior selected.');
            return;
        }
        if (Number.isNaN(discardingDelay) || discardingDelay < 0 || discardingDelay > 1000) {
            alert('Discarding delay must be between 0 and 1000.');
            return;
        }
        if (Number.isNaN(loadingDelay) || loadingDelay < 0 || loadingDelay > 5000) {
            alert('Loading delay must be between 0 and 5000.');
            return;
        }
		if (!['none', 'discarded', 'queue'].includes(altClickMode)) {
            alert('Invalid Alt+click mode selected.');
            return;
        }

        try {
            // Save settings
            await browser.storage.local.set({
                maxConcurrentTabs: maxTabs,
                queueLimit: queueLimit,
                loadBehavior: loadBehavior,
                discardingDelay: discardingDelay,
                loadingDelay: loadingDelay,
				altClickMode: altClickMode
            });
            const message = document.getElementById('save-message');
            message.classList.add('visible');
            setTimeout(() => message.classList.remove('visible'), 3000);
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('Error saving settings. Please try again.');
        }
    });
});