// MAIN CONTENT SCRIPT (NOT INJECTED)
document.addEventListener('postMessageTracker', function(event) {
    try {
        if (chrome.runtime && chrome.runtime.id && event.detail) {
            chrome.runtime.sendMessage(event.detail, function(response) {
                if (chrome.runtime.lastError) {
                    // console.warn("PMT CS: Error sending 'postMessageTracker' event to background:", chrome.runtime.lastError.message);
                }
            });
        } else if (event.detail && !(chrome.runtime && chrome.runtime.id)) {
             // console.warn("PMT CS: Extension context invalidated ('postMessageTracker' event). Cannot send. Detail:", JSON.stringify(event.detail).substring(0,100));
        }
    } catch (e) {
        // console.error("PMT CS: Exception during 'postMessageTracker' event dispatch to background:", e);
    }
});

window.addEventListener('beforeunload', function(event) {
	var storeEvent = new CustomEvent('postMessageTracker', {'detail':{changePage:true}});
	document.dispatchEvent(storeEvent);
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // // console.log("PMT ContentScript (Main): Received runtime message:", request);
    if (request.action === "pmt_reveal_in_sources" && request.listenerId !== undefined) {
        // // console.log("PMT ContentScript (Main): Action 'pmt_reveal_in_sources' received for listenerId:", request.listenerId); // Already present from screenshot
        try {
            if (chrome.runtime && chrome.runtime.id) {
                // // console.log("PMT ContentScript (Main): Dispatching 'pmtRevealInSourcesEvent_injected' to *window* for listenerId:", request.listenerId); // Already present
                window.dispatchEvent(new CustomEvent('pmtRevealInSourcesEvent_injected', {
                    detail: { listenerId: request.listenerId }
                }));
                sendResponse({status: "Reveal command forwarded to injected script via window event."});
            } else {
                console.warn("PMT ContentScript (Main): Extension context invalidated, cannot process pmt_reveal_in_sources from popup.");
                sendResponse({status: "Error: Extension context invalidated."});
            }
        } catch (e) {
            console.error("PMT ContentScript (Main): Exception during 'pmt_reveal_in_sources' message handling:", e, request);
            sendResponse({status: "Error: Exception processing reveal command."});
        }
        return true;
    }
});

(function() {
    if (document.contentType === 'application/xml' || document.contentType === 'text/xml') { return; }
    if (!document.documentElement) { return; }
    var script = document.createElement("script");
    script.setAttribute('type', 'text/javascript');
    script.src = chrome.runtime.getURL('injected.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function() { script.remove(); };
})();
