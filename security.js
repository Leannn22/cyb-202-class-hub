/* Browser-side safety helpers. Password verification and RBAC are enforced by server.js. */
(function (root) {
  "use strict";

  const ADMIN_IDS = Object.freeze({
    leander: "Leander Dwayne Darell S. Guina",
    representative: "Class Representative",
    vicePresident: "Class Vice President"
  });
  let session = { authenticated:false, adminId:null, adminName:null, csrfToken:"" };
  let storageAvailable = true;
  const loginLimitKey = "cyb202.login-attempts";

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }

  function sanitizeHTML(value) {
    const purifier = root.DOMPurify;
    if (!purifier) throw new Error("DOMPurify did not load; refusing to render untrusted HTML.");
    return purifier.sanitize(String(value ?? ""), {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      KEEP_CONTENT: true
    });
  }

  function safeExternalURL(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), root.location.href);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function securityEvent(reason) {
    root.dispatchEvent(new CustomEvent("cyb202:security-event", { detail:{ reason:String(reason) } }));
    console.warn(`[CYB-202 security] ${reason}`);
  }

  function readLoginAttempts() {
    try {
      const parsed = JSON.parse(root.sessionStorage.getItem(loginLimitKey) || '{"count":0,"lockedUntil":0}');
      return {
        count:Number.isInteger(parsed.count) && parsed.count >= 0 ? parsed.count : 0,
        lockedUntil:Number.isFinite(parsed.lockedUntil) ? parsed.lockedUntil : 0
      };
    } catch (error) {
      storageAvailable = false;
      securityEvent("Login rate-limit state could not be read.");
      return { count:0, lockedUntil:0 };
    }
  }

  function loginLockRemaining() {
    if (!storageAvailable) return Number.POSITIVE_INFINITY;
    const record = readLoginAttempts();
    const remaining = record.lockedUntil - Date.now();
    if (remaining <= 0 && record.lockedUntil) {
      root.sessionStorage.removeItem(loginLimitKey);
      return 0;
    }
    return Math.max(0, remaining);
  }

  function recordFailedLogin() {
    if (!storageAvailable) throw new Error("Session storage is required to enforce the login lockout.");
    const record = readLoginAttempts();
    const count = record.count + 1;
    const lockedUntil = count >= 3 ? Date.now() + 60_000 : 0;
    try {
      root.sessionStorage.setItem(loginLimitKey, JSON.stringify({ count, lockedUntil }));
    } catch (error) {
      storageAvailable = false;
      securityEvent("Login attempts could not be stored; login is disabled for this tab.");
      throw new Error("Browser session storage is unavailable. Enable it before signing in.");
    }
    if (lockedUntil) securityEvent("Three failed login attempts; this browser is locked for 60 seconds.");
    return { count, lockedUntil };
  }

  function clearFailedLogins() {
    try { root.sessionStorage.removeItem(loginLimitKey); }
    catch (error) { storageAvailable = false; securityEvent("Login rate-limit state could not be cleared."); }
  }

  async function request(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      if (!session.csrfToken) await refreshSession();
      headers.set("X-CSRF-Token", session.csrfToken);
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials:"same-origin",
      cache:"no-store",
      redirect:"error"
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(payload?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      if (response.status === 401) session.authenticated = false;
      if (response.status === 403) securityEvent("A protected action was rejected by the server.");
      throw error;
    }
    return payload;
  }

  async function refreshSession() {
    const result = await request("/api/session", { method:"GET" });
    session = {
      authenticated:!!result.authenticated,
      adminId:result.adminId || null,
      adminName:result.adminName || null,
      csrfToken:String(result.csrfToken || "")
    };
    return { ...session };
  }

  async function login(adminId, password) {
    const remaining = loginLockRemaining();
    if (!storageAvailable) throw new Error("Browser session storage is unavailable. Enable it before signing in.");
    if (remaining > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
    if (!Object.hasOwn(ADMIN_IDS, adminId)) {
      recordFailedLogin();
      throw new Error("Select an authorized admin profile.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      recordFailedLogin();
      throw new Error("Enter the admin passphrase.");
    }
    try {
      const result = await request("/api/login", {
        method:"POST",
        body:JSON.stringify({ adminId, password })
      });
      session = {
        authenticated:true,
        adminId:result.adminId,
        adminName:result.adminName,
        csrfToken:result.csrfToken
      };
      clearFailedLogins();
      return { ...session };
    } catch (error) {
      if (error.status === 401 || error.status === 429) {
        const record = recordFailedLogin();
        if (record.lockedUntil > Date.now()) throw new Error("Three attempts reached. Login is locked for 60 seconds.");
      }
      throw error;
    }
  }

  async function logout() {
    try {
      await request("/api/logout", { method:"POST", body:"{}" });
    } finally {
      session = { authenticated:false, adminId:null, adminName:null, csrfToken:"" };
    }
  }

  function isAdminAuthenticated() {
    return session.authenticated === true && typeof session.csrfToken === "string" && session.csrfToken.length >= 32;
  }

  function requireAdmin(operation) {
    if (isAdminAuthenticated()) return true;
    securityEvent(`Unauthorized client-side attempt to ${operation}.`);
    return false;
  }

  function validateClassState(state) {
    const fail = message => { throw new Error(`Invalid class state: ${message}`); };
    if (!state || typeof state !== "object" || Array.isArray(state)) fail("expected an object.");
    if (state.schemaVersion !== 1) fail("unsupported schema version.");
    const arrays = ["schedule", "subjects", "reminders", "reviews", "cheatSheets", "scheduleOverrides"];
    const allowedKeys = new Set(["schemaVersion", ...arrays, "emergencyBanner"]);
    if (Object.keys(state).some(key=>!allowedKeys.has(key))) fail("contains unsupported top-level fields.");
    for (const key of arrays) if (!Array.isArray(state[key])) fail(`${key} must be an array.`);
    if (!state.emergencyBanner || typeof state.emergencyBanner !== "object" || Array.isArray(state.emergencyBanner)) fail("emergencyBanner must be an object.");
    const limits = { schedule:300, subjects:50, reminders:1000, reviews:100, cheatSheets:300, scheduleOverrides:1000 };
    for (const key of arrays) {
      if (state[key].length > limits[key]) fail(`${key} exceeds the item limit.`);
      const ids = new Set();
      for (const item of state[key]) {
        if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${key} contains an invalid item.`);
        if (typeof item.id !== "string" || !item.id || item.id.length > 100) fail(`${key} item has an invalid id.`);
        if (ids.has(item.id)) fail(`${key} has a duplicate id.`);
        ids.add(item.id);
        for (const [field, value] of Object.entries(item)) {
          if (typeof value === "string" && value.length > 20_000) fail(`${key}.${field} is too long.`);
        }
      }
    }
    for (const key of ["title", "message"]) {
      if (state.emergencyBanner[key] != null && typeof state.emergencyBanner[key] !== "string") fail(`emergencyBanner.${key} must be text.`);
      if (typeof state.emergencyBanner[key] === "string" && state.emergencyBanner[key].length > 2000) fail(`emergencyBanner.${key} is too long.`);
    }
    if (state.emergencyBanner.active != null && typeof state.emergencyBanner.active !== "boolean") fail("emergencyBanner.active must be boolean.");
    return state;
  }

  root.Security = Object.freeze({
    ADMIN_IDS,
    escapeHTML,
    sanitizeHTML,
    safeExternalURL,
    securityEvent,
    loginLockRemaining,
    refreshSession,
    login,
    logout,
    isAdminAuthenticated,
    requireAdmin,
    validateClassState,
    request,
    getSession:() => ({ ...session })
  });
})(window);
