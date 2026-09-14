/* Recomp — phone UI. Vanilla, no build step. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n, d = 0) => Number(n).toLocaleString("en-SG", { maximumFractionDigits: d, minimumFractionDigits: d });
  const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const state = { day: todayStr(), data: null, foods: null, tab: "today", trend: null, est: null, estFiles: [] };

  // ------------------------------------------------------------ api
  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const r = await fetch(path, { ...opts, headers: isForm ? {} : { "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  }
  const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });
  const del = (p) => api(p, { method: "DELETE" });

  let toastT;
  function toast(msg, ms = 1800) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
  }

  // when logging into a past day, stamp it at noon of that day
  const atFor = () => (state.day === todayStr() ? null : `${state.day}T12:00:00+08:00`);

  // ------------------------------------------------------------ day
  async function loadDay(day = state.day) {
    state.day = day;
    state.data = await api(`/api/day?day=${day}`);
    render();
  }

  const labelKind = (k) => ({ revl_move: "REVL Move", revl_sweat: "REVL Sweat", revl_perform: "REVL Perform",
                              run_vest: "Vest run", run: "Run", lift: "Lift", swim: "Swim", other: "Workout" }[k] || k);

  function render() {
    const d = state.data; if (!d) return;
    const dt = new Date(d.day + "T12:00:00+08:00");
    $("#day-label").textContent = d.is_today ? "Today" :
      dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
    $("#day-next").disabled = d.is_today;
    const chip = $("#weight-chip");
    if (d.body) {
      chip.hidden = false;
      chip.className = "weightchip mono" + (d.body.out_of_bounds ? " oob" : "");
      const arrow = d.body.trend > d.body.weight ? "↘" : d.body.trend < d.body.weight ? "↗" : "→";
      chip.innerHTML = `${fmt(d.body.trend, 1)} kg ${arrow}` +
        (d.body.bodyfat != null ? ` · ${fmt(d.body.bodyfat, 1)}%` : "") +
        (d.body.in_creatine_window ? ` <span class="cw">creatine</span>` : "");
      chip.title = `latest reading ${d.body.weight} kg on ${d.body.day}; trend ${d.body.trend}`;
    } else chip.hidden = true;

    const t = d.totals, g = d.targets, v = d.verdict;
    $("#p-val").textContent = fmt(t.protein, 0);
    $("#p-range").textContent = `${fmt(g.protein_floor)}–${fmt(g.protein_ceiling)}`;
    const pmax = g.protein_ceiling * 1.25;
    $("#p-fill").style.width = Math.min(100, t.protein / pmax * 100) + "%";
    $("#p-fill").className = "fill " + v.protein;
    $("#p-floor").style.left = g.protein_floor / pmax * 100 + "%";
    $("#p-ceil").style.left = g.protein_ceiling / pmax * 100 + "%";
    $("#p-foot").textContent = v.protein_msg + (t.whey_protein ? ` · ${Math.round(t.whey_share * 100)}% from whey` : "");

    const k = g.kcal, kmax = k.hi * 1.2;
    $("#k-val").textContent = fmt(t.kcal);
    $("#k-range").textContent = `${fmt(k.lo)}–${fmt(k.hi)}`;
    $("#k-fill").style.width = Math.min(100, t.kcal / kmax * 100) + "%";
    $("#k-fill").className = "fill " + v.kcal;
    const band = $("#k-band");
    band.style.left = k.lo / kmax * 100 + "%";
    band.style.width = (k.hi - k.lo) / kmax * 100 + "%";
    $("#k-foot").textContent = `${v.kcal_msg} · ${k.source === "measured"
      ? `measured, ${k.confidence} confidence` : "provisional until the engine has data"}` +
      (t.kcal ? ` · range ${fmt(t.lo)}–${fmt(t.hi)}` : "");

    const vd = $("#verdict");
    const cls = v.kcal === "over" ? "crit" : v.protein === "short" ? "warn" : "ok";
    vd.className = "verdict " + cls;
    const head = v.ok_to_end ? "Fine to end the day here." : v.protein === "short" ? "Protein first." : "Over the calorie band.";
    vd.innerHTML = `<span class="lamp"></span><div><b>${head}</b><small>${v.protein_msg} · ${v.kcal_msg}</small></div>`;

    const kinds = new Set(d.workouts.map(w => w.kind));
    $$("#workouts .chip").forEach(c => c.classList.toggle("done", kinds.has(c.dataset.kind)));

    const rows = [...d.meals.map(m => ({ ...m, _t: "meal" })), ...d.workouts.map(w => ({ ...w, _t: "workout" }))]
      .sort((a, b) => a.at.localeCompare(b.at));
    $("#log-count").textContent = `${d.meals.length} meals · ${d.workouts.length} workouts`;
    const log = $("#log");
    log.innerHTML = rows.length ? "" : `<li class="empty">Nothing logged yet.</li>`;
    for (const r of rows) {
      const li = document.createElement("li");
      const time = r.at.slice(11, 16);
      if (r._t === "meal") {
        li.className = r.needs_review ? "review" : "";
        const sub = [r.source === "backfill" ? "from chat" : r.source === "photo" ? "estimated" : null,
                     r.share_frac < 1 ? `${Math.round(r.share_frac * 100)}% share` : null, r.venue].filter(Boolean).join(" · ");
        li.innerHTML = `<span class="t">${time}</span>
          <span class="l">${esc(r.label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
          <span class="n p">${fmt(r.protein_g, 0)}g</span>
          <span class="n">${fmt(r.kcal)}</span>
          <button class="x" aria-label="Delete">×</button>`;
        $(".x", li).onclick = async () => { state.data = await del(`/api/meals/${r.id}`); render(); toast("Removed"); };
      } else {
        li.className = "workout";
        li.innerHTML = `<span class="t">${time}</span>
          <span class="l">${labelKind(r.kind)}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</span>
          <span class="n"></span><span class="n"></span>
          <button class="x" aria-label="Delete">×</button>`;
        $(".x", li).onclick = async () => { state.data = await del(`/api/workouts/${r.id}`); render(); toast("Removed"); };
      }
      log.appendChild(li);
    }
  }

  // ------------------------------------------------------------ estimate
  $("#est-files").addEventListener("change", (e) => {
    state.estFiles = [...e.target.files];
    const t = $("#est-thumbs"); t.innerHTML = "";
    for (const f of state.estFiles) {
      const img = document.createElement("img"); img.src = URL.createObjectURL(f); img.alt = ""; t.appendChild(img);
    }
  });

  async function runEstimate(parentId = null, correction = null) {
    const fd = new FormData();
    if (!parentId) for (const f of state.estFiles) fd.append("photos", f, f.name || "photo.jpg");
    fd.append("text", correction ?? $("#est-text").value);
    fd.append("share_frac", $("#est-share").value || "1");
    if (parentId) fd.append("parent_id", parentId);
    $("#est-status").textContent = parentId ? "refining…" : "estimating…";
    $("#est-go").disabled = true;
    try {
      state.est = await api("/api/estimate", { method: "POST", body: fd });
      renderEstimate();
      $("#est-status").textContent = `${state.est.model} · $${state.est.cost_usd}`;
    } catch (e) {
      $("#est-status").textContent = "";
      $("#est-result").hidden = false;
      $("#est-result").innerHTML = `<div class="estcard err"><b>Couldn't estimate.</b><small>${esc(e.message)}</small></div>`;
    } finally { $("#est-go").disabled = false; }
  }
  $("#est-go").onclick = () => {
    if (!state.estFiles.length && !$("#est-text").value.trim()) return toast("Add a photo or describe it");
    runEstimate();
  };

  function renderEstimate() {
    const e = state.est, r = e.result, box = $("#est-result");
    box.hidden = false;
    const items = r.items.map(i => `<li><span>${esc(i.name)}<small>${esc(i.portion)} · ${i.confidence}</small></span>
      <span class="mono p">${fmt(i.protein_g, 0)}g</span><span class="mono">${fmt(i.kcal)}</span></li>`).join("");
    const photos = (e.photos || []).map(p => `<img src="/api/photos/${p}" alt="">`).join("");
    box.innerHTML = `<div class="estcard">
      <div class="row between">
        <b>${esc(r.dish)}</b>
        <span class="pill ${r.confidence === "high" ? "good" : r.confidence === "medium" ? "medium" : "low"}">${r.confidence}</span>
      </div>
      <div class="big mono"><span class="p">${fmt(r.protein_g, 0)} g</span> · ${fmt(r.kcal)} kcal <small>${fmt(r.kcal_lo)}–${fmt(r.kcal_hi)}</small></div>
      ${photos ? `<div class="thumbs">${photos}</div>` : ""}
      <ul class="items">${items}</ul>
      ${r.assumptions?.length ? `<p><b>Assumed:</b> ${esc(r.assumptions.join("; "))}</p>` : ""}
      ${r.grounding?.length ? `<p><b>Based on:</b> ${esc(r.grounding.join("; "))}</p>` : ""}
      ${r.tighten ? `<p><b>Would tighten it:</b> ${esc(r.tighten)}</p>` : ""}
      <div class="row gap">
        <input class="text grow" id="est-refine" placeholder="Correct it — “only ate half the rice”, “it was 2 wings not 5”">
        <button class="btn" id="est-refine-go">Refine</button>
      </div>
      <div class="row gap end">
        <button class="btn" id="est-discard">Discard</button>
        <button class="btn primary" id="est-add" ${e.meal_id ? "disabled" : ""}>${e.meal_id ? "Added" : "Add to log"}</button>
      </div>
    </div>`;
    $("#est-refine-go").onclick = () => { const c = $("#est-refine").value.trim(); if (c) runEstimate(e.id, c); };
    $("#est-discard").onclick = resetEstimate;
    $("#est-add").onclick = async () => {
      state.data = await post(`/api/estimate/${e.id}/add`, {});
      render(); toast(`Added ${r.dish}`); resetEstimate();
    };
  }
  function resetEstimate() {
    state.est = null; state.estFiles = [];
    $("#est-files").value = ""; $("#est-thumbs").innerHTML = ""; $("#est-text").value = ""; $("#est-share").value = "1";
    $("#est-result").hidden = true; $("#est-result").innerHTML = ""; $("#est-status").textContent = "";
  }

  // ------------------------------------------------------------ quick add
  async function loadFoods() {
    state.foods = await api("/api/foods");
    const q = $("#quick"); q.innerHTML = "";
    for (const f of state.foods.quick) {
      const b = document.createElement("button");
      b.className = "chip";
      b.innerHTML = `${esc(f.label)}<small>${fmt(f.protein, 0)}g · ${fmt(f.kcal)} kcal</small>`;
      b.onclick = async () => {
        b.disabled = true;
        try { state.data = await post("/api/meals/quick", { id: f.id, at: atFor() }); render(); toast(`Added ${f.label}`); }
        finally { b.disabled = false; }
      };
      q.appendChild(b);
    }
    fillProducts();
    previewShake();
  }
  function fillProducts() {
    for (const [sel, list] of [["#whey-id", state.foods.wheys], ["#milk-id", state.foods.milks]]) {
      const s = $(sel), cur = s.value; s.innerHTML = "";
      for (const p of list) {
        const o = document.createElement("option"); o.value = p.id;
        o.textContent = p.label + (p.is_default ? " ★" : ""); s.appendChild(o);
      }
      const def = list.find(p => p.is_default) || list[0];
      s.value = list.some(p => String(p.id) === cur) ? cur : (def ? def.id : "");
    }
  }

  // ------------------------------------------------------------ shake
  let shakeT;
  function previewShake() {
    clearTimeout(shakeT);
    shakeT = setTimeout(async () => {
      const p = new URLSearchParams({ whey_g: $("#whey").value || 0, milk_ml: $("#milk").value || 0,
        whey_id: $("#whey-id").value, milk_id: $("#milk-id").value, creatine_g: $("#creatine").value || 0 });
      try {
        const s = await api(`/api/shake/preview?${p}`);
        $("#shake-result").textContent = `${fmt(s.protein_g, 1)} g · ${fmt(s.kcal)} kcal`;
      } catch { $("#shake-result").textContent = "—"; }
    }, 120);
  }
  ["whey", "milk", "milk-id", "whey-id", "creatine"].forEach(id => $("#" + id).addEventListener("input", previewShake));
  $("#btn-shake").onclick = async () => {
    const body = { whey_g: +$("#whey").value || 0, milk_ml: +$("#milk").value || 0,
      whey_id: +$("#whey-id").value || null, milk_id: +$("#milk-id").value || null,
      creatine_g: +($("#creatine").value || 0), at: atFor() };
    state.data = await post("/api/meals/shake", body); render(); toast("Shake added");
  };

  // ------------------------------------------------------------ products
  $("#btn-product").onclick = () => { $("#product-form").reset(); syncPer(); $("#product").showModal(); };
  const syncPer = () => { const per = $("#product-kind").value === "whey" ? "/g" : "/100ml";
    $("#product-per").textContent = per; $("#product-per2").textContent = per; };
  $("#product-kind").addEventListener("change", syncPer);
  $("#product-form").onsubmit = async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const f = new FormData(e.target);
    await post("/api/products", { kind: f.get("kind"), label: f.get("label"), per: f.get("kind") === "whey" ? "g" : "100ml",
      kcal: +f.get("kcal"), protein_g: +f.get("protein_g"), make_default: !!f.get("make_default") });
    $("#product").close(); toast("Saved"); await loadFoods();
  };

  // ------------------------------------------------------------ workouts / manual
  $$("#workouts .chip").forEach(c => c.onclick = async () => {
    let detail = null;
    if (c.dataset.kind === "lift") detail = prompt("What did you lift? e.g. 3RM back squat 100kg, or calves") || null;
    if (c.dataset.kind === "revl_perform") detail = prompt("Upper or lower?", "upper") || null;
    if (c.dataset.kind === "run_vest") detail = (prompt("Distance? e.g. 3km", "3km") || "") + " 10kg vest";
    state.data = await post("/api/workouts", { kind: c.dataset.kind, detail, at: atFor() });
    render(); toast(`${labelKind(c.dataset.kind)} logged`);
  });
  $("#manual").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.data = await post("/api/meals/manual", { label: f.get("label"), kcal: +f.get("kcal"),
      protein_g: +f.get("protein_g"), share_frac: +f.get("share_frac") || 1, at: atFor() });
    e.target.reset(); render(); toast("Added");
  };

  // ------------------------------------------------------------ day nav
  const shift = (n) => { const d = new Date(state.day + "T12:00:00+08:00"); d.setDate(d.getDate() + n);
                         loadDay(d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" })); };
  $("#day-prev").onclick = () => shift(-1);
  $("#day-next").onclick = () => shift(1);
  $("#day-label").onclick = () => loadDay(todayStr());

  // ------------------------------------------------------------ trend
  async function loadTrend() {
    state.trend = await api("/api/trend?days=120");
    drawChart(); renderExpenditure();
    const p = state.trend.points, last = p[p.length - 1];
    $("#trend-latest").textContent = last
      ? `${last.weight} kg · trend ${last.trend}` + (last.bodyfat != null ? ` · ${last.bodyfat}% fat` : "")
      : "no weigh-ins yet";
  }

  function drawChart() {
    const c = $("#chart"), dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = 220;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    ctx.clearRect(0, 0, W, H);
    const pts = state.trend.points;
    if (pts.length < 1) {
      ctx.fillStyle = col("--faint"); ctx.font = "13px " + col("--mono");
      ctx.textAlign = "center"; ctx.fillText("No weigh-ins yet — pull Renpho or log one by hand", W / 2, H / 2);
      return;
    }
    const pad = { l: 38, r: 10, t: 10, b: 22 };
    const day0 = new Date(pts[0].day), day1 = new Date();
    const nDays = Math.max(7, (day1 - day0) / 864e5);
    const x = (d) => pad.l + ((new Date(d) - day0) / 864e5) / nDays * (W - pad.l - pad.r);
    const ws = pts.flatMap(p => [p.weight, p.trend]).concat([state.trend.weight_lo, state.trend.weight_hi]);
    let ymin = Math.min(...ws) - 0.5, ymax = Math.max(...ws) + 0.5;
    const y = (v) => pad.t + (1 - (v - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);

    ctx.fillStyle = col("--ok"); ctx.globalAlpha = 0.14;
    ctx.fillRect(pad.l, y(state.trend.weight_hi), W - pad.l - pad.r, y(state.trend.weight_lo) - y(state.trend.weight_hi));
    ctx.globalAlpha = 1;
    const cw = state.trend.creatine_window;
    if (cw && cw.length === 2) {
      const x0 = Math.max(pad.l, x(cw[0])), x1 = Math.min(W - pad.r, x(cw[1]));
      if (x1 > x0) {
        ctx.save(); ctx.beginPath(); ctx.rect(x0, pad.t, x1 - x0, H - pad.t - pad.b); ctx.clip();
        ctx.strokeStyle = col("--faint"); ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
        for (let i = -H; i < W; i += 7) { ctx.beginPath(); ctx.moveTo(x0 + i, H); ctx.lineTo(x0 + i + H, 0); ctx.stroke(); }
        ctx.restore();
      }
    }
    ctx.font = "10px " + col("--mono"); ctx.fillStyle = col("--faint"); ctx.textAlign = "right";
    ctx.strokeStyle = col("--line"); ctx.lineWidth = 1;
    for (let v = Math.ceil(ymin); v <= ymax; v += 1) {
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(W - pad.r, y(v)); ctx.stroke();
      ctx.fillText(v, pad.l - 6, y(v) + 3);
    }
    ctx.textAlign = "left"; ctx.fillText(pts[0].day.slice(5), pad.l, H - 6);
    ctx.textAlign = "right"; ctx.fillText(todayStr().slice(5), W - pad.r, H - 6);
    ctx.fillStyle = col("--ink"); ctx.globalAlpha = 0.55;
    for (const p of pts) { ctx.beginPath(); ctx.arc(x(p.day), y(p.weight), 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2.2; ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(x(p.day), y(p.trend)) : ctx.moveTo(x(p.day), y(p.trend)));
    ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.fillStyle = col("--accent"); ctx.beginPath(); ctx.arc(x(last.day), y(last.trend), 4, 0, Math.PI * 2); ctx.fill();
  }

  function renderExpenditure() {
    const cur = state.trend.current, el = $("#expenditure");
    const pill = `<span class="pill ${cur.confidence}">${cur.confidence === "none" ? "provisional" : cur.confidence + " confidence"}</span>`;
    if (cur.source === "provisional") {
      el.innerHTML = `<h2 class="eyebrow">Expenditure</h2><div class="exp">
        <div class="big">${fmt(cur.target)} <small>kcal/day target</small></div>${pill}
        <p>${esc(cur.note)}</p>
        <p>Log complete days and weigh in each morning. Once there are ~7 complete days, this number comes from your own intake and weight trend, not a formula.</p></div>`;
      return;
    }
    el.innerHTML = `<h2 class="eyebrow">Expenditure</h2><div class="exp">
      <div class="big">${fmt(cur.tdee)} <small>kcal/day measured · ${fmt(cur.tdee - cur.target)} deficit → target ${fmt(cur.target)}</small></div>
      ${pill}
      <p>Band ${fmt(cur.lo)}–${fmt(cur.hi)} kcal. ${esc(cur.note)}</p>
      <p>As of ${cur.as_of}. Recomputed every time a weigh-in lands.</p></div>`;
  }

  $("#btn-renpho").onclick = async (e) => {
    e.target.disabled = true; $("#data-msg").textContent = "Pulling from Renpho…";
    try {
      const s = await post("/api/ingest/renpho", {});
      $("#data-msg").textContent = s.ok
        ? `Fetched ${s.fetched}, ${s.new} new. Latest ${s.latest ? `${s.latest.weight_kg} kg on ${s.latest.day}` : "—"}.`
        : `Renpho: ${s.error}`;
      await loadTrend(); await loadDay();
    } finally { e.target.disabled = false; }
  };
  $("#btn-recompute").onclick = async () => {
    const e = await post("/api/engine/recompute", {});
    $("#data-msg").textContent = `${e.confidence}: ${e.note}`;
    await loadTrend(); await loadDay();
  };
  $("#btn-weight").onclick = async () => {
    const w = parseFloat(prompt("Weight this morning (kg)?")); if (!w) return;
    const bf = parseFloat(prompt("Body fat % (optional)") || "");
    await post("/api/body", { weight_kg: w, bodyfat_pct: isNaN(bf) ? null : bf });
    toast("Weight logged"); await loadTrend(); await loadDay();
  };

  // ------------------------------------------------------------ settings
  const SETTINGS = [
    ["protein_floor_g", "Protein floor (g)"], ["protein_ceiling_g", "Protein ceiling (g)"],
    ["weight_lo_kg", "Weight low (kg)"], ["weight_hi_kg", "Weight high (kg)"],
    ["provisional_kcal", "Provisional kcal"], ["recomp_deficit_kcal", "Recomp deficit (kcal)"],
    ["creatine_start", "Creatine start (YYYY-MM-DD)"], ["creatine_settle_days", "Creatine settle (days)"],
    ["estimate_model", "Estimate model"], ["estimate_effort", "Estimate effort"],
    ["estimate_web_search", "Web search (1/0)"],
  ];
  $("#btn-settings").onclick = async () => {
    const s = await api("/api/settings");
    $("#settings-fields").innerHTML = SETTINGS.map(([k, l]) =>
      `<label class="lbl">${l}<input class="num" name="${k}" value="${esc(s[k] ?? "")}"></label>`).join("");
    $("#settings").showModal();
  };
  $("#settings-form").onsubmit = async (e) => {
    if (e.submitter?.value !== "save") return;
    const f = new FormData(e.target), values = {};
    for (const [k] of SETTINGS) values[k] = f.get(k);
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ values }) });
    await post("/api/engine/recompute", {});
    toast("Saved"); await loadDay(); if (state.tab === "trend") await loadTrend();
  };

  // ------------------------------------------------------------ tabs
  $$(".tab").forEach(t => t.onclick = async () => {
    state.tab = t.dataset.tab;
    $$(".tab").forEach(x => x.classList.toggle("is-on", x === t));
    $("#view-today").hidden = state.tab !== "today";
    $("#view-trend").hidden = state.tab !== "trend";
    if (state.tab === "trend") await loadTrend();
  });
  window.addEventListener("resize", () => state.tab === "trend" && state.trend && drawChart());

  // ------------------------------------------------------------ boot
  (async () => {
    try { await loadFoods(); await loadDay(); }
    catch (e) { toast("Can't reach the server: " + e.message, 5000); }
  })();
})();
