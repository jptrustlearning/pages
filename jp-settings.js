/**
 * jp-settings.js — JP Trust Learning per-user settings sync via Supabase
 *
 * Usage in any dashboard:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="./jp-settings.js"></script>
 *   <script>
 *     // Either pass an existing client...
 *     JPSettings.init({ supabaseClient: myClient });
 *     // ...or let it create one:
 *     JPSettings.init({
 *       url: 'https://rcdukwwcbyryauhqlzmx.supabase.co',
 *       anonKey: 'eyJ...'
 *     });
 *
 *     // After user is authenticated:
 *     const data = await JPSettings.load();        // -> {risk:'medium', ...} or null
 *     await JPSettings.save({risk:'high', ...});   // upsert full object
 *     await JPSettings.patch({risk:'low'});        // merge with existing
 *   </script>
 *
 * Required Supabase SQL (run once):
 *   create table if not exists public.user_settings (
 *     user_id    uuid primary key references auth.users(id) on delete cascade,
 *     data       jsonb not null default '{}'::jsonb,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table public.user_settings enable row level security;
 *   create policy "users see own settings"   on public.user_settings for select using (auth.uid() = user_id);
 *   create policy "users insert own settings" on public.user_settings for insert with check (auth.uid() = user_id);
 *   create policy "users update own settings" on public.user_settings for update using (auth.uid() = user_id);
 */
(function (global) {
    'use strict';

    let _client = null;

    function init(opts) {
        opts = opts || {};
        if (opts.supabaseClient) {
            _client = opts.supabaseClient;
        } else if (opts.url && opts.anonKey) {
            if (!global.supabase || !global.supabase.createClient) {
                console.error('[JPSettings] Supabase SDK not loaded — include @supabase/supabase-js@2 first');
                return null;
            }
            _client = global.supabase.createClient(opts.url, opts.anonKey);
        } else {
            console.error('[JPSettings] init requires either {supabaseClient} or {url, anonKey}');
            return null;
        }
        return _client;
    }

    function client() {
        if (!_client) console.warn('[JPSettings] not initialized — call JPSettings.init(...) first');
        return _client;
    }

    async function getUser() {
        if (!_client) return null;
        try {
            // Resolve the user from the locally persisted session (getSession) instead
            // of getUser(), which makes a network call to /auth/v1/user. Inside a
            // same-origin iframe a freshly-created client's getUser() can return null
            // even when a valid session exists (access-token expiry/refresh timing,
            // Navigator Lock contention), producing false "not logged in" states and
            // silently breaking load()/save(). getSession() reads from storage and is
            // reliable here — this is the same pattern my-portfolio.js already uses.
            // Server-side RLS still enforces auth.uid() = user_id on every query.
            const { data: { session } } = await _client.auth.getSession();
            return (session && session.user) || null;
        } catch (e) {
            console.warn('[JPSettings] getUser error:', e);
            return null;
        }
    }

    async function getEmail() {
        const user = await getUser();
        return user ? user.email : null;
    }

    /** Returns the full settings object stored for the current user, or null if no row exists / not authed. */
    async function load() {
        if (!_client) return null;
        try {
            const user = await getUser();
            if (!user) return null;
            const { data, error } = await _client
                .from('user_settings')
                .select('data')
                .eq('user_id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('[JPSettings] load failed:', error.message);
                return null;
            }
            return data && data.data ? data.data : null;
        } catch (e) {
            console.warn('[JPSettings] load error:', e);
            return null;
        }
    }

    /** Replaces the full settings object for the current user. Returns true on success. */
    async function save(settings) {
        if (!_client) return false;
        try {
            const user = await getUser();
            if (!user) return false;
            const { error } = await _client
                .from('user_settings')
                .upsert(
                    {
                        user_id: user.id,
                        data: settings || {},
                        updated_at: new Date().toISOString()
                    },
                    { onConflict: 'user_id' }
                );
            if (error) {
                console.warn('[JPSettings] save failed:', error.message);
                return false;
            }
            return true;
        } catch (e) {
            console.warn('[JPSettings] save error:', e);
            return false;
        }
    }

    /** Loads current, shallow-merges patch over it, then saves. Use for incremental updates. */
    async function patch(partial) {
        const current = (await load()) || {};
        return save(Object.assign({}, current, partial || {}));
    }

    global.JPSettings = {
        init: init,
        client: client,
        getUser: getUser,
        getEmail: getEmail,
        load: load,
        save: save,
        patch: patch
    };
})(typeof window !== 'undefined' ? window : this);
