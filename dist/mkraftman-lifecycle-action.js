/* mkraftman-lifecycle-action
 * ---------------------------------------------------------------------------
 * Invisible Lovelace card. Drives device launch/teardown from a VIEW's
 * lifecycle so that dashboard taps only ever need to perform a native
 * `navigate` (one action, per-browser, no browser_mod, no registration).
 *
 *  - On the view becoming active (arrival, or launch-args in the URL changing)
 *      -> optionally raise an overlay input_boolean, then call `launch` with
 *         { ...defaults, ...harvested URL args }.
 *  - On navigating AWAY from the view
 *      -> call `teardown` with `teardown_data` (static object, default {}).
 *
 * Dedupe is MODULE-LEVEL (window.__mlaLifecycleState), keyed by view, so it
 * survives HA destroying and recreating the card element during a page load.
 * Teardown is navigation-guarded: it fires only when the card unmounts (or a
 * location change is observed) AND the current URL is no longer this view, so
 * cold-load remount churn does NOT trigger it.
 *
 * If `launch` (and/or `teardown`) is omitted the card runs in LOG-ONLY mode:
 * it logs what it WOULD call. Use that + `debug: true` to validate timing
 * before wiring real scripts.
 *
 * Config:
 *   launch:        service to call on activate, e.g. script.launch_apple_tv_app
 *   teardown:      service to call on leave,    e.g. script.pause_and_close_apple_tv
 *   teardown_data: static data object for the teardown call (default {})
 *   defaults:      static data merged UNDER harvested URL args for launch
 *   param_prefix:  which query keys become launch args (default "arg_")
 *   overlay:       input_boolean turned ON at activate (script still turns OFF)
 *   view_path:     this view's path; used to decide "am I the active view"
 *   debug:         verbose console logging
 * ---------------------------------------------------------------------------
 */

const MLA_VERSION = "0.3.0";

console.info(
  "%c mkraftman-lifecycle-action %c v" + MLA_VERSION + " ",
  "color:white;background:#3b78e7;font-weight:700;border-radius:3px 0 0 3px;padding:2px 4px;",
  "color:#3b78e7;background:white;font-weight:700;border-radius:0 3px 3px 0;padding:2px 4px;"
);

// Module-level dedupe store, keyed by view identity. Persists across element
// mount/unmount within a single page session. { [key]: { launched: <sig|null> } }
const MLA_STATE = (window.__mlaLifecycleState = window.__mlaLifecycleState || {});

class MkraftmanLifecycleAction extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("mkraftman-lifecycle-action: invalid configuration");
    this._config = {
      param_prefix: "arg_",
      debug: false,
      ...config,
    };
    this._didInit = false;
    this.style.display = "none"; // invisible: occupies no visual space
  }

  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && !this._didInit) this._evaluate("hass-ready");
  }

  connectedCallback() {
    this._onLoc = () => this._evaluate("location-changed");
    window.addEventListener("location-changed", this._onLoc);
    window.addEventListener("popstate", this._onLoc);
    this._evaluate("connected");
  }

  disconnectedCallback() {
    if (this._onLoc) {
      window.removeEventListener("location-changed", this._onLoc);
      window.removeEventListener("popstate", this._onLoc);
    }
    // Only tear down on a REAL navigation away: URL no longer this view.
    if (this._config && !this._onThisView()) {
      const st = this._state();
      if (st.launched !== null) {
        this._log("disconnected off-view -> teardown");
        this._fireTeardown("disconnected");
        st.launched = null;
      }
    }
  }

  _log(...args) {
    if (this._config && this._config.debug) console.log("[lifecycle-action]", ...args);
  }

  _key() {
    return this._config.view_path || this._config.launch || "default";
  }

  _state() {
    const k = this._key();
    return (MLA_STATE[k] = MLA_STATE[k] || { launched: null });
  }

  _onThisView() {
    const vp = this._config.view_path;
    if (!vp) return true;
    const path = window.location.pathname.replace(/\/+$/, "");
    return path === "/" + vp || path.endsWith("/" + vp);
  }

  _harvestArgs() {
    const out = { ...(this._config.defaults || {}) };
    const prefix = this._config.param_prefix || "";
    const qs = new URLSearchParams(window.location.search);
    for (const [k, v] of qs.entries()) {
      if (prefix) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  _sig() {
    return window.location.pathname + window.location.search;
  }

  _evaluate(reason) {
    if (!this._hass || !this._config) return;
    this._didInit = true;
    const st = this._state();

    if (!this._onThisView()) {
      if (st.launched !== null) {
        this._log("leaving view (" + reason + ") -> teardown");
        this._fireTeardown(reason);
        st.launched = null;
      }
      return;
    }

    const sig = this._sig();
    if (st.launched === sig) {
      this._log("evaluate (" + reason + "): already active for this URL, skip");
      return;
    }
    st.launched = sig;
    const args = this._harvestArgs();
    this._log("ACTIVATE (" + reason + ")", args);

    if (this._config.overlay) {
      const od = this._config.overlay.split(".")[0];
      this._hass.callService(od, "turn_on", { entity_id: this._config.overlay });
    }
    this._fireLaunch(args);
  }

  _fireLaunch(args) {
    if (!this._config.launch) {
      this._log("LOG-ONLY: would LAUNCH with", args);
      return;
    }
    const dot = this._config.launch.indexOf(".");
    const d = this._config.launch.slice(0, dot);
    const s = this._config.launch.slice(dot + 1);
    this._log("callService " + d + "." + s, args);
    this._hass.callService(d, s, args);
  }

  _fireTeardown(reason) {
    const data = this._config.teardown_data || {};
    if (!this._config.teardown) {
      this._log("LOG-ONLY: would TEARDOWN (" + reason + ")", data);
      return;
    }
    const dot = this._config.teardown.indexOf(".");
    const d = this._config.teardown.slice(0, dot);
    const s = this._config.teardown.slice(dot + 1);
    this._log("callService " + d + "." + s + " (teardown, " + reason + ")", data);
    this._hass.callService(d, s, data);
  }

  getCardSize() {
    return 1;
  }

  static getStubConfig() {
    return { view_path: "device", debug: true };
  }
}

customElements.define("mkraftman-lifecycle-action", MkraftmanLifecycleAction);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "mkraftman-lifecycle-action",
  name: "Mkraftman Lifecycle Action",
  description: "Invisible card: fires launch/teardown services on view enter/leave.",
});
