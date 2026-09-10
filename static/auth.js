// Firebase Google Sign-In + session/CSRF plumbing for School Assistant.
//
// dashboard.js calls apiFetch(...) instead of fetch(...) for every
// authenticated data request, and initApp() instead of loadDashboard()
// directly, so it never has to know about auth state itself.

var firebaseReady = false;
var currentUserEmail = null;

(function initFirebase() {

    var config = window.__FIREBASE_CONFIG__ || {};

    if (config.apiKey && config.authDomain && config.projectId) {

        try {
            firebase.initializeApp(config);
            firebaseReady = true;
        } catch (err) {
            console.error("Firebase init failed:", err);
        }

    } else {
        console.warn("FIREBASE_WEB_CONFIG is missing or incomplete - sign-in is disabled.");
    }

})();


function getCsrfToken() {

    var match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);

    return match ? decodeURIComponent(match[1]) : "";
}


function showLoginView(message) {

    document.getElementById("appShell").classList.add("hidden");
    document.getElementById("loginView").classList.remove("hidden");

    var messageEl = document.getElementById("loginMessage");

    if (message) {
        messageEl.textContent = message;
        messageEl.classList.remove("hidden");
    } else {
        messageEl.textContent = "";
        messageEl.classList.add("hidden");
    }

}


function hideLoginView() {

    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appShell").classList.remove("hidden");
}


// Wraps fetch() for authenticated data endpoints: attaches the CSRF header
// on state-changing requests, and redirects to the login screen on a 401
// instead of letting the caller render a raw error box. Callers should
// catch the sentinel error below and return early rather than showing
// their own error UI on top of the login screen.
async function apiFetch(url, options) {

    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {});

    var method = (opts.method || "GET").toUpperCase();

    if (method !== "GET") {
        opts.headers["X-CSRF-Token"] = getCsrfToken();
    }

    var response = await fetch(url, opts);

    if (response.status === 401) {
        showLoginView("Your session has expired. Please sign in again.");
        throw new Error("__auth_redirect__");
    }

    return response;
}


async function postJSON(url, body) {

    var response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": getCsrfToken()
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });

    var data = await response.json().catch(function () {
        return {};
    });

    return { response: response, data: data };
}


async function initApp() {

    try {

        var response = await fetch("/auth/me");
        var data = await response.json();

        if (data.authenticated) {

            currentUserEmail = data.email;

            var emailEl = document.getElementById("currentUserEmail");

            if (emailEl) {
                emailEl.textContent = data.email;
            }

            hideLoginView();

            loadDashboard();

        } else {
            showLoginView();
        }

    } catch (err) {

        console.error("Failed to check auth state:", err);

        showLoginView("Unable to reach the server. Please try again.");
    }

}


document
    .getElementById("googleSignInButton")
    .addEventListener("click", async function () {

        var button = this;
        var messageEl = document.getElementById("loginMessage");

        messageEl.classList.add("hidden");

        if (!firebaseReady) {
            messageEl.textContent = "Sign-in is not configured for this deployment.";
            messageEl.classList.remove("hidden");
            return;
        }

        button.disabled = true;
        button.textContent = "Signing in...";

        try {

            var provider = new firebase.auth.GoogleAuthProvider();
            var result = await firebase.auth().signInWithPopup(provider);
            var idToken = await result.user.getIdToken();

            var outcome = await postJSON("/auth/session", { idToken: idToken });

            if (!outcome.response.ok || outcome.data.status !== "ok") {

                await firebase.auth().signOut();

                messageEl.textContent =
                    outcome.data.error || "You are not authorized to access School Assistant.";
                messageEl.classList.remove("hidden");

                return;
            }

            await initApp();

        } catch (err) {

            console.error("Sign-in failed:", err);

            messageEl.textContent = "Sign-in failed. Please try again.";
            messageEl.classList.remove("hidden");

        } finally {

            button.disabled = false;
            button.textContent = "Sign in with Google";
        }

    });


document
    .getElementById("logoutButton")
    .addEventListener("click", async function () {

        var button = this;

        button.disabled = true;

        try {
            await postJSON("/auth/logout");
        } catch (err) {
            console.error("Logout request failed:", err);
        }

        try {
            if (firebaseReady && firebase.auth().currentUser) {
                await firebase.auth().signOut();
            }
        } catch (err) {
            console.error("Firebase sign-out failed:", err);
        }

        button.disabled = false;

        currentUserEmail = null;

        showLoginView();

    });
