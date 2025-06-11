// var port = chrome.extension.connect({ // For Manifest V2
var port = chrome.runtime.connect({ // Preferred for Manifest V2, compatible with V3 service workers
	name: "PostMessageTrackerComms"
});
var currentTabId = null;

// Add an error handler for the port
port.onDisconnect.addListener(function() {
    console.warn("PMT Popup: Port disconnected from background.");
    if (chrome.runtime.lastError) {
        console.error("PMT Popup: Disconnect error:", chrome.runtime.lastError.message);
    }
    var x = document.getElementById('x');
	x.innerHTML = '<p style="color:orange; text-align:center; padding:20px;">Connection to background script lost. Please try reloading the extension or the page.</p>';
    document.getElementById('h').innerText = 'Disconnected';
});


function loaded() {
	port.postMessage("get-stuff");
	port.onMessage.addListener(function(msg) {
        if (chrome.runtime.lastError) {
            console.error("PMT Popup: Error receiving message from background:", chrome.runtime.lastError.message);
            var x = document.getElementById('x');
            x.innerHTML = '<p style="color:red; text-align:center; padding:20px;">Error loading listeners. Background script might be unavailable.</p>';
            document.getElementById('h').innerText = 'Error';
            return;
        }

		chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (chrome.runtime.lastError) {
                console.error("PMT Popup: Error querying tabs:", chrome.runtime.lastError.message);
                return;
            }
            if (tabs && tabs.length > 0) {
                currentTabId = tabs[0].id;
			    listListeners(msg.listeners, tabs[0].url);
            } else {
                listListeners([], "No active tab found");
            }
		});
	});
}

window.onload = loaded;

function listListeners(listeners, tabUrl) {
	var x = document.getElementById('x');
	x.innerHTML = '';

    document.getElementById('h').innerText = tabUrl || 'N/A';
    const noListenersMessage = document.getElementById('no-listeners-message');

	if (!listeners || listeners.length === 0) {
        noListenersMessage.style.display = 'block';
		return;
	}
    noListenersMessage.style.display = 'none';

    const uniqueListenersMap = new Map();
    listeners.forEach(listener => {
        const key = listener.listenerId + "||" + listener.listener + "||" + listener.stack + "||" + listener.domain;
        if (!uniqueListenersMap.has(key)) {
            uniqueListenersMap.set(key, { master: listener, count: 1, duplicates: [] });
        } else {
            let entry = uniqueListenersMap.get(key);
            entry.count++;
            entry.duplicates.push(listener);
        }
    });

	uniqueListenersMap.forEach((entry) => {
        const listener = entry.master;
		const el = document.createElement('li');
        el.className = 'listener-item';

		const domainEl = document.createElement('b');
		domainEl.innerText = listener.domain || 'N/A Domain';
		el.appendChild(domainEl);

		const hopsEl = document.createElement('code');
        hopsEl.className = 'hops-info';
		hopsEl.innerText = (listener.window ? listener.window + ' ' : '') + (listener.hops && listener.hops.length ? listener.hops : 'N/A Hops');
		el.appendChild(hopsEl);

        if (listener.analysis) {
            const analysisDiv = document.createElement('div');
            analysisDiv.className = 'analysis-section';
            const originP = document.createElement('p');
            originP.innerHTML = `<span class="analysis-title">Origin Check:</span> <span class="origin-check ${listener.analysis.originCheck || 'unknown'}">${(listener.analysis.originCheck || 'Unknown').replace(/_/g, ' ')}</span>`;
            analysisDiv.appendChild(originP);
            if (listener.analysis.sinks && listener.analysis.sinks.length > 0) {
                const sinksTitleP = document.createElement('p');
                sinksTitleP.innerHTML = `<span class="analysis-title">Potential Sinks (${listener.analysis.sinks.length}):</span>`;
                analysisDiv.appendChild(sinksTitleP);
                const sinkListUl = document.createElement('ul');
                sinkListUl.className = 'sinks-list';
                listener.analysis.sinks.forEach(sink => {
                    const sinkItemLi = document.createElement('li');
                    let sinkText = `<span class="sink-type">${sink.type}:</span> <code class="sink-snippet">${escapeHtml(sink.snippet.substring(0, 150))}${sink.snippet.length > 150 ? '...' : ''}</code>`;
                    if (sink.potentiallyControlled) {
                        sinkText += ` <span class="controlled">(Potentially Data-Controlled!)</span>`;
                    }
                    sinkItemLi.innerHTML = sinkText;
                    sinkListUl.appendChild(sinkItemLi);
                });
                analysisDiv.appendChild(sinkListUl);
            }
            el.appendChild(analysisDiv);
        }

		const stackEl = document.createElement('span');
        stackEl.className = 'stack-trace';
		if(listener.fullstack && Array.isArray(listener.fullstack)) stackEl.setAttribute('title', listener.fullstack.join("\n\n"));
		stackEl.textContent = listener.stack || 'N/A Stack Trace';
		el.appendChild(stackEl);

		const listenerCodeEl = document.createElement('pre');
        listenerCodeEl.className = 'listener-code';
        // listenerCodeEl.innerText = listener.listener || 'N/A Listener Code'; // Original line commented out/removed
        const codeElement = document.createElement('code');
        codeElement.className = 'language-javascript';
        codeElement.textContent = listener.listener || 'N/A Listener Code';
        listenerCodeEl.appendChild(codeElement);
		el.appendChild(listenerCodeEl);

        if (entry.count > 1) {
            const duplicateCountEl = document.createElement('div');
            duplicateCountEl.className = 'duplicate-count';
            duplicateCountEl.innerText = `(${entry.count -1} more identical listener${entry.count -1 > 1 ? 's' : ''} not shown)`;
            el.appendChild(duplicateCountEl);
        }

        const revealButton = document.createElement('button');
        revealButton.className = 'reveal-devtools-button';
        revealButton.textContent = 'Reveal in DevTools';
        revealButton.title = 'Log this listener function to the DevTools console. Click the logged function to jump to its source.';
        // Store the ID directly on the button element using dataset
        if (listener.listenerId !== undefined) {
            revealButton.dataset.listenerId = listener.listenerId;
        } else {
            console.warn("PMT Popup: Listener object missing listenerId:", listener);
        }


        revealButton.onclick = function(event) {
            const clickedButton = event.currentTarget;
            const listenerIdForHandlerStr = clickedButton.dataset.listenerId;
            
            console.log("PMT Popup: 'Reveal in DevTools' clicked. Listener ID from dataset (string):", listenerIdForHandlerStr, "Current Tab ID:", currentTabId);

            if (listenerIdForHandlerStr === undefined) {
                alert("Cannot reveal: Listener ID is missing from the button. This is an internal error.");
                console.error("PMT Popup: listenerIdForHandlerStr is undefined. Button:", clickedButton, "Original listener object:", listener);
                return;
            }
            
            const listenerIdForHandler = parseInt(listenerIdForHandlerStr, 10);

            if (currentTabId !== null && !isNaN(listenerIdForHandler)) {
                if (chrome.runtime && chrome.runtime.id && port) {
                    chrome.tabs.sendMessage(currentTabId, {
                        action: "pmt_reveal_in_sources",
                        listenerId: listenerIdForHandler,
                    }, function(response) {
                        console.log("PMT Popup: Response from content script for reveal action:", response);
                        if (chrome.runtime.lastError) {
                            console.error("PMT Popup: Error sending reveal message:", chrome.runtime.lastError.message);
                            alert("Could not send reveal command. Error: " + chrome.runtime.lastError.message + "\nTry reloading the page or extension.");
                        } else if (response && response.status && response.status.startsWith("Error:")) {
                            console.error("PMT Popup: Reveal command failed:", response.status);
                            alert("Reveal command failed: " + response.status);
                        }
                    });
                } else {
                     alert("Cannot reveal: Extension context or connection to background may be invalid. Please reload the page/extension.");
                     console.error("PMT Popup: Cannot reveal - Extension context or port to background invalid.");
                }
            } else {
                alert("Cannot reveal: Missing or invalid Tab ID or Listener ID.");
                console.error("PMT Popup: Cannot reveal - Missing or invalid Tab ID or Listener ID. Tab ID:", currentTabId, "Parsed Listener ID:", listenerIdForHandler, "Original string ID:", listenerIdForHandlerStr);
            }
        };
        el.appendChild(revealButton);

		x.appendChild(el);
	});

    if (uniqueListenersMap.size > 0) { // Or listeners.length > 0, depending on preference
        if (typeof Prism !== 'undefined') {
            Prism.highlightAll();
        }
    }
}

function escapeHtml(unsafe) {
    if (unsafe === null || typeof unsafe === 'undefined') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }