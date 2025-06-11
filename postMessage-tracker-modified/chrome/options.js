function save_options() {
	var log_url = document.getElementById('log-url').value;
	chrome.storage.sync.set({
		log_url: log_url.length > 0?log_url:''
	}, function() {
		var status = document.getElementById('status');
		status.textContent = 'Log URL saved.';
		setTimeout(function() {
			status.textContent = '';
            // window.close(); // Closing options page automatically might not be desired by all.
		}, 1750);
	});
}

function restore_options() {
	chrome.storage.sync.get({
		log_url: ''
	}, function(items) {
		document.getElementById('log-url').value = items.log_url;
	});
}

document.addEventListener('DOMContentLoaded', function () {
	restore_options();
	document.getElementById('save').addEventListener('click', save_options);
});