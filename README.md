# Dashboard KoboToolbox

Dashboard web alimenté automatiquement par un formulaire **KoboToolbox / Kobo Collect** via l'API Kobo v2, hébergé gratuitement sur **GitHub Pages**.

```
Kobo Collect ──► KoboToolbox (API v2) ──► GitHub Actions (toutes les heures) ──► docs/data.json ──► GitHub Pages (dashboard)
```

- Le token Kobo est stocké dans les **Secrets GitHub** : il n'apparaît jamais dans la page publique.
- Le dashboard s'adapte automatiquement aux questions du formulaire :
  - indicateurs clés (total, 7 derniers jours, enquêteurs, dernière soumission)
  - courbe des soumissions par jour
  - carte des points GPS (si le formulaire a un `geopoint`)
  - un graphique par question `select_one` / `select_multiple`
  - statistiques des questions numériques (moyenne, médiane, min, max)
  - tableau filtrable + export CSV
  - filtres par période et par enquêteur, thème clair/sombre

## Configuration (une seule fois)

1. **Secrets du dépôt** : *Settings → Secrets and variables → Actions → New repository secret*
   - `KOBO_TOKEN` : ton token API (KoboToolbox → *Account Settings → Security → API Key*)
   - `KOBO_ASSET_UID` : l'UID du formulaire (dans l'URL du projet : `.../#/forms/<UID>/summary`)
2. *(Optionnel)* **Variables** (onglet *Variables*, même page) :
   - `KOBO_SERVER` : par défaut `https://kf.kobotoolbox.org` (mettre `https://eu.kobotoolbox.org` si besoin)
   - `KOBO_EXCLUDE` : champs à ne jamais publier, séparés par des virgules (ex. `nom,telephone`)
3. **Lancer la première synchro** : *Actions → Mise à jour des données Kobo → Run workflow*.
4. Le dashboard est en ligne sur `https://<utilisateur>.github.io/kobo-dashboard/`.

Ensuite, les nouvelles soumissions apparaissent automatiquement (au plus 1 h de délai). Pour forcer la mise à jour, relance le workflow à la main.

## Tester en local

```bash
export KOBO_TOKEN=... KOBO_ASSET_UID=...
python3 scripts/fetch_kobo.py
cd docs && python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```

> ⚠️ Avec GitHub Pages gratuit, `docs/data.json` est **public**. Utilise `KOBO_EXCLUDE` pour retirer les données personnelles.
