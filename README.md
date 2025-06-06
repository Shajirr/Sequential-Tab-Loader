# Sequential-Tab-Loader
This is a Firefox addon that loads tabs sequentially one by one or in batches to reduce lag and reduce time until you get the first tab(s) fully loaded.  
published here:  
https://addons.mozilla.org/en-GB/firefox/addon/sequential-tab-loader/

Sequential Tab Loader attempts to solve a particular problem - when opening many new tabs quickly, Firefox handles that... very poorly. It attempts to load them all at once, slowing down the browser and extending the time until any tabs load at all. Especially bad on slow internet connection.

**This addon does the following:**

* Makes new tabs load in unloaded (discarded) state first, to minimise resource usage
* Adds the newly opened unloaded tabs to a queue
* Loads tabs from the queue one by one by default, or in batches if you specify that in Options

This way you get the first tabs loaded very quickly, their load time won't be extended by all the other tabs that you opened.

**Usage instructions:**

* addon is active by default, can be used as is.
* It is recommended to pin the addon icon to the toolbar, this way you will be able to see how many tabs are in the queue waiting to be loaded.
* clicking the addon icon pauses/unpauses addon operation. Pausing it will not clear the queue, after unpausing it will continue loading from where it left off. However, new items aren't added to the queue when the addon is paused.

**Config options**

**Options menu**

* Maximum concurrent tabs to load - how many tabs are being loaded at once. One by default. Increase if you want to load them in batches instead.
* Queue limit - max number of tabs that can be added to the loading queue. When this limit is exceeded, further opened new tabs will just remain unloaded after being opened. If you need to open many links, but not necessarily need all of them to be loaded, limiting the queue to a smaller number can achieve that.
* Tab loading behaviour - "Load tabs" is the default mode of loading tabs from a queue. If you choose "Don't load tabs" - it will disable the loading queue, and all newly opened tabs will remain in an unloaded (discarded) state until clicked. Can be used if you want to open many links, but don't want them to be loaded automatically.
* Tab discarding delay - delay after the tab is created and before its unloaded. Normally not needed.
* Tab loading delay - delay after the previous tab finishes loading and before the next one starts loading. Setting this delay will disable "Maximum concurrent tabs to load" option and tabs will be loading one by one.

**Icon context menu** (right click on the addon icon)

* "Resume loading" - attempts to re-start tab loading
* "Load next tab" - this option will skip the current tab and start loading from the next one
* "Empty the queue" - clears the loading queue entirely, tabs will remain unloaded until clicked

**Recommendations:**

* Make bookmarks open as background tabs, so that they could also be loaded via a queue. Go to "about:config" page, set "browser.tabs.loadBookmarksInBackground" to "true"
* Go to Firefox Settings -> Tabs section -> disable "When you open a link, image or media in a new tab, switch to it immediately" - you don't want focus constantly switching to the new tabs, as this will trigger their immediate loading, invalidating the loading queue.

**Issues:**

* Sometimes the queue can get stuck and stops loading tabs - in that case try the addon icon context menu options - "Resume loading" or "Load next tab"
* When you have the following about:config property: "browser.tabs.loadDivertedInBackground"
 set to "true", and you left click a link that opens a new tab, that tab opens blank. Opening the same link from its context menu, or by Ctrl+click, or with middle mouse button click works just fine. Why? ¯\\\_(ツ)\_/¯   
FF is weird. So far I haven't found how to deal with such links without affecting all the other ones. If you encounter this - set the tab discarding delay. Try the 50ms first, and if you still see blank tabs, increase the delay until tabs start getting their URLs.

**Permissions:**

* Access your data for all websites (<all_urls>) - needed for discarding (browser.tabs.discard) and reloading (browser.tabs.reload) tabs to work on all URLs. Without said permission the addon would only be able to work on pre-defined domains.
* Access browser tabs - needed to interact with tabs, listen to tab events (creation, updates, removal) and get tab properties. Without it the addon would be non-functional.
