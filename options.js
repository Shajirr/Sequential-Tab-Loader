// Handle options page initialization and form submission
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load saved settings
        const result = await browser.storage.local.get(['maxConcurrentTabs', 'queueLimit', 'loadBehavior']);
        document.getElementById('max-tabs').value = result.maxConcurrentTabs || 1;
        document.getElementById('queue-limit').value = result.queueLimit || 25;
        document.getElementById('load-behavior').value = result.loadBehavior || 'queue-active';
    } catch (error) {
        console.error('Failed to load settings:', error);
        alert('Error loading settings. Please try again.');
    }

    // Handle form submission
    document.getElementById('options-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const maxTabs = parseInt(document.getElementById('max-tabs').value, 10);
        const queueLimit = parseInt(document.getElementById('queue-limit').value, 10);
        const loadBehavior = document.getElementById('load-behavior').value;

        // Validate inputs
        if (Number.isNaN(maxTabs) || maxTabs < 1) {
            alert('Maximum concurrent tabs must be at least 1.');
            return;
        }
        if (Number.isNaN(queueLimit) || queueLimit < 3 || queueLimit > 100) {
            alert('Queue limit must be between 3 and 100.');
            return;
        }
        if (!['queue-active', 'stay-discarded'].includes(loadBehavior)) {
            alert('Invalid tab loading behavior selected.');
            return;
        }

        try {
            // Save settings
            await browser.storage.local.set({
                maxConcurrentTabs: maxTabs,
                queueLimit: queueLimit,
                loadBehavior: loadBehavior
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