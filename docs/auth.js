// Chargement de data.json, avec déchiffrement si le fichier est protégé par mot de passe.
// Format chiffré (écrit par scripts/fetch_kobo.py) :
//   { encrypted: true, kdf: "PBKDF2-SHA256", iter, salt, iv, ct }  — AES-256-GCM, base64.
// La clé dérivée (jamais le mot de passe) est gardée pour la session, ou sur l'appareil si demandé.
(() => {
  const KEY_STORE = "kobo-dash-key";
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));

  function stored(salt) {
    for (const st of [sessionStorage, localStorage]) {
      try {
        const v = JSON.parse(st.getItem(KEY_STORE) || "null");
        if (v && v.salt === salt) return v.key;
      } catch (e) {}
    }
    return null;
  }
  function store(salt, key, remember) {
    const v = JSON.stringify({ salt, key });
    try { sessionStorage.setItem(KEY_STORE, v); } catch (e) {}
    if (remember) try { localStorage.setItem(KEY_STORE, v); } catch (e) {}
  }
  function forget() {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
  }

  async function deriveRaw(password, d) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64d(d.salt), iterations: d.iter }, base, 256);
  }
  async function decrypt(d, raw) {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(d.iv) }, key, b64d(d.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function prompt(d) {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.id = "auth-overlay";
      ov.innerHTML = `
        <style>
          #auth-overlay { position: fixed; inset: 0; z-index: 1000; background: var(--bg, #f4f3f0); display: grid; place-items: center; padding: 16px; }
          #auth-overlay form { width: 100%; max-width: 360px; background: var(--surface-1, #fff); border: 1px solid var(--border, #ddd); border-radius: 14px; padding: 24px; }
          #auth-overlay h2 { font-size: 18px; margin: 0 0 4px; }
          #auth-overlay p { color: var(--text-secondary, #555); font-size: 13px; margin: 0 0 16px; }
          #auth-overlay input[type=password] { width: 100%; font: inherit; font-size: 14px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border, #ddd); background: var(--bg, #fff); color: var(--text-primary, #000); }
          #auth-overlay label.rem { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text-secondary, #555); margin: 12px 0 16px; }
          #auth-overlay button { width: 100%; font: inherit; font-weight: 600; font-size: 14px; padding: 10px; border: 0; border-radius: 8px; background: var(--accent, #2a78d6); color: #fff; cursor: pointer; }
          #auth-overlay button:disabled { opacity: .6; cursor: wait; }
          #auth-overlay .err { color: var(--critical-ink, #a32424); font-size: 13px; min-height: 18px; margin-top: 10px; }
        </style>
        <form autocomplete="on">
          <h2>🔒 Accès protégé</h2>
          <p>Ce tableau de bord contient des données sanitaires. Saisis le mot de passe communiqué par l'administrateur.</p>
          <input type="text" name="username" value="dashboard" autocomplete="username" hidden>
          <input type="password" name="password" autocomplete="current-password" placeholder="Mot de passe" aria-label="Mot de passe" required autofocus>
          <label class="rem"><input type="checkbox" name="remember"> Rester connecté sur cet appareil</label>
          <button type="submit">Accéder</button>
          <div class="err" role="alert"></div>
        </form>`;
      document.body.appendChild(ov);
      const form = ov.querySelector("form"), btn = form.querySelector("button"), err = form.querySelector(".err");
      form.password.focus();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = "Vérification…"; err.textContent = "";
        try {
          const raw = await deriveRaw(form.password.value, d);
          const data = await decrypt(d, raw);
          store(d.salt, b64e(raw), form.remember.checked);
          ov.remove();
          resolve(data);
        } catch (x) {
          err.textContent = "Mot de passe incorrect.";
          form.password.select();
        } finally {
          btn.disabled = false; btn.textContent = "Accéder";
        }
      });
    });
  }

  function addLogout() {
    const bar = document.querySelector("header .actions, header > div:last-child");
    if (!bar || document.getElementById("logout")) return;
    const b = document.createElement("button");
    b.id = "logout"; b.type = "button"; b.className = "btn"; b.textContent = "Se déconnecter";
    b.addEventListener("click", () => { forget(); location.reload(); });
    bar.appendChild(b);
  }

  window.loadDashboardData = async function () {
    const r = await fetch("data.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (!d.encrypted) return d;
    if (!crypto.subtle) throw new Error("navigateur incompatible (HTTPS requis)");
    addLogout();
    const saved = stored(d.salt);
    if (saved) {
      try { return await decrypt(d, b64d(saved)); } catch (e) { forget(); }
    }
    return prompt(d);
  };
})();
