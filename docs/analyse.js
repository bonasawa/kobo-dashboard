// Analyse partagée par le tableau de bord (index.html) et le rapport de situation (rapport.js).
// Chaque soumission décrit UNE unité (région, district ou aire de santé) avec des chiffres cumulés
// « à date ». La situation actuelle = dernier rapport de chaque unité.
// Sur la fiche Aire de santé, les données hospitalières, RH et stocks sont saisies par structure
// dans trois tables de répétition (UTC, CTC, salles d'isolement) : elles sont additionnées par aire.
(() => {
  const SEUIL_OMS = 1; // létalité de référence OMS (%)
  const STALE_DAYS = 7;

  const LEVELS = {
    region:   { key: "region",   fiche: "cerple_region", unit: "region",         label: "Régions",        one: "région",        abbr: "Région", cas: "nb_cas_region",   deces: "nb_deces_region",   grp: "fiche_region/",   sfx: "_region" },
    district: { key: "district", fiche: "chef_district", unit: "district_sante", label: "Districts",      one: "district",      abbr: "DS",     cas: "nb_cas_district", deces: "nb_deces_district", grp: "fiche_district/", sfx: "_district" },
    as:       { key: "as",       fiche: "chef_as",       unit: "aire_sante",     label: "Aires de santé", one: "aire de santé", abbr: "AS",     cas: "nb_cas_as",       deces: "nb_deces_as",       grp: "fiche_as/",       sfx: "_as" },
  };
  const STRUCTURES = [["utc", "repeat_utc_as", "UTC"], ["ctc", "repeat_ctc_as", "CTC"], ["salle", "repeat_salle_as", "Salle d'isolement"]];
  const STOCKS = [["ringer", "Ringer Lactate"], ["serum", "Sérum salé 0,9 %"], ["sro", "SRO"], ["chlore", "Chlore"], ["epi", "Kits EPI"]];
  const STATUS = {
    suffisant:    ["good", "✓", "Suffisant"],
    modere:       ["warning", "!", "Modéré"],
    sous_tension: ["serious", "▲", "Sous tension"],
    insuffisant:  ["critical", "✕", "Insuffisant"],
    rupture:      ["critical", "✕", "Rupture"],
  };
  const SEVERITY = [["nb_deshydrat_legere", "Déshydratation légère"], ["nb_deshydrat_moderee", "Déshydratation modérée"], ["nb_deshydrat_severe", "Déshydratation sévère"], ["nb_arrives_decedes", "Arrivés décédés"]];
  const HOSP = ["nb_lits_dispo", "nb_lits_types_cholera", "nb_lits_dedies", "nb_patients_internes", "nb_deces_cholera", "nb_patients_gueris", ...SEVERITY.map(([k]) => k)];
  const RH = [
    ["personnel_medical_dispo", "nb_personnel_medical_dispo", "Personnel médical disponible"],
    ["personnel_medical_dedie", "nb_personnel_medical_dedie", "Personnel médical dédié"],
    ["personnel_parameds_dispo", "nb_personnel_parameds_dispo", "Personnel paramédical disponible"],
    ["personnel_parameds_dedie", "nb_personnel_parameds_dedie", "Personnel paramédical dédié"],
    ["parameds_formes", "nb_parameds_formes", "Paramédicaux formés PEC choléra"],
    ["asc_dispo_fosa", "nb_asc_dispo_fosa", "ASC disponibles en FOSA"],
    ["asc_dedies_fosa", "nb_asc_dedies_fosa", "ASC FOSA dédiés"],
    ["asc_formes_fosa", "nb_asc_formes_fosa", "ASC FOSA formés"],
    ["personnel_wash_dispo", "nb_personnel_wash", "Personnel WASH"],
    ["chimioprophylaxie_asc", "nb_asc_chimioprophylaxie", "Chimioprophylaxie des ASC"],
  ];

  const nf = new Intl.NumberFormat("fr-FR");
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const num = (v) => { if (v == null || v === "") return null; const n = parseFloat(v); return isFinite(n) ? n : null; };
  const sumOrNull = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const sum = (vals) => vals.reduce((a, b) => a + (b || 0), 0);
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtPct = (v) => (v == null ? "—" : nf1.format(v) + " %");
  const list = (arr) => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " et " + arr[arr.length - 1];

  let data = null;
  const fieldByName = {};
  function setData(d) {
    data = d;
    d.form.fields.forEach((f) => { fieldByName[f.name] = f; fieldByName[f.name.split("/").pop()] ??= f; });
  }
  function choiceLabel(name, value) {
    const f = fieldByName[name];
    const c = f && (f.choices || []).find((c) => c.name === value);
    return c ? c.label : (value ?? "");
  }
  function subDate(s) {
    if (s.date_recueil) return new Date(String(s.date_recueil).slice(0, 10) + "T12:00:00Z");
    if (s._submission_time) return new Date(s._submission_time.endsWith("Z") ? s._submission_time : s._submission_time + "Z");
    return null;
  }
  const submitted = (s) => s._submission_time ? new Date(s._submission_time.endsWith("Z") ? s._submission_time : s._submission_time + "Z") : null;
  const sortKey = (s) => `${subDate(s)?.toISOString() || ""}|${s._submission_time || ""}`;
  const levelOf = (s) => Object.keys(LEVELS).find((k) => LEVELS[k].fiche === s.type_fiche);
  const daysAgo = (d) => (d ? Math.floor((Date.now() - d) / 864e5) : null);

  function reportsOf(levelKey, region) {
    return data.submissions
      .filter((s) => levelOf(s) === levelKey && s[LEVELS[levelKey].unit])
      .filter((s) => !region || s.region === region)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }
  function latestByUnit(levelKey, region, until) {
    const L = LEVELS[levelKey], map = new Map();
    reportsOf(levelKey, region).forEach((s) => { if (!until || subDate(s) <= until) map.set(s[L.unit], s); });
    return [...map.values()];
  }

  // ---------- Normalisation d'une fiche ----------
  function sources(s, L) {
    if (L.key !== "as") return [{ type: null, name: null, get: (k) => s[L.grp + k + L.sfx] }];
    return STRUCTURES.flatMap(([sfx, rep, type]) => (s[`fiche_as/${rep}`] || []).map((r, i) => {
      const get = (k) => r[`fiche_as/${rep}/${k}_${sfx}`];
      const filled = Object.keys(r).filter((k) => !k.endsWith(`/nom_${sfx}_rep`) && r[k] !== "" && r[k] != null).length;
      return { type, name: r[`fiche_as/${rep}/nom_${sfx}_rep`] || `${type} ${i + 1}`, get, empty: filled === 0 };
    }));
  }
  function stockOf(src, k) {
    const dispo = src.get(`stock_${k}`) || null;
    return { dispo, etat: src.get(`etat_stock_${k}`) || null, qte: num(src.get(`qte_stock_${k}`)) };
  }
  function stockStatus(st) {
    if (!st || !st.dispo) return null;
    if (st.dispo === "non") return STATUS.rupture;
    return STATUS[st.etat] || ["none", "", "Disponible"];
  }
  const RANK = { critical: 0, serious: 1, warning: 2, good: 3, none: 4 };

  function normalize(s) {
    const lvl = levelOf(s), L = LEVELS[lvl];
    const g = (k) => s[L.grp + k + L.sfx];
    const srcs = sources(s, L).filter((x) => !x.empty);
    const hosp = Object.fromEntries(HOSP.map((k) => [k, sumOrNull(srcs.map((x) => num(x.get(k))))]));
    const rh = Object.fromEntries(RH.map(([f, c]) => {
      const flags = srcs.map((x) => x.get(f)).filter(Boolean);
      return [f, { flag: flags.includes("oui") ? "oui" : flags.length ? "non" : null, n: sumOrNull(srcs.map((x) => num(x.get(c)))) }];
    }));
    const stockRows = srcs.map((x) => ({ label: x.type ? `${x.name} (${x.type})` : null, stocks: Object.fromEntries(STOCKS.map(([k]) => [k, stockOf(x, k)])) }));
    const worstStock = Object.fromEntries(STOCKS.map(([k]) => {
      const sts = stockRows.map((r) => stockStatus(r.stocks[k])).filter(Boolean);
      return [k, sts.sort((a, b) => RANK[a[0]] - RANK[b[0]])[0] || null];
    }));
    const unit = choiceLabel(L.unit, s[L.unit]) || "—";
    const cas = num(s[L.cas]), deces = num(s[L.deces]);
    const declared = L.key === "as" ? Object.fromEntries(STRUCTURES.map(([sfx, rep, type]) => [type, { declared: num(g(`nb_${sfx === "salle" ? "salles_isolement" : sfx}`)), rows: (s[`fiche_as/${rep}`] || []).length, empty: sources(s, L).filter((x) => x.type === type && x.empty).length }])) : null;
    const v = s._validation_status;
    return {
      s, lvl, L, g, srcs, hosp, rh, stockRows, worstStock, declared,
      key: s[L.unit], unit,
      label: L.key === "as" && s.district_sante ? `${unit} (${choiceLabel("district_sante", s.district_sante)})` : unit,
      region: choiceLabel("region", s.region), district: s.district_sante ? choiceLabel("district_sante", s.district_sante) : "",
      date: subDate(s), cas, deces, letalite: cas ? pct(deces || 0, cas) : null,
      letaliteSaisie: L.key === "as" ? null : num(g("taux_letalite_intrahosp")),
      cap: { utc: num(g("nb_utc")), ctc: num(g("nb_ctc")), salles: num(g("nb_salles_isolement")), pro: g("pro_disponibles") || null, nbPro: num(g("nb_pro")) },
      comm: {
        patients: num(g("nb_patients_communaute")), deces: num(g("nb_deces_communaute")), letaliteSaisie: num(g("taux_letalite_communaute")),
        ascDispo: num(g("nb_asc_dispo_communaute")), ascFormes: num(g("nb_asc_formes_communaute")),
        chimioContacts: g("chimio_contacts") || null, proFonct: num(g("nb_pro_fonctionnels_communaute")), proLieux: g("localisation_pro_communaute") || "",
      },
      validated: !!(v && (v.uid === "validation_status_approved")),
      validation: v && v.label ? v.label : null,
    };
  }
  function records(levelKey, region) { return latestByUnit(levelKey, region).map(normalize); }

  // ---------- Indicateurs dérivés ----------
  function severity(r) {
    const vals = SEVERITY.map(([k]) => r.hosp[k]);
    const classes = sumOrNull(vals);
    return { vals, classes, pctSevere: classes ? pct(r.hosp.nb_deshydrat_severe || 0, classes) : null, missing: SEVERITY.filter(([k]) => r.hosp[k] == null).map(([, l]) => l.toLowerCase()) };
  }
  const ivRupture = (r) => r.stockRows.some((row) => row.stocks.ringer.dispo === "non" && row.stocks.serum.dispo === "non");
  const untrained = (r) => r.rh.parameds_formes.flag === "non" || r.rh.asc_formes_fosa.flag === "non";
  function totals(recs) {
    const cas = sum(recs.map((r) => r.cas)), deces = sum(recs.map((r) => r.deces));
    return { cas, deces, letalite: pct(deces, cas), internes: sumOrNull(recs.map((r) => r.hosp.nb_patients_internes)), gueris: sumOrNull(recs.map((r) => r.hosp.nb_patients_gueris)) };
  }

  // ---------- Contrôle qualité (règles du rapport d'analyse exploratoire) ----------
  // sev : "critical" = incohérence, "serious" = à vérifier, "warning" = incomplet
  function qualityChecks(recs) {
    const out = [];
    const add = (r, sev, text, action) => out.push({ site: r ? r.label : "Tous", sev, text, action });
    recs.forEach((r) => {
      const h = r.hosp;
      const decesH = h.nb_deces_cholera ?? r.deces;
      const pec = sumOrNull([h.nb_patients_internes, decesH, h.nb_patients_gueris]);
      if (r.cas != null && pec != null && pec > r.cas)
        add(r, "critical", `Internés + décès + guéris = ${nf.format(pec)} pour ${nf.format(r.cas)} cas déclarés.`, "Vérifier auprès du répondant");
      const sv = severity(r);
      if (r.cas && sv.classes != null && sv.classes !== r.cas)
        add(r, sv.classes > r.cas ? "critical" : "serious",
          `${nf.format(sv.classes)} patients classés par degré de déshydratation pour ${nf.format(r.cas)} cas${sv.missing.length ? ` (${list(sv.missing)} non saisie${sv.missing.length > 1 ? "s" : ""})` : ""}.`,
          sv.classes > r.cas ? "Vérifier les totaux" : "Compléter la classification");
      if (r.L.key !== "as" && r.cas) {
        if (r.letaliteSaisie == null) add(r, "warning", "Taux de létalité intrahospitalière non saisi.", "Remplacer par un champ calculé");
        else if (Math.abs(r.letaliteSaisie - r.letalite) > 0.5)
          add(r, "serious", `Létalité saisie ${fmtPct(r.letaliteSaisie)} ≠ létalité recalculée (décès / cas) ${fmtPct(r.letalite)}.`, "Corriger le calcul");
      }
      if (r.comm.deces != null && r.deces != null && r.comm.deces > r.deces)
        add(r, "critical", `${nf.format(r.comm.deces)} décès communautaires pour ${nf.format(r.deces)} décès au total.`, "Préciser si les décès communautaires sont inclus");
      if (r.comm.letaliteSaisie && !r.comm.patients)
        add(r, "serious", `Létalité communautaire saisie à ${fmtPct(r.comm.letaliteSaisie)} sans patient pris en charge en communauté.`, "Définir le dénominateur");
      else if (r.comm.patients && r.comm.letaliteSaisie != null && Math.abs(r.comm.letaliteSaisie - pct(r.comm.deces || 0, r.comm.patients)) > 0.5)
        add(r, "serious", `Létalité communautaire saisie ${fmtPct(r.comm.letaliteSaisie)} ≠ recalculée ${fmtPct(pct(r.comm.deces || 0, r.comm.patients))}.`, "Corriger le calcul");
      let ouiSansNombre = 0;
      r.stockRows.forEach((row) => STOCKS.forEach(([k]) => { if (row.stocks[k].dispo === "oui" && row.stocks[k].qte == null) ouiSansNombre++; }));
      RH.forEach(([f]) => { if (r.rh[f].flag === "oui" && r.rh[f].n == null) ouiSansNombre++; });
      if (r.cap.pro === "oui" && r.cap.nbPro == null) ouiSansNombre++;
      if (ouiSansNombre >= 3)
        add(r, "warning", `${ouiSansNombre} réponses « Oui » sans quantité ni effectif.`, "Rendre obligatoires les champs « Si oui, nombre »");
      if (r.cap.ctc > 1 && r.cap.ctc === r.cap.salles)
        add(r, "serious", `Même nombre de CTC et de salles d'isolement (${nf.format(r.cap.ctc)}).`, "Clarifier les définitions UTC / CTC / salle");
      const NOMS = { UTC: ["UTC", "UTC", "e"], CTC: ["CTC", "CTC", ""], "Salle d'isolement": ["salle d'isolement", "salles d'isolement", "e"] };
      if (r.declared) Object.entries(r.declared).forEach(([type, d]) => {
        const [sg, pl, fem] = NOMS[type], k = d.declared;
        if (k != null && (d.rows !== k || d.empty))
          add(r, "warning", `${nf.format(k)} ${k > 1 ? pl : sg} déclaré${fem}${k > 1 ? "s" : ""}, ${nf.format(d.rows)} structure${d.rows > 1 ? "s" : ""} saisie${d.rows > 1 ? "s" : ""}${d.empty ? ` dont ${d.empty} vide${d.empty > 1 ? "s" : ""}` : ""}.`, "Compléter les répétitions");
      });
    });
    const nonVal = recs.filter((r) => !r.validated).length;
    if (recs.length && nonVal) add(null, "warning", `${nonVal} fiche${nonVal > 1 ? "s" : ""} sur ${recs.length} sans statut « Approuvé » dans KoboToolbox.`, "Valider avant intégration au SITREP");
    return out.sort((a, b) => RANK[a.sev] - RANK[b.sev]);
  }

  // ---------- Messages clés ----------
  // recs : sites analysés ; base : sites du niveau servant aux totaux (évite les doubles comptes entre niveaux)
  function keyMessages(recs, L, base = recs) {
    const msgs = [];
    if (!recs.length) return msgs;
    const t = totals(base);
    if (base.length) msgs.push({ sev: t.letalite > SEUIL_OMS ? "critical" : "good",
      text: `${nf.format(t.cas)} cas et ${nf.format(t.deces)} décès déclarés dans ${base.length} ${base.length > 1 ? L.label.toLowerCase() : L.one}, soit une létalité de ${fmtPct(t.letalite)}, ${t.letalite > SEUIL_OMS ? "au-dessus" : "en dessous"} du seuil OMS de ${SEUIL_OMS} %.` });
    const high = recs.filter((r) => r.letalite > SEUIL_OMS).sort((a, b) => b.letalite - a.letalite);
    if (high.length) msgs.push({ sev: high[0].letalite >= 5 ? "critical" : "serious",
      text: `Létalité au-dessus de ${SEUIL_OMS} % : ${list(high.map((r) => `${r.unit} (${fmtPct(r.letalite)})`))}.${high[0].letalite >= 5 ? ` ${high[0].unit} est un signal d'alerte à confirmer immédiatement.` : ""}` });
    const iv = recs.filter(ivRupture);
    if (iv.length) {
      const sev = sum(iv.map((r) => r.hosp.nb_deshydrat_severe));
      msgs.push({ sev: "critical", text: `Rupture d'intrants IV (ni Ringer Lactate ni sérum salé) : ${list(iv.map((r) => r.unit))}${sev ? `, ${iv.length > 1 ? "qui cumulent" : "avec"} ${nf.format(sev)} patient${sev > 1 ? "s" : ""} arrivé${sev > 1 ? "s" : ""} en déshydratation sévère` : ""}.` });
    }
    const otherStock = recs.filter((r) => ["sro", "chlore", "epi"].some((k) => r.worstStock[k]?.[0] === "critical"));
    if (otherStock.length) msgs.push({ sev: "serious", text: `SRO, chlore ou kits EPI en rupture ou insuffisants : ${list(otherStock.map((r) => r.unit))}.` });
    const untr = recs.filter(untrained);
    if (untr.length) msgs.push({ sev: "serious", text: `Personnel paramédical ou ASC non formé à la PEC du choléra : ${list(untr.map((r) => r.unit))}.` });
    const noChimio = recs.filter((r) => r.comm.chimioContacts === "non");
    if (noChimio.length) msgs.push({ sev: "serious", text: `Chimioprophylaxie des contacts non faite : ${list(noChimio.map((r) => r.unit))}.` });
    const commDeaths = recs.filter((r) => r.comm.deces > 0 && !r.comm.patients);
    if (commDeaths.length) msgs.push({ sev: "serious", text: `Décès communautaires sans prise en charge communautaire : ${list(commDeaths.map((r) => `${r.unit} (${nf.format(r.comm.deces)})`))}.` });
    const q = qualityChecks(recs).filter((x) => x.sev !== "warning" || x.site !== "Tous");
    if (q.length) msgs.push({ sev: "warning", text: `${q.length} anomalie${q.length > 1 ? "s" : ""} de qualité des données détectée${q.length > 1 ? "s" : ""} (${q.filter((x) => x.sev === "critical").length} incohérence${q.filter((x) => x.sev === "critical").length > 1 ? "s" : ""}).` });
    return msgs;
  }

  // ---------- Commentaires automatiques (rapport) ----------
  function comments(recs, L, base = recs) {
    const c = {};
    const t = totals(base);
    const byCas = base.filter((r) => r.cas).sort((a, b) => b.cas - a.cas);
    if (byCas.length) {
      const top = byCas.slice(0, 2).map((r) => `${r.unit} (${nf1.format(pct(r.cas, t.cas))} % des cas)`);
      const parts = [`La charge de cas est concentrée à ${list(top)}.`];
      const worst = recs.filter((r) => r.letalite != null).sort((a, b) => b.letalite - a.letalite)[0];
      if (worst && worst.letalite > SEUIL_OMS) parts.push(`${worst.unit} enregistre la létalité la plus élevée (${fmtPct(worst.letalite)}).`);
      const ref = byCas.filter((r) => r.letalite != null && r.letalite <= SEUIL_OMS && r.cas >= Math.max(50, t.cas * 0.2));
      if (ref.length) parts.push(`${list(ref.map((r) => r.unit))} maintien${ref.length > 1 ? "nent" : "t"} une létalité sous ${SEUIL_OMS} % malgré un volume important : site${ref.length > 1 ? "s" : ""} de référence potentiel${ref.length > 1 ? "s" : ""} pour les pratiques de PEC.`);
      const alert = recs.filter((r) => r.letalite >= 5);
      if (alert.length) parts.push(`La létalité de ${list(alert.map((r) => `${r.unit} (${fmtPct(r.letalite)})`))} est très préoccupante et doit être confirmée avant toute diffusion.`);
      c.epi = parts.join(" ");
    }
    const sv = recs.map((r) => ({ r, s: severity(r) })).filter((x) => x.s.classes);
    if (sv.length) {
      const late = sv.filter((x) => x.s.pctSevere > 50), early = sv.filter((x) => x.s.classes && pct(x.r.hosp.nb_deshydrat_legere || 0, x.s.classes) > 50);
      const parts = [];
      if (early.length) parts.push(`À ${list(early.map((x) => x.r.unit))}, les patients arrivent majoritairement en déshydratation légère, ce qui suggère un recours précoce aux soins.`);
      if (late.length) parts.push(`À ${list(late.map((x) => `${x.r.unit} (${nf1.format(x.s.pctSevere)} % de sévères)`))}, plus de la moitié des patients arrivent en déshydratation sévère : signe d'un recours tardif ou d'une surclassification, à vérifier avec l'équipe clinique.`);
      if (!parts.length) parts.push("Les profils de gravité à l'admission ne montrent pas de prédominance des formes sévères.");
      c.gravite = parts.join(" ");
    }
    {
      const parts = [];
      const same = recs.filter((r) => r.cap.ctc > 1 && r.cap.ctc === r.cap.salles);
      if (same.length) parts.push(`${list(same.map((r) => r.unit))} déclare${same.length > 1 ? "nt" : ""} autant de CTC que de salles d'isolement, ce qui évoque une confusion entre catégories.`);
      const lt = recs.filter((r) => r.cas >= 100 && r.hosp.nb_lits_types_cholera != null && r.cas / Math.max(r.hosp.nb_lits_types_cholera, 1) > 100);
      if (lt.length) parts.push(`Le nombre de lits-types de choléra est très faible au regard des cas à ${list(lt.map((r) => `${r.unit} (${nf.format(r.hosp.nb_lits_types_cholera)} pour ${nf.format(r.cas)} cas)`))} : la notion de « lit-type » n'est probablement pas comprise de manière uniforme.`);
      const sat = recs.filter((r) => r.hosp.nb_lits_dedies && r.hosp.nb_patients_internes / r.hosp.nb_lits_dedies >= 0.8);
      if (sat.length) parts.push(`Occupation des lits dédiés en tension (≥ 80 %) : ${list(sat.map((r) => `${r.unit} (${nf.format(r.hosp.nb_patients_internes)} internés / ${nf.format(r.hosp.nb_lits_dedies)} lits)`))}.`);
      c.capacites = parts.join(" ") || "Les capacités déclarées ne présentent pas d'incohérence manifeste.";
    }
    {
      const parts = [];
      const iv = recs.filter(ivRupture);
      if (iv.length) {
        const sev = sum(iv.map((r) => r.hosp.nb_deshydrat_severe));
        parts.push(`C'est le constat le plus critique : ${list(iv.map((r) => r.unit))} n'${iv.length > 1 ? "ont" : "a"} ni Ringer Lactate ni sérum salé${sev ? ` alors que ${nf.format(sev)} patients sont arrivés en déshydratation sévère, pour qui la réhydratation intraveineuse est vitale` : ""}.`);
      }
      STOCKS.filter(([k]) => !["ringer", "serum"].includes(k)).forEach(([k, l]) => {
        const rup = recs.filter((r) => r.worstStock[k]?.[2] === "Rupture");
        if (rup.length) parts.push(`${l} en rupture : ${list(rup.map((r) => r.unit))}.`);
      });
      const noQty = recs.filter((r) => r.stockRows.some((row) => STOCKS.filter(([k]) => row.stocks[k].dispo === "oui" && row.stocks[k].qte == null).length >= 3));
      if (noQty.length) parts.push(`${list(noQty.map((r) => r.unit))} déclare${noQty.length > 1 ? "nt" : ""} des intrants disponibles sans quantité, ce qui empêche toute planification du réapprovisionnement.`);
      c.intrants = parts.join(" ") || "Aucune rupture d'intrant n'est déclarée.";
    }
    {
      const parts = [];
      const untr = recs.filter(untrained);
      if (untr.length) parts.push(`À ${list(untr.map((r) => r.unit))}, le personnel paramédical ou les ASC ne sont pas formés à la PEC du choléra : cible${untr.length > 1 ? "s" : ""} prioritaire${untr.length > 1 ? "s" : ""} de formation rapide.`);
      const noWash = recs.filter((r) => r.rh.personnel_wash_dispo.flag === "non");
      if (noWash.length) parts.push(`Aucun personnel WASH déclaré à ${list(noWash.map((r) => r.unit))}.`);
      const notDed = recs.filter((r) => r.rh.personnel_medical_dedie.flag === "non" && r.rh.personnel_parameds_dedie.flag === "non");
      if (notDed.length) parts.push(`Le personnel n'est pas dédié au choléra à ${list(notDed.map((r) => r.unit))}.`);
      const inv = recs.filter((r) => r.rh.personnel_medical_dispo.n > 0 && r.rh.personnel_parameds_dispo.n != null && r.rh.personnel_medical_dispo.n > r.rh.personnel_parameds_dispo.n * 2);
      if (inv.length) parts.push(`Le rapport médical / paramédical est inhabituel à ${list(inv.map((r) => `${r.unit} (${nf.format(r.rh.personnel_medical_dispo.n)} contre ${nf.format(r.rh.personnel_parameds_dispo.n)})`))} : possible inversion des deux champs.`);
      c.rh = parts.join(" ") || "Les ressources humaines déclarées ne montrent pas de déficit majeur.";
    }
    {
      const parts = [];
      const cd = recs.filter((r) => r.comm.deces > 0 && !r.comm.patients && !r.comm.proFonct);
      if (cd.length) parts.push(`${cd.length} site${cd.length > 1 ? "s" : ""} sur ${recs.length} enregistre${cd.length > 1 ? "nt" : ""} des décès communautaires sans prise en charge communautaire ni PRO fonctionnel (${list(cd.map((r) => r.unit))}). Ces décès hors structure traduisent un accès tardif aux soins et justifient le déploiement de PRO.`);
      const nf_ = recs.filter((r) => r.comm.ascDispo > 0 && r.comm.ascFormes === 0);
      if (nf_.length) parts.push(`Les ASC communautaires ne sont pas formés à ${list(nf_.map((r) => `${r.unit} (${nf.format(r.comm.ascDispo)})`))}.`);
      const nc = recs.filter((r) => r.comm.chimioContacts === "non");
      if (nc.length) parts.push(`La chimioprophylaxie des contacts n'est pas faite à ${list(nc.map((r) => r.unit))}.`);
      c.communaute = parts.join(" ") || "Le volet communautaire ne présente pas d'alerte particulière.";
    }
    return c;
  }

  function recommendations(recs) {
    const riposte = [], si = [];
    const iv = recs.filter(ivRupture);
    const otherRup = recs.filter((r) => !ivRupture(r) && STOCKS.some(([k]) => r.worstStock[k]?.[0] === "critical"));
    if (iv.length || otherRup.length) riposte.push(`Approvisionner en urgence ${list([...iv, ...otherRup].map((r) => r.unit))} en ${iv.length ? "Ringer Lactate, sérum salé 0,9 %, " : ""}SRO et chlore.`);
    const untr = recs.filter(untrained);
    if (untr.length) riposte.push(`Former rapidement les paramédicaux et ASC de ${list(untr.map((r) => r.unit))} à la PEC du choléra.`);
    const alert = recs.filter((r) => r.letalite >= 5);
    if (alert.length) riposte.push(`Mener une investigation à ${list(alert.map((r) => r.unit))} pour confirmer les chiffres et comprendre la létalité élevée.`);
    const comm = recs.filter((r) => (r.comm.deces > 0 && !r.comm.patients && !r.comm.proFonct) || r.comm.chimioContacts === "non");
    if (comm.length) riposte.push(`Déployer des PRO et étendre la chimioprophylaxie des contacts à ${list(comm.map((r) => r.unit))}.`);
    const q = qualityChecks(recs);
    if (q.some((x) => /létalité/i.test(x.text))) si.push("Remplacer les taux de létalité saisis par des champs calculés dans le XLSForm.");
    if (q.some((x) => x.sev === "critical" || /classés/.test(x.text))) si.push("Ajouter des contraintes de cohérence (internés + décès + guéris ≤ cas ; somme des degrés de déshydratation = cas).");
    if (q.some((x) => /sans quantité/.test(x.text))) si.push("Rendre obligatoires les champs quantitatifs « Si oui, nombre ».");
    if (q.some((x) => /CTC|décès communautaires/.test(x.text))) si.push("Préciser dans les consignes les définitions d'UTC, CTC, salle d'isolement et lit-type, ainsi que l'inclusion des décès communautaires dans le total.");
    if (q.some((x) => /Approuvé/.test(x.text))) si.push("Valider chaque soumission (statut de validation KoboToolbox) avant intégration au SITREP.");
    return { riposte, si };
  }

  window.PEC = {
    SEUIL_OMS, STALE_DAYS, LEVELS, STRUCTURES, STOCKS, STATUS, SEVERITY, RH, RANK,
    nf, nf1, num, sum, pct, esc, fmtPct, list, daysAgo, subDate, submitted, levelOf,
    setData, get data() { return data; }, choiceLabel, reportsOf, latestByUnit, records,
    stockStatus, severity, ivRupture, totals, qualityChecks, keyMessages, comments, recommendations,
  };
})();
