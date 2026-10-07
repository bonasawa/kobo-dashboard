#!/usr/bin/env python3
"""Récupère le formulaire et les soumissions d'un projet KoboToolbox via l'API v2
et écrit docs/data.json, consommé par le dashboard statique (GitHub Pages).

Variables d'environnement :
  KOBO_TOKEN      token API Kobo (obligatoire)
  KOBO_ASSET_UID  UID du formulaire, ex. aXyZ123... (obligatoire)
  KOBO_SERVER     URL du serveur (défaut : https://kf.kobotoolbox.org)
  KOBO_EXCLUDE    noms de champs à ne pas publier, séparés par des virgules (défaut : nom_repondant)
  DASHBOARD_PASSWORD  mot de passe du dashboard : data.json est chiffré (AES-256-GCM,
                      clé dérivée par PBKDF2-SHA256) et déchiffré dans le navigateur
  ALLOW_PUBLIC    "true" pour publier data.json en clair sans mot de passe (déconseillé)
"""
import base64
import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVER = os.environ.get("KOBO_SERVER", "https://kf.kobotoolbox.org").rstrip("/")
TOKEN = os.environ.get("KOBO_TOKEN", "").strip()
ASSET_UID = os.environ.get("KOBO_ASSET_UID", "").strip()
EXCLUDE = {f.strip() for f in os.environ.get("KOBO_EXCLUDE", "nom_repondant").split(",") if f.strip()}
PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
ALLOW_PUBLIC = os.environ.get("ALLOW_PUBLIC", "").strip().lower() == "true"
PBKDF2_ITER = 600_000
OUT = Path(__file__).resolve().parent.parent / "docs" / "data.json"

# Métadonnées Kobo conservées dans data.json (le reste est retiré)
KEEP_META = {"_id", "_submission_time", "_submitted_by", "_geolocation", "_validation_status"}
SKIP_TYPES = {"begin_group", "end_group", "begin_repeat", "end_repeat", "note",
              "start", "end", "today", "deviceid", "username", "calculate", "audit"}


def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Token {TOKEN}",
                                               "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def first_label(label, fallback):
    if isinstance(label, list):
        label = next((l for l in label if l), None)
    return label or fallback


def parse_form(asset):
    content = asset.get("content", {})
    choices = {}
    for c in content.get("choices", []):
        choices.setdefault(c["list_name"], []).append(
            {"name": c.get("name") or c.get("$autoname"),
             "label": first_label(c.get("label"), c.get("name"))})

    fields, groups = [], []
    for row in content.get("survey", []):
        t = row.get("type", "")
        name = row.get("name") or row.get("$autoname")
        if t in ("begin_group", "begin_repeat"):
            groups.append(name)
            continue
        if t in ("end_group", "end_repeat"):
            if groups:
                groups.pop()
            continue
        if t in SKIP_TYPES or not name or name in EXCLUDE:
            continue
        base = t.split(" ")[0]
        xpath = row.get("$xpath") or "/".join(groups + [name])
        field = {"name": xpath, "label": first_label(row.get("label"), name), "type": base}
        if base in ("select_one", "select_multiple"):
            list_name = row.get("select_from_list_name") or (t.split(" ")[1] if " " in t else None)
            field["choices"] = choices.get(list_name, [])
        fields.append(field)
    return fields


def fetch_submissions():
    url = f"{SERVER}/api/v2/assets/{ASSET_UID}/data/?format=json&limit=1000"
    results = []
    while url:
        page = get(url)
        results.extend(page.get("results", []))
        url = page.get("next")
    return results


def derive_key(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITER, 32)


def encrypt(obj, key, salt):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    plain = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"encrypted": True, "v": 1, "kdf": "PBKDF2-SHA256", "iter": PBKDF2_ITER,
            "salt": b64(salt), "iv": b64(iv), "ct": b64(AESGCM(key).encrypt(iv, plain, None))}


def read_existing():
    """Renvoie (contenu en clair de l'ancien data.json ou None, sel réutilisable ou None)."""
    if not OUT.exists():
        return None, None
    old = json.loads(OUT.read_text(encoding="utf-8"))
    if not old.get("encrypted"):
        return old, None
    if not PASSWORD or old.get("iter") != PBKDF2_ITER:
        return None, None
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt = base64.b64decode(old["salt"])
    try:
        plain = AESGCM(derive_key(PASSWORD, salt)).decrypt(
            base64.b64decode(old["iv"]), base64.b64decode(old["ct"]), None)
    except Exception:
        return None, None  # mot de passe changé : nouveau sel
    return json.loads(plain), salt


def clean(sub, field_names):
    out = {k: v for k, v in sub.items() if k in KEEP_META}
    for k, v in sub.items():
        if k in field_names:
            out[k] = v
    return out


def main():
    if not TOKEN or not ASSET_UID:
        sys.exit("KOBO_TOKEN et KOBO_ASSET_UID doivent être définis.")
    if not PASSWORD and not ALLOW_PUBLIC:
        sys.exit("DASHBOARD_PASSWORD n'est pas défini : refus de publier les données en clair. "
                 "Ajoute le secret DASHBOARD_PASSWORD (ou ALLOW_PUBLIC=true pour publier sans protection).")
    asset = get(f"{SERVER}/api/v2/assets/{ASSET_UID}/?format=json")
    fields = parse_form(asset)
    names = {f["name"] for f in fields}
    subs = [clean(s, names) for s in fetch_submissions()]
    subs.sort(key=lambda s: s.get("_submission_time", ""))

    data = {
        "form": {"name": asset.get("name", "Formulaire Kobo"), "uid": ASSET_UID, "fields": fields},
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(subs),
        "submissions": subs,
    }
    # Évite un commit toutes les heures quand rien n'a changé
    old, salt = read_existing()
    if old and old.get("form") == data["form"] and old.get("submissions") == subs \
            and bool(PASSWORD) == bool(salt):
        print(f"Aucun changement ({len(subs)} soumissions).")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if PASSWORD:
        salt = salt or os.urandom(16)
        payload = encrypt(data, derive_key(PASSWORD, salt), salt)
        OUT.write_text(json.dumps(payload), encoding="utf-8")
    else:
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(subs)} soumissions, {len(fields)} champs -> {OUT}"
          f" ({'chiffré' if PASSWORD else 'EN CLAIR'})")


if __name__ == "__main__":
    main()
