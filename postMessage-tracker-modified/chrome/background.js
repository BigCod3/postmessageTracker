var tab_listeners = {};
var tab_push = {}, tab_lasturl = {};
var selectedId = -1;
// Removed activeDebuggingSession and related debugger logic

function refreshCount() {
	txt = tab_listeners[selectedId] ? tab_listeners[selectedId].rawListenerCount : 0;
	chrome.tabs.get(selectedId, function() {
		if (!chrome.runtime.lastError) {
			chrome.browserAction.setBadgeText({"text": ''+txt, tabId: selectedId});
			if(txt > 0) {
				chrome.browserAction.setBadgeBackgroundColor({ color: [255, 0, 0, 255]});
			} else {
				chrome.browserAction.setBadgeBackgroundColor({ color: [0, 0, 255, 0] });
			}
		}
	});
}

function logListener(data) {
	chrome.storage.sync.get({ log_url: '' }, function(items) {
		log_url = items.log_url;
		if(!log_url.length) return;
		let dataToSend = JSON.stringify(data);
		try {
			fetch(log_url, {
				method: 'post',
				headers: { "Content-type": "application/json; charset=UTF-8" },
				body: dataToSend
			});
		} catch(e) { console.error("postMessage-tracker: Error logging listener data", e); }
	});
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
	tabId = sender.tab ? sender.tab.id : null; // Simpler tabId retrieval for messages from content script

    // Removed initiateDeepAnalysis handling as debugger logic is removed

	if(msg.listener) { // Message from content_script with a new listener
		if (!tabId && sender.tab) tabId = sender.tab.id; // Ensure tabId is set if possible

        if (!tabId) {
            // console.warn("Listener message received without identifiable tabId", msg);
            // If it's from the injected script, it won't have sender.tab directly.
            // The 'm' function in injected script doesn't currently pass tabId.
            // This path (msg.listener) is for messages from content script's own event listener
            // that wraps the injected script's custom event. That sender *will* have a tab.
            return;
        }

        if(msg.listener == 'function () { [native code] }') return;
		msg.parent_url = sender.tab.url; // This relies on sender.tab, ensure it's present
		
        if(!tab_listeners[tabId] || !tab_listeners[tabId].listeners) {
             tab_listeners[tabId] = { listeners: [], rawListenerCount: 0 };
        }
		tab_listeners[tabId].listeners.push(msg);
        tab_listeners[tabId].rawListenerCount++;
		logListener(msg);
	}
	if(msg.pushState && tabId) { tab_push[tabId] = true; }
	if(msg.changePage && tabId) {
		delete tab_lasturl[tabId];
        if (tab_listeners[tabId]) {
            tab_listeners[tabId] = { listeners: [], rawListenerCount: 0 };
        }
	}
	if(msg.log) { /* console.log(msg.log); */ }
    else if (tabId) { // Only refresh if it's not a log-only message and tabId is valid
        refreshCount();
    }
});

chrome.tabs.onUpdated.addListener(function(tabId, props) {
	if (props.status == "complete") {
		if(tabId == selectedId) refreshCount();
	} else if(props.status) {
		if(tab_push[tabId]) { delete tab_push[tabId]; }
        else {
			if(!tab_lasturl[tabId]) {
				tab_listeners[tabId] = { listeners: [], rawListenerCount: 0 };
                if(tabId == selectedId) refreshCount();
			}
		}
	}
	if(props.status == "loading") {
        tab_lasturl[tabId] = true;
    }
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    delete tab_listeners[tabId];
    delete tab_push[tabId];
    delete tab_lasturl[tabId];
});


chrome.tabs.onActivated.addListener(function(activeInfo) {
	selectedId = activeInfo.tabId;
    if(!tab_listeners[selectedId]) {
        tab_listeners[selectedId] = { listeners: [], rawListenerCount: 0 };
    }
	refreshCount();
});

chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs && tabs.length > 0) {
        selectedId = tabs[0].id;
        if(!tab_listeners[selectedId]) {
            tab_listeners[selectedId] = { listeners: [], rawListenerCount: 0 };
        }
        refreshCount();
    }
});

chrome.extension.onConnect.addListener(function(port) {
	port.onMessage.addListener(function(msg) { // msg from popup is "get-stuff"
        let listenersForTab = [];
        if (selectedId !== -1 && selectedId !== null && typeof selectedId !== 'undefined' && tab_listeners[selectedId]) {
            listenersForTab = tab_listeners[selectedId].listeners;
        }
		port.postMessage({listeners: listenersForTab});
	});
});