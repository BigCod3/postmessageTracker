var injectedJS = function(pushstate, msgeventlistener, msgporteventlistener) {
	var loaded = false;
    var originalFunctionToString = Function.prototype.toString;

    var pmtListenerRegistry = new Map();
    var pmtListenerIdCounter = 0;
    // console.log("PMT InjectedJS: Initializing. Registry created, counter at 0. Timestamp:", Date.now()); // DIAGNOSTIC

	var m = function(detail) {
		if('stack' in detail && detail.stack && detail.stack.includes("chrome-extension://")){ return; }
		var storeEvent = new CustomEvent('postMessageTracker', {'detail':detail});
		document.dispatchEvent(storeEvent);
	};

	var h = function(p) {
		var hops="";
        try {
        		if(!p) p=window;
        		if(p.top != p && p.top == window.top) {
        			var w = p;
        			while(top != w) {
        				var x = 0;
        				for(var i = 0; i < w.parent.frames.length; i++) {
        					if(w == w.parent.frames[i]) x=i;
        				};
        				hops="frames["+x+"]" + (hops.length?'.':'') + hops;
        				w=w.parent;
        			};
        			hops="top"+(hops.length?'.'+hops:'')
        		} else {
        			hops=p.top == window.top ? "top" : "diffwin";
        		}
        } catch(e) {
            hops = "error_determining_hops";
        }
		return hops;
	};
	var jq = function(instance) {
		if(!instance || !instance.message || !instance.message.length) return;
		var j = 0; while(e = instance.message[j++]) {
			listener = e.handler; if(!listener) return;
            const currentListenerId = pmtListenerIdCounter++;
            pmtListenerRegistry.set(currentListenerId, {
                func: listener,
                listenerString: originalFunctionToString.apply(listener),
                stack: 'jQuery (Stack trace from here might not be useful for source)',
                fullStack: []
            });
            // // console.log("PMT InjectedJS: Registered jQuery listener with ID:", currentListenerId);
            let analysis = { originCheck: 'unknown_jquery', sinks: [], rawListener: originalFunctionToString.apply(listener) };
			m({
                listenerId: currentListenerId,
                window:window.top==window?'top':window.name,
                hops:h(),domain:document.domain,
                stack:'jQuery',
                listener:listener.toString(),
                analysis: analysis
            });
		};
	};

	var l = function(listener_func_param, pattern_before, additional_offset) {
        offset = 3 + (additional_offset||0);
        var stack = '', fullstack = [];
		try { throw new Error(''); } catch (error) { stack = error.stack || ''; }

        if (typeof stack === 'string' && stack.length > 0) {
            fullstack = stack.split('\n').map(function (line) { return line.trim(); });
            if(pattern_before) {
                let nextitem = false;
                let filteredStack = fullstack.filter(function(e_stack_line){
                    if(nextitem) { nextitem = false; return true; }
                    if(e_stack_line.match(pattern_before))
                        nextitem = true;
                    return false;
                });
                stack = filteredStack[0] || fullstack[offset] || '';
            } else {
                stack = fullstack[offset] || '';
            }
        }

		let listener_str = listener_func_param.__postmessagetrackername__ || originalFunctionToString.apply(listener_func_param);

        const currentListenerId = pmtListenerIdCounter++;
        pmtListenerRegistry.set(currentListenerId, {
            func: listener_func_param,
            stack: stack,
            fullStack: fullstack,
            listenerString: listener_str
        });
        // // console.log("PMT InjectedJS: Registered listener with ID:", currentListenerId, " Current registry size:", pmtListenerRegistry.size); // DIAGNOSTIC

        let analysis = {
            originCheck: 'unverified',
            sinks: [],
            rawListener: listener_str,
            acceptsEventArgument: listener_func_param.length > 0
        };
        const commonEventVarNames = ['event', 'message', 'msg', 'evt'];
        let originCheckFound = false;
        let originExpression = '';
        let identifiedEventVar = '';
        for (const evName of commonEventVarNames) {
            const originRegex = new RegExp(`(?:\\W|^)(${evName})\\.origin(?:\\W|$)`);
            const match = listener_str.match(originRegex);
            if (match) {
                identifiedEventVar = match[1];
                originExpression = `${identifiedEventVar}.origin`;
                originCheckFound = true;
                break;
            }
        }
        if (!originCheckFound) {
            const singleLetterRegex = /(?:\W|^)([a-z])\.origin(?:\W|$)/;
            const match = listener_str.match(singleLetterRegex);
            if (match) {
                identifiedEventVar = match[1];
                originExpression = `${identifiedEventVar}.origin`;
                originCheckFound = true;
            }
        }
        if (originCheckFound) {
            if (new RegExp(`if\\s*\\(\\s*${originExpression.replace('.', '\\.')}\\s*(?:===?)\\s*['"][^'"]+['"]`).test(listener_str) ||
                new RegExp(`if\\s*\\(\\s*['"][^'"]+['"]\\s*(?:===?)\\s*${originExpression.replace('.', '\\.')}`).test(listener_str) ||
                new RegExp(`${originExpression.replace('.', '\\.')}\\s*===?\\s*window\\.location\\.origin`).test(listener_str) ||
                new RegExp(`window\\.location\\.origin\\s*===?\\s*${originExpression.replace('.', '\\.')}`).test(listener_str) ){
                analysis.originCheck = 'verified_strict_equality';
            }
            else if (new RegExp(`${originExpression.replace('.', '\\.')}\\.endsWith\\s*\\(`).test(listener_str)) {
                 analysis.originCheck = 'verified_endsWith';
            }
            else if (new RegExp(`${originExpression.replace('.', '\\.')}\\.startsWith\\s*\\(`).test(listener_str)) {
                 analysis.originCheck = 'potentially_weak_startsWith';
            }
            else if (new RegExp(`${originExpression.replace('.', '\\.')}\\.indexOf\\s*\\(`).test(listener_str)) {
                analysis.originCheck = 'weak_indexOf';
            } else if (new RegExp(`${originExpression.replace('.', '\\.')}\\.includes\\s*\\(`).test(listener_str)) {
                analysis.originCheck = 'weak_includes';
            }
            else if (new RegExp(`${originExpression.replace('.', '\\.')}\\.match\\s*\\(`).test(listener_str) ||
                     new RegExp(`\\/[^\\/]+\\/\\.test\\s*\\(\\s*${originExpression.replace('.', '\\.')}\\s*\\)`).test(listener_str) ) {
                analysis.originCheck = 'verified_regex';
            }
            else if (new RegExp(`${originExpression.replace('.', '\\.')}\\s*(?:===?|!==?)\\s*[a-zA-Z_$][a-zA-Z0-9_$]*`).test(listener_str) && /location\.(?:host|hostname)/.test(listener_str) ) {
                 analysis.originCheck = 'verified_variable_comparison';
            }
             else {
                analysis.originCheck = 'unverified_check_present';
            }
        } else {
            analysis.originCheck = 'missing';
        }
        let taintedVariables = new Set();
        let dataParameterForRegex = '';
        if (identifiedEventVar) {
            const baseDataProperty = identifiedEventVar + ".data";
            dataParameterForRegex = baseDataProperty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            taintedVariables.add(baseDataProperty);
            const assignmentRegex = new RegExp(
                `(?:var|let|const)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*(${dataParameterForRegex}(?:\\.[a-zA-Z_$][a-zA-Z0-9_$]*|\\[(?:\\d+|'[^']+'|"[^"]+")\\])*)\\s*;`,
                "g"
            );
            let assignmentMatch;
            while((assignmentMatch = assignmentRegex.exec(listener_str)) !== null) {
                if (assignmentMatch[1]) {
                    taintedVariables.add(assignmentMatch[1]);
                }
            }
            // Track variables initialized with JSON.parse(event.data) even without declarations
            const jsonParseRegex = new RegExp('(?:var|let|const)?\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*JSON\\.parse\\(\\s*' + dataParameterForRegex + '\\s*\\)\\s*;?', 'g');
            let jsonMatch;
            while((jsonMatch = jsonParseRegex.exec(listener_str)) !== null) {
                if (jsonMatch[1]) {
                    taintedVariables.add(jsonMatch[1]);
                }
            }
        } else {
            // Fallback if identifiedEventVar is not found (less likely for postMessage but good for robustness)
            dataParameterForRegex = '(?:event|message|msg|evt|[a-z])\\.data'.replace('.', '\\.');
        }
        // const dataRegex = new RegExp(dataParameterForRegex); // Keep for direct usage if needed, but new logic is more comprehensive

        const sinkRegexes = {
            innerHTML: /(?:[^a-zA-Z0-9_]|^)innerHTML\s*=[^;]+(?:;|$)/g,
            outerHTML: /(?:[^a-zA-Z0-9_]|^)outerHTML\s*=[^;]+(?:;|$)/g,
            insertAdjacentHTML: /(?:[^a-zA-Z0-9_]|^)insertAdjacentHTML\s*\([^)]+\)(?:;|$)/g,
            documentWrite: /document\.write(?:ln)?\s*\([^)]+\)(?:;|$)/g,
            eval: /(?:\W|^)eval\s*\([^)]+\)(?:;|$)/g,
            setTimeoutString: /setTimeout\s*\(\s*(['"`]|(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*(?!\()))[^,]*,\s*\d+\s*\)(?:;|$)/g,
            setIntervalString: /setInterval\s*\(\s*(['"`]|(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*(?!\()))[^,]*,\s*\d+\s*\)(?:;|$)/g,
            locationAssignment: /(?:[^a-zA-Z0-9_]|^)location\s*(?:\.href|\.assign|\.replace)?\s*=[^;]+(?:;|$)/g,
            scriptSrcViaCreateElement: /document\.createElement\s*\(\s*['"]script['"]\s*\)[^;]*\.src\s*=[^;]+(?:;|$)/g,
            aHrefJS: /document\.createElement\s*\(\s*['"]a['"]\s*\)[^;]*\.href\s*=\s*['"`]javascript:/ig,
            jsonParse: /JSON\.parse\s*\([^)]+\)/g
        };
        for (const sinkType in sinkRegexes) {
            let match;
            sinkRegexes[sinkType].lastIndex = 0;
            while ((match = sinkRegexes[sinkType].exec(listener_str)) !== null) {
                let snippet = match[0].trim();
                let isPotentiallyControlled = false;

                // Check against all tainted variables (including those from JSON.parse)
                for (const taintedVar of taintedVariables) {
                    let controlRegex;
                    if (taintedVar.includes('.')) { // e.g., "event.data"
                        // Matches "event.data", "event.data.foo", "event.data.foo.bar"
                        controlRegex = new RegExp(taintedVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*');
                    } else { // e.g., "parsedData" (from JSON.parse) or "localCopy" (from let localCopy = event.data)
                        // Matches "parsedData", "parsedData.foo", "localCopy", "localCopy.bar"
                        controlRegex = new RegExp('\\b' + taintedVar + '\\b(\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*');
                    }
                    if (controlRegex.test(snippet)) {
                        isPotentiallyControlled = true;
                        break; 
                    }
                }

                // Fallback: If no tainted variable explicitly matched, check for identifiedEventVar.data directly
                // This is particularly for cases where event.data is used directly in a sink without prior assignment.
                if (!isPotentiallyControlled && identifiedEventVar) {
                    const directDataRegex = new RegExp(identifiedEventVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.data' + '(\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*');
                    if (directDataRegex.test(snippet)) {
                        isPotentiallyControlled = true;
                    }
                }
                analysis.sinks.push({ type: sinkType, snippet: snippet, potentiallyControlled: isPotentiallyControlled });
            }
        }

		m({
            listenerId: currentListenerId,
            window:window.top==window?'top':window.name,
            hops:h(),domain:document.domain,
            stack:stack,fullstack:fullstack,
            listener:listener_str,
            analysis: analysis
        });
	};

    window.addEventListener('pmtRevealInSourcesEvent_injected', function(event) {
        // console.log("PMT InjectedJS: Caught 'pmtRevealInSourcesEvent_injected'. Detail:", event.detail, "Timestamp:", Date.now());
        if (!event.detail || event.detail.listenerId === undefined) {
            console.warn("PMT InjectedJS: Event received without listenerId in detail.");
            return;
        }
        const listenerId = event.detail.listenerId;
        // console.log("PMT InjectedJS: Attempting to reveal listenerId:", listenerId, " Current registry size:", pmtListenerRegistry.size);
        if (pmtListenerRegistry.size > 0 && listenerId < pmtListenerIdCounter) { // Check if ID is within current counter range
             // console.log("PMT InjectedJS: Registry keys:", Array.from(pmtListenerRegistry.keys()));
        }


        const entry = pmtListenerRegistry.get(listenerId);
        // console.log("PMT InjectedJS: Entry found in registry for ID " + listenerId + ":", entry);

        if (entry && entry.func) {
            console.groupCollapsed("PostMessageTracker: Reveal Listener (ID: " + listenerId + ")");
            console.log("Click the function below to navigate to it in the Sources panel:");
            console.debug(entry.func);
            console.log("Listener Code Snippet:\n", entry.listenerString.substring(0, 500) + (entry.listenerString.length > 500 ? "..." : ""));
            if (entry.stack) {
                console.log("Associated Stack Trace:\n" + entry.stack);
            }
            console.groupEnd();
            alert("Information for listener ID " + listenerId + " logged to DevTools console (usually F12). Click the logged function to navigate to its source.");
        } else {
            console.warn("PostMessageTracker: Could not find listener with ID", listenerId, "in injected script registry to reveal. Registry size:", pmtListenerRegistry.size, "Max ID registered:", pmtListenerIdCounter -1 );
            alert("PostMessageTracker: Error - could not find listener ID " + listenerId + " for reveal. Registry might have been reset if page reloaded. Check console for details.");
        }
    });

	var jqc = function(key) { /* ... jqc ... */
		if(typeof window[key] == 'function' && typeof window[key]._data == 'function') {
			ev = window[key]._data(window, 'events');
			jq(ev);
		} else if(window[key] && (expando = window[key].expando)) {
			var i=1; while(instance = window[expando + i++]) {
				jq(instance.events);
			}
		} else if(window[key]) {
			jq(window[key].events);
		}
	};
	var j = function() { /* ... j ... */
		var all = Object.getOwnPropertyNames(window);
		var len = all.length;
		for(var i = 0; i < len; i++) {
			var key = all[i];
			if(key.indexOf('jQuery') !== -1) {
				jqc(key);
			}
		}
		loaded = true;
	};
	History.prototype.pushState = function(state, title, url) { /* ... */
		m({pushState:true});
		return pushstate.apply(this, arguments);
	};
	var original_setter = window.__lookupSetter__('onmessage');
	window.__defineSetter__('onmessage', function(listener_func) { /* ... */
		if(listener_func) {
			l(listener_func, false, 0);
		}
		original_setter(listener_func);
	});
	var c = function(listener) { /* ... c ... */
		var listener_str_check = originalFunctionToString.apply(listener);
		if(listener_str_check.match(/\.deep.*apply.*captureException/s)) return 'raven';
		else if(listener_str_check.match(/arguments.*(start|typeof).*err.*finally.*end/s) && listener["nr@original"] && typeof listener["nr@original"] == "function") return 'newrelic';
		else if(listener_str_check.match(/rollbarContext.*rollbarWrappedError/s) && listener._isWrap &&
					(typeof listener._wrapped == "function" || typeof listener._rollbar_wrapped == "function")) return 'rollbar';
		else if(listener_str_check.match(/autoNotify.*(unhandledException|notifyException)/s) && typeof listener.bugsnag == "function") return 'bugsnag';
		else if(listener_str_check.match(/call.*arguments.*typeof.*apply/s) && typeof listener.__sentry_original__ == "function") return 'sentry';
		else if(listener_str_check.match(/function.*function.*\.apply.*arguments/s) && typeof listener.__trace__ == "function") return 'bugsnag2';
		return false;
	};
    var onmsgport = function(e){ /* ... */
        var p = (e.ports.length?'%cport'+e.ports.length+'%c ':'');
        var msg_console = '%cport%c→%c' + h(e.source) + '%c ' + p + (typeof e.data == 'string'?e.data:'j '+JSON.stringify(e.data));
        if (p.length) {
            console.log(msg_console, "color: blue", '', "color: red", '', "color: blue", '');
        } else {
            console.log(msg_console, "color: blue", '', "color: red", '');
        }
    };
    var onmsg = function(e){ /* ... */
        var p = (e.ports.length?'%cport'+e.ports.length+'%c ':'');
        var msg_console = '%c' + h(e.source) + '%c→%c' + h() + '%c ' + p + (typeof e.data == 'string'?e.data:'j '+JSON.stringify(e.data));
        if (p.length) {
            console.log(msg_console, "color: red", '', "color: green", '', "color: blue", '');
        } else {
            console.log(msg_console, "color: red", '', "color: green", '');
        }
    };
	window.addEventListener('message', onmsg);
    MessagePort.prototype.addEventListener = function(type, listener, useCapture) { /* ... */
        if (type === 'message' && !this.__postmessagetrackername__) {
            this.__postmessagetrackername__ = true;
             msgporteventlistener.call(this, 'message', onmsgport, useCapture);
        }
        return msgporteventlistener.apply(this, arguments);
    };
	Window.prototype.addEventListener = function(type, listener_param, useCapture) { /* ... */
		if(type=='message') {
			var pattern_before = false, offset_val = 0;
			if(originalFunctionToString.apply(listener_param).indexOf('event.dispatch.apply') !== -1) {
				pattern_before = /init\.on|init\..*on\]/;
				if(loaded) { setTimeout(j, 100); }
			}
			var unwrap = function(listener_unwrap_param) {
				let found = c(listener_unwrap_param);
				if(found == 'raven') {
					var fb = false, ff = false, f_val = null;
					for(key in listener_unwrap_param) {
						var v = listener_unwrap_param[key];
						if(typeof v == "function") { ff++; f_val = v; }
						if(typeof v == "boolean") fb++;
					}
					if(ff == 1 && fb == 1) {
						offset_val++;
						listener_unwrap_param = unwrap(f_val);
					}
				} else if(found == 'newrelic') {
					offset_val++;
					listener_unwrap_param = unwrap(listener_unwrap_param["nr@original"]);
				} else if(found == 'sentry') {
					offset_val++;
					listener_unwrap_param = unwrap(listener_unwrap_param["__sentry_original__"]);
				} else if(found == 'rollbar') {
					offset_val+=2;
                    if (listener_unwrap_param._wrapped) listener_unwrap_param = unwrap(listener_unwrap_param._wrapped);
                    else if (listener_unwrap_param._rollbar_wrapped) listener_unwrap_param = unwrap(listener_unwrap_param._rollbar_wrapped);
				} else if(found == 'bugsnag') {
					offset_val++;
					var clr = null;
					try { clr = arguments.callee.caller.caller.caller } catch(e_err) { }
					if(clr && !c(clr)) {
						listener_unwrap_param.__postmessagetrackername__ = originalFunctionToString.apply(clr);
					} else if(clr) { offset_val++ }
				} else if(found == 'bugsnag2') {
					offset_val++;
					var clr = null;
					try { clr = arguments.callee.caller.caller.arguments[1]; } catch(e_err) { }
					if(clr && !c(clr)) {
                        listener_unwrap_param = unwrap(clr);
						listener_unwrap_param.__postmessagetrackername__ = originalFunctionToString.apply(clr);
					} else if(clr) { offset_val++; }
				}
				if(listener_unwrap_param && listener_unwrap_param.name && listener_unwrap_param.name.indexOf('bound ') === 0) {
					listener_unwrap_param.__postmessagetrackername__ = listener_unwrap_param.name;
				}
				return listener_unwrap_param;
			};

            if(typeof listener_param == "function") {
    			listener_param = unwrap(listener_param);
			    l(listener_param, pattern_before, offset_val);
            }
		}
		return msgeventlistener.apply(this, arguments);
	};
	window.addEventListener('load', j);
	window.addEventListener('postMessageTrackerUpdate', j);
};
injectedJS = '(' + injectedJS.toString() + ')(History.prototype.pushState, Window.prototype.addEventListener, MessagePort.prototype.addEventListener);';

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
    script.appendChild(document.createTextNode(injectedJS));
    (document.head || document.documentElement).appendChild(script);
    if (script.parentNode) { script.parentNode.removeChild(script); }
})();