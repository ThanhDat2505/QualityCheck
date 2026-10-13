// Review UI state machine (plan M4.2). All requirement text is rendered with textContent.
const STATES = ["UNANALYZED", "ANALYZING", "CLEAR", "NEEDS_CLARIFICATION", "WAITING_FOR_ANSWER", "REWRITING", "WAITING_FOR_CONFIRMATION", "CONFIRMED", "SENT_TO_UML", "ERROR"];
const SCREENS = {
  UNANALYZED: ["input"], ANALYZING: ["input"], CLEAR: ["gate"], NEEDS_CLARIFICATION: ["gate", "answer"],
  WAITING_FOR_ANSWER: ["gate", "answer"], REWRITING: ["gate", "answer"], WAITING_FOR_CONFIRMATION: ["confirm"],
  CONFIRMED: ["done"], SENT_TO_UML: ["done"], ERROR: ["error"],
};
const $ = (id) => document.getElementById(id);
let state = "UNANALYZED";
let session = null; // { sessionKey, gate, questions, round, maxRounds, rewrittenText, canAskAgain }
let requirements = [];
let answerStarted = false;

function setState(next) {
  if (!STATES.includes(next)) throw new Error(`unknown state ${next}`);
  state = next;
  $("state").textContent = state;
  for (const s of ["input", "gate", "answer", "confirm", "done", "error"]) $(`screen-${s}`).classList.toggle("hidden", !SCREENS[state].includes(s));
  $("analyzeBtn").disabled = state === "ANALYZING";
  $("submitAnswersBtn").disabled = state === "REWRITING";
}

async function api(path, payload) {
  const res = await fetch(path, payload === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const event = (name) => session && api("/api/events", { sessionKey: session.sessionKey, event: name, t: Date.now() }).catch(() => {});

function fail(e) {
  $("errorText").textContent = e.message || String(e);
  setState("ERROR");
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

// Highlights issue spans inside the requirement without using innerHTML.
function renderHighlighted(container, text, spans) {
  container.replaceChildren();
  const ranges = [];
  for (const s of spans) {
    if (!s) continue;
    const i = text.toLowerCase().indexOf(s.toLowerCase());
    if (i >= 0) ranges.push([i, i + s.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    container.append(document.createTextNode(text.slice(pos, a)), el("mark", text.slice(a, b)));
    pos = b;
  }
  container.append(document.createTextNode(text.slice(pos)));
}

function currentRequirement() {
  return requirements.find((r) => r.id === $("reqSelect").value);
}

function renderPreview() {
  const r = currentRequirement();
  const box = $("reqPreview");
  box.replaceChildren();
  if (!r) return;
  box.append(el("div", r.text, "req"), el("div", `Target diagram: ${r.targetDiagram}`, "muted"));
  if (r.context.length) {
    const ul = el("ul", undefined, "ctx");
    for (const c of r.context) ul.append(el("li", c));
    box.append(el("div", "Context", "muted"), ul);
  }
  if (r.related.length) {
    const ul = el("ul", undefined, "ctx");
    for (const x of r.related) ul.append(el("li", `${x.id}: ${x.text}`));
    box.append(el("div", "Related requirements", "muted"), ul);
  }
}

function renderGate() {
  const { gate } = session;
  const r = currentRequirement();
  const badge = $("statusBadge");
  badge.textContent = gate.status === "CLEAR" ? "CLEAR" : "NEEDS CLARIFICATION";
  badge.className = `badge ${gate.status === "CLEAR" ? "clear" : "needs"}`;
  renderHighlighted($("highlighted"), r.text, gate.issues.map((i) => i.span));
  const list = $("issues");
  list.replaceChildren();
  for (const i of gate.issues) {
    const box = el("div", undefined, "issue");
    box.append(el("b", i.type), el("div", i.reason));
    if (i.span) box.append(el("div", `Span: "${i.span}"`, "muted"));
    if (i.relatedRequirementIds?.length) box.append(el("div", `Related: ${i.relatedRequirementIds.join(", ")}`, "muted"));
    list.append(box);
  }
  $("clearActions").classList.toggle("hidden", gate.status !== "CLEAR");
}

function renderQuestions() {
  $("roundInfo").textContent = `(round ${session.round} of ${session.maxRounds})`;
  const form = $("answerForm");
  form.replaceChildren();
  answerStarted = false;
  for (const q of session.questions) {
    const lab = el("label", q.question);
    lab.htmlFor = `a-${q.id}`;
    const ta = el("textarea");
    ta.id = `a-${q.id}`;
    ta.rows = 2;
    ta.placeholder = "Leave empty if you cannot answer";
    ta.addEventListener("input", () => {
      if (!answerStarted) {
        answerStarted = true;
        event("answer_started");
      }
    });
    form.append(lab, ta);
  }
  event("clarification_shown");
}

async function analyze() {
  const participantId = $("participant").value.trim();
  const r = currentRequirement();
  if (!participantId) return alert("Enter a participant / session ID first.");
  if (!r) return;
  setState("ANALYZING");
  try {
    session = await api("/api/session/start", { participantId, requirementId: r.id, t: Date.now() });
    renderGate();
    if (session.gate.status === "CLEAR") setState("CLEAR");
    else {
      setState("NEEDS_CLARIFICATION");
      renderQuestions();
      setState("WAITING_FOR_ANSWER");
    }
  } catch (e) {
    fail(e);
  }
}

async function submitAnswers() {
  const answers = Object.fromEntries(session.questions.map((q) => [q.id, $(`a-${q.id}`).value]));
  await event("answer_submitted");
  setState("REWRITING");
  try {
    const res = await api("/api/session/answer", { sessionKey: session.sessionKey, answers });
    Object.assign(session, res);
    $("originalText").textContent = currentRequirement().text;
    $("rewrittenText").textContent = res.rewrittenText;
    $("recheckInfo").textContent = res.recheck.issues.length
      ? `Recheck: ${res.recheck.issues.length} issue(s) remain${res.canAskAgain ? " — you can ask again" : " — maximum rounds reached"}.`
      : "Recheck: CLEAR.";
    $("askAgainBtn").disabled = !res.canAskAgain;
    $("editBox").classList.add("hidden");
    $("saveEditBtn").classList.add("hidden");
    setState("WAITING_FOR_CONFIRMATION");
    event("rewrite_shown");
  } catch (e) {
    fail(e);
  }
}

async function complete(decision, finalText) {
  await event("confirmed");
  try {
    const rec = await api("/api/session/complete", { sessionKey: session.sessionKey, decision, finalText });
    setState("CONFIRMED");
    $("finalText").textContent = rec.finalText;
    $("doneInfo").textContent = `Saved. Questions: ${rec.questionCount}, rounds: ${rec.clarificationRounds}, edited: ${rec.humanEdited ? "yes" : "no"}. The treatment runner sends this text to the UML pipeline.`;
    setState("SENT_TO_UML");
    const r = requirements.find((x) => x.id === rec.requirementId);
    if (r) r.reviewed = true;
    fillSelect();
  } catch (e) {
    fail(e);
  }
}

function fillSelect() {
  const sel = $("reqSelect");
  const keep = sel.value;
  sel.replaceChildren();
  for (const r of requirements) {
    const o = el("option", `${r.reviewed ? "✓ " : ""}${r.id} [${r.targetDiagram}]`);
    o.value = r.id;
    o.disabled = r.reviewed;
    sel.append(o);
  }
  const firstOpen = requirements.find((r) => !r.reviewed);
  sel.value = keep && !requirements.find((r) => r.id === keep)?.reviewed ? keep : firstOpen?.id ?? "";
  renderPreview();
}

$("reqSelect").addEventListener("change", renderPreview);
$("analyzeBtn").addEventListener("click", analyze);
$("submitAnswersBtn").addEventListener("click", submitAnswers);
$("sendClearBtn").addEventListener("click", () => complete("CONFIRM", currentRequirement().text));
$("confirmBtn").addEventListener("click", () => complete("CONFIRM", session.rewrittenText));
$("editBtn").addEventListener("click", () => {
  $("editBox").value = session.rewrittenText;
  $("editBox").classList.remove("hidden");
  $("saveEditBtn").classList.remove("hidden");
  event("manual_edit_started");
});
$("saveEditBtn").addEventListener("click", async () => {
  await event("manual_edit_completed");
  complete("EDIT", $("editBox").value);
});
$("askAgainBtn").addEventListener("click", async () => {
  try {
    Object.assign(session, await api("/api/session/ask-again", { sessionKey: session.sessionKey }));
    renderQuestions();
    setState("WAITING_FOR_ANSWER");
  } catch (e) {
    fail(e);
  }
});
$("nextBtn").addEventListener("click", () => {
  session = null;
  setState("UNANALYZED");
});
$("retryBtn").addEventListener("click", () => {
  session = null;
  setState("UNANALYZED");
});

(async () => {
  try {
    const cfg = await api("/api/config");
    $("cfg").textContent = `${cfg.provider}/${cfg.model} · max ${cfg.maxRounds} rounds`;
    requirements = await api("/api/requirements");
    fillSelect();
    setState("UNANALYZED");
  } catch (e) {
    fail(e);
  }
})();
