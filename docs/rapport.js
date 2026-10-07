// Rapport de situation généré dans le navigateur à partir des données déchiffrées.
// Aucune donnée n'est envoyée ailleurs : le rapport s'ouvre dans un nouvel onglet, les commentaires
// sont modifiables, puis on l'imprime (PDF) ou on le télécharge au format Word.
(() => {
  // En-tête institutionnel du rapport (modifiable aussi directement dans le rapport généré)
  const ENTETE = ["RÉPUBLIQUE DU CAMEROUN — MINISTÈRE DE LA SANTÉ PUBLIQUE", "Centre de Coordination des Opérations d'Urgence de Santé Publique (CCOUSP)"];
  const C = { blue: "#2a78d6", orange: "#eb6834", critical: "#d03b3b", text: "#222", muted: "#666", grid: "#e6e6e6", sev: ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"] };

  const P = () => window.PEC;
  const fr = (d, o) => d ? d.toLocaleDateString("fr-FR", o || { day: "numeric", month: "long", year: "numeric" }) : "—";
  const frT = (d) => d ? d.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).replace(":", "h") : "—";

  // ---------- Figures (Chart.js hors écran → PNG) ----------
  function chartPng(height, config) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px";
    const cv = document.createElement("canvas");
    cv.width = 900; cv.height = height;
    host.appendChild(cv); document.body.appendChild(host);
    config.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 2 }, config.options);
    const ch = new Chart(cv, config);
    const url = cv.toDataURL("image/png");
    ch.destroy(); host.remove();
    return url;
  }
  const font = { family: "Arial, sans-serif", size: 13 };
  const axes = (x) => ({
    x: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, font }, ...x },
    y: { grid: { display: false }, ticks: { color: C.text, font } },
  });
  const labelsPlugin = (fmt) => ({ id: "lbl", afterDatasetsDraw(ch) {
    const ctx = ch.ctx; ctx.save(); ctx.font = "bold 12px Arial"; ctx.fillStyle = C.text; ctx.textBaseline = "middle";
    ch.getDatasetMeta(0).data.forEach((b, i) => ctx.fillText(fmt(i), b.x + 6, b.y)); ctx.restore();
  } });
  const seuilPlugin = (v) => ({ id: "seuil", afterDatasetsDraw(ch) {
    const { ctx, chartArea: a } = ch, x = ch.scales.x.getPixelForValue(v);
    ctx.save(); ctx.strokeStyle = C.text; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.font = "12px Arial"; ctx.fillStyle = C.text; ctx.fillText(`Seuil OMS ${v} %`, x + 5, a.top - 6); ctx.restore();
  } });

  function figLetalite(recs) {
    const rows = recs.filter((r) => r.letalite != null).sort((a, b) => b.letalite - a.letalite);
    if (!rows.length) return null;
    const max = Math.max(P().SEUIL_OMS * 2, ...rows.map((r) => r.letalite));
    return chartPng(Math.max(160, rows.length * 38 + 70), {
      type: "bar", plugins: [labelsPlugin((i) => P().fmtPct(rows[i].letalite)), seuilPlugin(P().SEUIL_OMS)],
      data: { labels: rows.map((r) => r.unit), datasets: [{ data: rows.map((r) => r.letalite), backgroundColor: rows.map((r) => (r.letalite > P().SEUIL_OMS ? C.critical : C.blue)), borderRadius: 4, barThickness: 20 }] },
      options: { indexAxis: "y", layout: { padding: { right: 60, top: 18 } }, scales: axes({ suggestedMax: max * 1.12, ticks: { color: C.muted, font, callback: (v) => v + " %" } }), plugins: { legend: { display: false } } },
    });
  }
  function figGravite(recs) {
    const rows = recs.map((r) => ({ r, s: P().severity(r) })).filter((x) => x.s.classes);
    if (!rows.length) return null;
    return chartPng(Math.max(170, rows.length * 38 + 90), {
      type: "bar",
      data: { labels: rows.map((x) => x.r.unit), datasets: P().SEVERITY.map(([, l], i) => ({ label: l, data: rows.map((x) => P().pct(x.s.vals[i] || 0, x.s.classes)), backgroundColor: C.sev[i], borderColor: "#fff", borderWidth: { right: 2 }, borderSkipped: false, barThickness: 22 })) },
      options: { indexAxis: "y", scales: { x: { stacked: true, max: 100, grid: { color: C.grid }, border: { display: false }, ticks: { color: C.muted, font, callback: (v) => v + " %" } }, y: { stacked: true, grid: { display: false }, ticks: { color: C.text, font } } },
        plugins: { legend: { display: true, position: "bottom", labels: { color: C.text, font, boxWidth: 12, boxHeight: 12 } } } },
    });
  }

  // ---------- Construction du contenu ----------
  function table(recs, L, indicators, caption) {
    const { esc } = P();
    const head = (r) => `${esc(r.unit)} (${r.L.abbr})`;
    let html;
    if (recs.length <= 6) {
      html = `<table><thead><tr><th>Indicateur</th>${recs.map((r) => `<th>${head(r)}</th>`).join("")}</tr></thead><tbody>` +
        indicators.map(([label, f]) => `<tr><td>${esc(label)}</td>${recs.map((r) => `<td class="c">${f(r)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    } else {
      html = `<table><thead><tr><th>Site</th>${indicators.map(([l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>` +
        recs.map((r) => `<tr><td>${head(r)}</td>${indicators.map(([, f]) => `<td class="c">${f(r)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    }
    return html + `<p class="caption">${caption}</p>`;
  }
  const comment = (txt) => txt ? `<div class="comment" contenteditable="true"><b>Commentaire :</b> ${P().esc(txt)}</div>` : "";

  function build({ level, region }) {
    const p = P(), { nf, nf1, esc, fmtPct, list } = p;
    const L = p.LEVELS[level];
    // Tableaux : tous les sites rapportants (région, districts, aires de santé), comme le rapport d'analyse.
    // Totaux : niveau sélectionné uniquement, pour éviter de compter deux fois les mêmes cas.
    const order = [level, ...Object.keys(p.LEVELS).filter((k) => k !== level)];
    const byCas = (a, b) => (b.cas || 0) - (a.cas || 0);
    const base = p.records(level, region).sort(byCas);
    const recs = order.flatMap((k) => p.records(k, region).sort(byCas));
    const all = order.flatMap((k) => p.reportsOf(k, region));
    const NS = "non saisi";
    const v = (x) => (x == null ? NS : nf.format(x));
    const yn = (x) => x.flag === "non" ? "Non" : x.flag === "oui" ? (x.n != null ? nf.format(x.n) : "Oui (non chiffré)") : NS;
    const stockTxt = (r, k) => r.stockRows.map((row) => {
      const st = row.stocks[k], status = p.stockStatus(st);
      if (!status) return NS;
      if (st.dispo === "non") return "Non";
      return `${st.qte != null ? nf.format(st.qte) + " " : "Oui "}(${status[2].toLowerCase()})`;
    }).join(" / ") || NS;
    const t = p.totals(base);
    const regLabel = region ? p.choiceLabel("region", region) : "";
    const scope = region ? `Région ${/^[aeéèiouy]/i.test(regLabel) ? "de l'" : "du "}${regLabel}` : "Ensemble des régions";
    const lastData = recs.reduce((m, r) => (r.date > m ? r.date : m), null);
    const perLevel = order.map((k) => [k, recs.filter((r) => r.lvl === k)]).filter(([, rs]) => rs.length);
    const comms = p.comments(recs, L, base);
    const quality = p.qualityChecks(recs);
    const reco = p.recommendations(recs);
    const msgs = p.keyMessages(recs, L, base);

    // 1. Contexte
    const times = all.map(p.submitted).filter(Boolean).sort((a, b) => a - b);
    const byType = Object.keys(p.LEVELS).map((k) => [k, p.reportsOf(k, region).length]);
    const structCount = recs.reduce((n, r) => n + r.srcs.filter((x) => x.type).length, 0);
    const missingLevels = byType.filter(([, n]) => !n).map(([k]) => ({ region: "régionale", district: "de district", as: "d'aire de santé" }[k]));
    const ctx = [
      `Ce rapport présente la situation de la prise en charge du choléra à partir des données de la fiche « ${esc(p.data.form.name)} » collectées sur KoboToolbox, synchronisées le ${frT(new Date(p.data.updated_at))}.`,
      `${nf.format(all.length)} fiche${all.length > 1 ? "s ont été reçues" : " a été reçue"}${times.length ? ` entre le ${frT(times[0])} et le ${frT(times[times.length - 1])}` : ""}, provenant de ${list(perLevel.map(([k, rs]) => `${rs.length} ${rs.length > 1 ? p.LEVELS[k].label.toLowerCase() : p.LEVELS[k].one} (${esc(list(rs.map((r) => r.lvl === "as" && r.district ? `${r.unit}, DS ${r.district}` : r.unit)))})`))}. La situation de chaque site correspond à son dernier rapport.`,
      perLevel.length > 1 ? `Les totaux sont calculés sur les ${L.label.toLowerCase()} uniquement, pour ne pas compter deux fois les mêmes cas ; les autres niveaux figurent dans les tableaux à titre de détail.` : "",
      structCount ? `Les données hospitalières des aires de santé proviennent ${structCount > 1 ? `de ${structCount} structures saisies` : "d'une structure saisie"} dans les tables de répétition (UTC, CTC, salles d'isolement).` : "",
      missingLevels.length ? `Aucune fiche ${list(missingLevels)} n'a été soumise${region ? " pour cette région" : ""}.` : "",
    ].filter(Boolean).map((x) => `<p>${x}</p>`).join("");
    const ctxComment = recs.length < 10 ? `avec ${recs.length} site${recs.length > 1 ? "s" : ""} rapportant${recs.length > 1 ? "s" : ""}, l'analyse est essentiellement descriptive et orientée vers le contrôle qualité. Les chiffres ne couvrent pas nécessairement l'ensemble des ${L.label.toLowerCase()} affecté${L.key === "as" ? "e" : ""}s et ne doivent pas être lus comme un bilan exhaustif.` : "";

    const figL = figLetalite(recs), figG = figGravite(recs);
    let fig = 0;
    const figure = (src, cap) => src ? `<figure><img src="${src}" alt="${esc(cap)}"><figcaption>Figure ${++fig}. ${esc(cap)}</figcaption></figure>` : "";

    const sections = [
      ["Contexte et source des données", ctx + comment(ctxComment)],
      ["Messages clés", msgs.length ? `<ul class="msgs" contenteditable="true">${msgs.map((m) => `<li>${esc(m.text)}</li>`).join("")}</ul>` : "<p>Aucune donnée.</p>"],
      ["Situation épidémiologique", table(recs, L, [
        ["Cas enregistrés à date", (r) => v(r.cas)], ["Décès à date", (r) => v(r.deces)],
        ["Létalité recalculée (%)", (r) => r.letalite == null ? "—" : nf1.format(r.letalite)],
        ["Létalité saisie (%)", (r) => r.lvl === "as" ? "—" : r.letaliteSaisie == null ? NS : nf1.format(r.letaliteSaisie)],
        ["Patients internés", (r) => v(r.hosp.nb_patients_internes)], ["Patients guéris", (r) => v(r.hosp.nb_patients_gueris)],
        ["Décès communautaires", (r) => v(r.comm.deces)],
      ], `Tableau 1. Indicateurs épidémiologiques par site. Total ${L.label.toLowerCase()} : ${nf.format(t.cas)} cas, ${nf.format(t.deces)} décès, létalité ${fmtPct(t.letalite)}.`)
        + figure(figL, `Létalité par site comparée au seuil OMS de ${p.SEUIL_OMS} %.`) + comment(comms.epi)],
      ["Gravité à l'admission", table(recs, L, [
        ...p.SEVERITY.map(([k, l]) => [l, (r) => v(r.hosp[k])]),
        ["% sévères", (r) => { const s = p.severity(r); return s.pctSevere == null ? "—" : nf1.format(s.pctSevere) + " %"; }],
      ], "Tableau 2. Répartition des patients selon le degré de déshydratation à l'arrivée.")
        + figure(figG, "Profil de déshydratation par site (en % des patients renseignés).") + comment(comms.gravite)],
      ["Capacités d'accueil", table(recs, L, [
        ["UTC", (r) => v(r.cap.utc)], ["CTC", (r) => v(r.cap.ctc)], ["Salles d'isolement", (r) => v(r.cap.salles)],
        ["Lits disponibles", (r) => v(r.hosp.nb_lits_dispo)], ["Lits-types choléra", (r) => v(r.hosp.nb_lits_types_cholera)],
        ["Lits dédiés à la PEC choléra", (r) => v(r.hosp.nb_lits_dedies)],
        ["Occupation des lits dédiés", (r) => r.hosp.nb_lits_dedies ? nf1.format((r.hosp.nb_patients_internes || 0) / r.hosp.nb_lits_dedies * 100) + " %" : "—"],
      ], `Tableau 3. Infrastructures de prise en charge déclarées.${recs.some((r) => r.lvl === "as") ? " Aires de santé : lits, stocks et RH additionnés sur les structures des tables de répétition." : ""}`) + comment(comms.capacites)],
      ["Intrants et logistique", table(recs, L, [
        ...p.STOCKS.map(([k, l]) => [l, (r) => stockTxt(r, k)]),
        ["PRO disponibles", (r) => r.cap.pro === "oui" ? (r.cap.nbPro != null ? nf.format(r.cap.nbPro) : "Oui") : r.cap.pro === "non" ? "Non" : NS],
      ], "Tableau 4. Disponibilité et état des stocks déclarés (quantité et état).") + comment(comms.intrants)],
      ["Ressources humaines", table(recs, L, p.RH.map(([f, , l]) => [l, (r) => yn(r.rh[f])]), "Tableau 5. Ressources humaines déclarées.") + comment(comms.rh)],
      ["Volet communautaire", table(recs, L, [
        ["Patients pris en charge en communauté", (r) => v(r.comm.patients)], ["Décès en communauté", (r) => v(r.comm.deces)],
        ["ASC communautaires disponibles", (r) => v(r.comm.ascDispo)], ["ASC communautaires formés", (r) => v(r.comm.ascFormes)],
        ["Chimioprophylaxie des contacts", (r) => r.comm.chimioContacts === "oui" ? "Oui" : r.comm.chimioContacts === "non" ? "Non" : NS],
        ["PRO fonctionnels", (r) => v(r.comm.proFonct)],
      ], "Tableau 6. Indicateurs communautaires.") + comment(comms.communaute)],
      ["Qualité et cohérence des données", quality.length
        ? `<table><thead><tr><th>Site</th><th>Anomalie constatée</th><th>Action proposée</th></tr></thead><tbody>${quality.map((q) => `<tr><td>${esc(q.site)}</td><td>${esc(q.text)}</td><td>${esc(q.action)}</td></tr>`).join("")}</tbody></table><p class="caption">Tableau 7. Principales anomalies détectées (${quality.length}).</p>`
          + comment("ces anomalies relèvent en grande partie de la conception du formulaire : taux de létalité saisis à la main, champs « Si oui, nombre » non obligatoires et absence de contrainte de cohérence entre les totaux. Les chiffres concernés doivent être confirmés avant intégration au SITREP.")
        : "<p>Aucune anomalie de cohérence n'a été détectée sur les derniers rapports.</p>"],
      ["Recommandations",
        `<h3>Riposte</h3>${reco.riposte.length ? `<ol contenteditable="true">${reco.riposte.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : "<p>Pas de recommandation opérationnelle urgente issue des données.</p>"}` +
        `<h3>Système d'information</h3>${reco.si.length ? `<ol start="${reco.riposte.length + 1}" contenteditable="true">${reco.si.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : "<p>Pas de recommandation sur le système d'information.</p>"}` +
        `<h3>Limites</h3><p contenteditable="true">L'analyse repose sur ${recs.length} site${recs.length > 1 ? "s" : ""} rapportant${recs.length > 1 ? "s" : ""}. ${recs.filter((r) => r.validated).length ? `${recs.filter((r) => r.validated).length} fiche(s) sur ${recs.length} ont un statut de validation « Approuvé ».` : "Aucune fiche n'a de statut de validation."} Les données sont déclaratives et n'ont pas été recoupées avec les listes linéaires ou DHIS2. Les comparaisons entre sites sont indicatives.</p>`],
    ];

    const title = `Rapport de situation — PEC Choléra`;
    const sub = `${scope} — Données au ${fr(lastData)} (${nf.format(all.length)} fiche${all.length > 1 ? "s" : ""}, ${recs.length} site${recs.length > 1 ? "s" : ""} rapportant${recs.length > 1 ? "s" : ""})`;
    const body = `
      <div class="entete" contenteditable="true">${ENTETE.map((l, i) => `<div class="${i ? "e2" : "e1"}">${esc(l)}</div>`).join("")}</div>
      <h1 contenteditable="true">${esc(title)}</h1>
      <div class="sub1">Fiche de collecte en temps réel — Prise en charge du choléra 2026</div>
      <div class="sub2" contenteditable="true">${esc(sub)}</div>
      ${sections.map(([h, c], i) => `<section><h2>${i + 1}. ${esc(h)}</h2>${c}</section>`).join("")}
      <p class="foot">Rapport généré automatiquement le ${frT(new Date())} à partir du tableau de bord KoboToolbox. Les commentaires ont été produits par des règles d'analyse et doivent être relus avant diffusion.</p>`;
    return { title, sub, body, fileBase: `SITREP_PEC_Cholera_${(region || "national").replace(/[^a-z_]/gi, "")}_${level}_${new Date().toISOString().slice(0, 10)}` };
  }

  const REPORT_CSS = `
    body { font: 11pt/1.45 Calibri, Arial, sans-serif; color: #1a1a1a; margin: 0; background: #f2f2f0; }
    .page { max-width: 820px; margin: 24px auto; background: #fff; padding: 48px 56px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    .toolbar { position: sticky; top: 0; z-index: 5; background: #1a1a19; color: #fff; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; font: 13px Arial, sans-serif; }
    .toolbar button { font: inherit; border: 0; border-radius: 6px; padding: 7px 12px; cursor: pointer; background: #3a3a37; color: #fff; }
    .toolbar button.primary { background: #2a78d6; font-weight: 600; }
    .toolbar .hint { color: #c3c2b7; margin-left: auto; font-size: 12px; }
    .entete { text-align: center; margin-bottom: 18px; }
    .entete .e1 { font-weight: bold; font-size: 10.5pt; letter-spacing: .02em; }
    .entete .e2 { font-size: 10pt; color: #444; }
    h1 { text-align: center; font-size: 18pt; margin: 18px 0 4px; color: #0d366b; }
    .sub1 { text-align: center; font-size: 11.5pt; font-weight: bold; }
    .sub2 { text-align: center; font-size: 10.5pt; color: #444; margin-bottom: 18px; border-bottom: 2px solid #0d366b; padding-bottom: 12px; }
    h2 { font-size: 13pt; color: #0d366b; margin: 22px 0 8px; border-bottom: 1px solid #cfd8e3; padding-bottom: 3px; }
    h3 { font-size: 11pt; margin: 12px 0 4px; }
    p { margin: 6px 0; text-align: justify; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 8px 0 2px; }
    th, td { border: 1px solid #bfc6cf; padding: 4px 6px; vertical-align: top; }
    th { background: #e8eef6; text-align: left; }
    td.c { text-align: center; }
    .caption, figcaption { font-size: 9pt; font-style: italic; color: #444; margin: 2px 0 10px; }
    figure { margin: 10px 0; text-align: center; page-break-inside: avoid; }
    figure img { max-width: 100%; }
    .comment { background: #f4f7fb; border-left: 3px solid #2a78d6; padding: 8px 12px; margin: 8px 0 12px; font-size: 10.5pt; text-align: justify; }
    ul.msgs li, ol li { margin: 4px 0; }
    [contenteditable="true"]:hover { outline: 1px dashed #9ec5f4; }
    [contenteditable="true"]:focus { outline: 2px solid #2a78d6; }
    .foot { font-size: 8.5pt; color: #777; margin-top: 24px; border-top: 1px solid #ddd; padding-top: 6px; }
    section { page-break-inside: auto; }
    @media print {
      body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; padding: 0; }
      [contenteditable="true"]:hover, [contenteditable="true"]:focus { outline: none; }
      @page { size: A4; margin: 18mm 16mm; }
      h2 { page-break-after: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; }
    }`;

  // Export Word : document MHTML (.doc) avec les figures intégrées, lisible par Word et LibreOffice
  function toWord(doc, fileBase) {
    const clone = doc.querySelector(".page").cloneNode(true);
    clone.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    const parts = [];
    clone.querySelectorAll("img").forEach((img, i) => {
      const m = img.src.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!m) return;
      const loc = `figure${i + 1}.png`;
      parts.push({ loc, type: m[1], data: m[2] });
      img.setAttribute("src", loc);
      img.setAttribute("width", "600");
    });
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${fileBase}</title>
      <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
      <style>${REPORT_CSS.replace(/@media print[\s\S]*$/, "")} body { background: #fff; } .page { box-shadow: none; padding: 0; margin: 0; } .comment { border-left: 3pt solid #2a78d6; }</style></head><body>${clone.outerHTML}</body></html>`;
    const B = "----=_NextPart_SITREP";
    const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");
    const utf8b64 = btoa(unescape(encodeURIComponent(html)));
    let mht = `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${B}"; type="text/html"\r\n\r\n` +
      `--${B}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/sitrep.htm\r\n\r\n${wrap(utf8b64)}\r\n`;
    parts.forEach((p) => { mht += `--${B}\r\nContent-Type: ${p.type}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/${p.loc}\r\n\r\n${wrap(p.data)}\r\n`; });
    mht += `--${B}--\r\n`;
    const a = doc.createElement("a");
    a.href = URL.createObjectURL(new Blob([mht], { type: "application/msword" }));
    a.download = fileBase + ".doc";
    doc.body.appendChild(a); a.click(); a.remove();
  }

  // Le rapport s'ouvre dans un panneau plein écran (iframe) : pas de fenêtre pop-up à autoriser,
  // et l'impression ne porte que sur le rapport.
  window.genererRapport = function (opts) {
    const r = build(opts);
    document.getElementById("report-overlay")?.remove();
    const ov = document.createElement("div");
    ov.id = "report-overlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:900;background:#f2f2f0";
    const frame = document.createElement("iframe");
    frame.title = "Rapport de situation";
    frame.style.cssText = "border:0;width:100%;height:100%";
    frame.srcdoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${r.fileBase}</title><style>${REPORT_CSS}</style></head><body>
      <div class="toolbar"><button id="close">← Retour au tableau de bord</button><button class="primary" id="print">Imprimer / Enregistrer en PDF</button><button id="word">Télécharger (Word)</button>
      <span class="hint">Les commentaires, messages et recommandations sont modifiables : clique dans le texte avant d'exporter.</span></div>
      <div class="page">${r.body}</div></body></html>`;
    frame.addEventListener("load", () => {
      const d = frame.contentDocument, w = frame.contentWindow;
      d.getElementById("print").onclick = () => w.print();
      d.getElementById("word").onclick = () => toWord(d, r.fileBase);
      d.getElementById("close").onclick = () => { ov.remove(); document.body.style.overflow = ""; };
    });
    ov.appendChild(frame);
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
  };
})();
