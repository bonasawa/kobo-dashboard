#!/usr/bin/env python3
"""Récupère le formulaire et les soumissions d'un projet KoboToolbox via l'API v2
et écrit docs/data.json, consommé par le dashboard statique (GitHub Pages).

Variables d'environnement :
  KOBO_TOKEN      token API Kobo (obligatoire)
  KOBO_ASSET_UID  UID du formulaire, ex. aXyZ123... (obligatoire)
  KOBO_SERVER     URL du serveur (défaut : https://kf.kobotoolbox.org)
  KOBO_EXCLUDE    noms de champs à ne pas publier, séparés par des virgules (optionnel)
"""
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


def clean(sub, field_names):
    out = {k: v for k, v in sub.items() if k in KEEP_META}
    for k, v in sub.items():
        if k in field_names:
            out[k] = v
    return out


def main():
    if not TOKEN or not ASSET_UID:
        sys.exit("KOBO_TOKEN et KOBO_ASSET_UID doivent être définis.")
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
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        if old.get("form") == data["form"] and old.get("submissions") == subs:
            print(f"Aucun changement ({len(subs)} soumissions).")
            return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(subs)} soumissions, {len(fields)} champs -> {OUT}")


if __name__ == "__main__":
    main()
