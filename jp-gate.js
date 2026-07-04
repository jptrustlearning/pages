/**
 * jp-gate.js — JP Trust Learning hard auth-gate for member-only tool pages.
 *
 * WHY: member-dashboard.html (the PWA shell) is the only page with a real login
 * gate. It opens the tool pages (portfolio-planner, my-portfolio, strategy
 * dashboards, etc.) as SAME-ORIGIN iframes, so inside the app the Supabase
 * session is shared. But each tool page is also a public URL on Cloudflare
 * Pages, so anyone who knows the URL can open it directly and bypass the shell
 * gate. This script closes that hole.
 *
 * BEHAVIOR:
 *   1. Hides <body> immediately so gated content never flashes before the check.
 *   2. Ensures the Supabase JS SDK is present (injects it only if the host page
 *      isn't already loading it — avoids a double-load on pages that include it).
 *   3. Reads the persisted session via getSession() (NOT getUser()). getSession()
 *      reads from storage and is reliable inside same-origin iframes; getUser()
 *      can spuriously return null due to access-token refresh timing / Navigator
 *      Lock contention — the same lesson jp-settings.js documents. Server-side
 *      RLS still enforces auth.uid() = user_id on every real query.
 *   4. Session present  -> reveal the page.
 *      No session / error -> redirect the TOP window to the login shell.
 *
 * Inside the app: session is shared, so the gate passes silently (near-instant,
 * getSession reads localStorage). Opening a tool URL directly with no session
 * redirects to member-dashboard.html to log in.
 *
 * SCOPE: this is a client-side gate = casual protection. It stops link-sharing
 * and normal users, NOT a determined attacker with DevTools. For edge-layer
 * protection that blocks before HTML is served, see the Cloudflare Access plan
 * in the session handoffs (SESSION-HANDOFF-v5.md).
 *
 * USAGE: place in <head> of each member-only page:
 *   <script src="./jp-gate.js?v=TIMESTAMP"></script>
 */
(function () {
    'use strict';

    var CONFIG = {
        url: 'https://rcdukwwcbyryauhqlzmx.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjZHVrd3djYnlyeWF1aHFsem14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MTY0MDAsImV4cCI6MjA4NTQ5MjQwMH0.rprPmudJYyb6dyhXb9Z9GrtQWEeIX99A2Wrj55PvS54',
        loginPage: 'member-dashboard.html',
        sdkUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
        maxWaitMs: 5000,   // max time to wait for an already-loading SDK
        pollMs: 50
    };

    // --- 1. Hide content immediately (runs before <body> paints) ---------------
    var hideStyle = document.createElement('style');
    hideStyle.id = 'jpg-hide';
    hideStyle.textContent = 'body{visibility:hidden !important}';
    (document.head || document.documentElement).appendChild(hideStyle);

    var settled = false;

    function reveal() {
        if (settled) return;
        settled = true;
        var s = document.getElementById('jpg-hide');
        if (s && s.parentNode) s.parentNode.removeChild(s);
    }

    function redirect() {
        if (settled) return;
        settled = true;
        // Break out of the iframe if somehow loaded there without a session.
        // For a direct standalone open, window.top === window, so this is just
        // a normal same-origin navigation. replace() avoids a history entry so
        // the back button doesn't loop back onto the gated page.
        try {
            window.top.location.replace(CONFIG.loginPage);
        } catch (e) {
            window.location.replace(CONFIG.loginPage);
        }
    }

    function check() {
        var client;
        try {
            client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
        } catch (e) {
            return redirect(); // can't verify -> fail safe
        }
        client.auth.getSession()
            .then(function (res) {
                var session = (res && res.data) ? res.data.session : null;
                if (session && session.user) reveal();
                else redirect();
            })
            .catch(function () { redirect(); });
    }

    function sdkTagPresent() {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].src && scripts[i].src.indexOf('supabase-js') !== -1) return true;
        }
        return false;
    }

    var waited = 0;
    var injected = false;

    function ensureSDKThenCheck() {
        if (window.supabase && window.supabase.createClient) return check();

        if (!injected && !sdkTagPresent()) {
            // Host page doesn't load the SDK — inject it once ourselves.
            injected = true;
            var sc = document.createElement('script');
            sc.src = CONFIG.sdkUrl;
            sc.onload = function () { check(); };
            sc.onerror = function () { redirect(); }; // no SDK -> can't verify -> fail safe
            (document.head || document.documentElement).appendChild(sc);
            return;
        }

        // SDK is loading (host page's tag or our injected tag) — poll until ready.
        if (waited >= CONFIG.maxWaitMs) return; // give up; body stays hidden (fail safe)
        waited += CONFIG.pollMs;
        setTimeout(ensureSDKThenCheck, CONFIG.pollMs);
    }

    ensureSDKThenCheck();
})();
