/* =====================================================================
   Form_script.js  (Askly, shareable + online version)
   PART 1 : Store       -> online backend (Google Apps Script + Google Sheet)
   PART 2 : Schema      -> the list of questions (default + new question)
   PART 3 : Fill form   -> draws questions from schema + validation
   PART 4 : Builder     -> add / edit / move / delete questions
   PART 5 : Responses   -> live table, delete, Excel export
   PART 6 : Navigation  -> sidebar, hamburger menu
   PART 7 : Share link, My Forms, owner login, start-up
   ===================================================================== */

const $ = id => document.getElementById(id);

// Tiny helper to create an element:  el("div", "class-name", "text")
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;   // textContent = safe, never runs HTML
    return e;
}

/* =====================================================================
   PART 1 : ONLINE BACKEND (Google Apps Script + Google Sheet)
   Every function below sends a small message to SCRIPT_URL (your Code.gs).
   Public actions : open a form, submit answers
   Admin actions  : everything else (needs the admin password)
   ===================================================================== */
const Store = {
    PREF_KEY: "askly_current_form",          // remembers which form you had open (not data)
    PW_KEY:   "askly_admin_pw",              // password kept only until you close the tab

    // send JSON to the script. "text/plain" avoids browser CORS pre-checks.
    async api(body) {
        const res = await fetch(SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Server error");
        return data;
    },
    admin(body) { return this.api(Object.assign({ pw: sessionStorage.getItem(this.PW_KEY) || "" }, body)); },

    async login(pw) {
        sessionStorage.setItem(this.PW_KEY, pw);
        try { await this.admin({ action: "login" }); }
        catch (e) { sessionStorage.removeItem(this.PW_KEY); throw e; }
    },
    logout()   { sessionStorage.removeItem(this.PW_KEY); },
    loggedIn() { return !!sessionStorage.getItem(this.PW_KEY); },

    // ----- forms -----
    async getForm(id) {                       // public (anyone with the link)
        const res = await fetch(SCRIPT_URL + "?action=form&id=" + encodeURIComponent(id));
        const data = await res.json();
        return data.ok ? data.form : null;
    },
    async myForms() {
        const d = await this.admin({ action: "listForms" });
        return d.forms.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    },
    async createForm(sc) { return (await this.admin({ action: "saveForm", form: sc })).id; },
    saveForm(id, sc)     { return this.admin({ action: "saveForm", id: id, form: sc }); },
    deleteForm(id)       { return this.admin({ action: "deleteForm", id: id }); },

    // ----- responses -----
    addResponse(formId, r)   { return this.api({ action: "submit", formId: formId, answers: r.answers }); },
    removeResponse(_f, id)   { return this.admin({ action: "deleteResponse", id: id }); },
    clearResponses(formId)   { return this.admin({ action: "clearResponses", formId: formId }); },
    async listResponses(formId) {
        const d = await this.admin({ action: "listResponses", formId: formId });
        return d.responses.sort((x, y) => x.submittedAt < y.submittedAt ? -1 : 1);
    }
};

// Passwords are never saved as plain text. We save a SHA-256 hash only.
async function hashText(text) {
    if (!window.crypto || !crypto.subtle) return "(not stored)";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}


/* =====================================================================
   PART 2 : SCHEMA (what questions the form has)
   ===================================================================== */
const OTHER = "__other__";   // special value used for the "Other" option

const TYPES = {
    text:      "Short text",
    paragraph: "Paragraph",
    email:     "Email",
    phone:     "Phone (10 digits)",
    number:    "Number",
    date:      "Date",
    radio:     "Single choice",
    checkbox:  "Multiple choice",
    dropdown:  "Dropdown",
    password:  "Password"
};
const isChoice = t => t === "radio" || t === "checkbox" || t === "dropdown";

function uid() { return "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// One new question with safe defaults
function newQuestion(type) {
    return {
        id: uid(), type: type, label: "Untitled question", required: false,
        placeholder: "", options: isChoice(type) ? ["Option 1", "Option 2"] : [],
        minLength: 0, lettersOnly: false, minAge: 0, min: "", max: "",
        allowOther: false, confirm: false
    };
}

// Your ORIGINAL registration form, rebuilt as questions
function defaultSchema() {
    const mk = (type, label, extra) => Object.assign(newQuestion(type), { label: label }, extra);
    return {
        title: "Registration Form",
        description: "Fill in your details below. Questions marked with * are required.",
        questions: [
            mk("text",     "Full Name",     { required: true, minLength: 3, lettersOnly: true, placeholder: "Enter your name" }),
            mk("date",     "Date of Birth", { required: true, minAge: 16 }),
            mk("radio",    "Gender",        { options: ["Male", "Female", "Prefer not to say"] }),
            mk("email",    "Email Address", { required: true, placeholder: "abc@example.com" }),
            mk("phone",    "Phone Number",  { required: true, placeholder: "10 digit number" }),
            mk("dropdown", "City",          { required: true, options: ["Phagwara", "Jalandhar", "Chandigarh", "Ludhiana", "Amritsar"], allowOther: true }),
            mk("text",     "Address",       { required: true, minLength: 10, placeholder: "Enter your address" }),
            mk("password", "Password",      { required: true, confirm: true, placeholder: "Min 8 chars: A-Z, a-z, 0-9, special" })
        ]
    };
}

let schema = defaultSchema();     // replaced by the saved form once it is loaded
let formId = null;                // id of the form that is open
let publicMode = false;           // true when opened from a shared link (?f=ID)
let responsesCache = [];          // latest responses (live)


/* =====================================================================
   PART 3 : FILL FORM  (draw questions + validate)
   ===================================================================== */
let submitted = false;

function buildQuestion(q, index) {
    const wrap = el("div", "q");
    wrap._q = q;                                   // remember which question this card belongs to

    wrap.append(el("span", "q-num", index + 1));

    const label = el("label", "q-label", q.label || "Untitled question");
    label.htmlFor = "f_" + q.id;
    if (q.required) label.append(el("span", "req", "*"));
    wrap.append(label);

    const t = q.type;

    if (t === "radio" || t === "checkbox") {
        // vertical list of selectable tiles
        const tiles = el("div", "tiles");
        const opts = q.options.slice();
        if (t === "radio" && q.allowOther) opts.push(OTHER);
        opts.forEach(opt => {
            const tile = el("label", "tile" + (t === "checkbox" ? " chk" : ""));
            const input = el("input");
            input.type = t;
            input.name = q.id;
            input.value = opt;
            tile.append(input, el("span", "mark"), el("span", "", opt === OTHER ? "Other" : opt));
            tiles.append(tile);
        });
        if (!opts.length) tiles.append(el("div", "muted", "(No options added yet)"));
        wrap.append(tiles);
    }
    else if (t === "dropdown") {
        const sel = el("select", "field");
        sel.id = "f_" + q.id;
        const first = el("option", "", "Choose");
        first.value = "";
        sel.append(first);
        q.options.forEach(opt => { const o = el("option", "", opt); o.value = opt; sel.append(o); });
        if (q.allowOther) { const o = el("option", "", "Other"); o.value = OTHER; sel.append(o); }
        wrap.append(sel);
    }
    else if (t === "paragraph") {
        const ta = el("textarea", "field");
        ta.id = "f_" + q.id; ta.rows = 3; ta.placeholder = q.placeholder || "Your answer";
        wrap.append(ta);
    }
    else {
        const input = el("input", "field");
        input.id = "f_" + q.id;
        input.type = (t === "date") ? "date" : (t === "password") ? "password" : "text";
        input.placeholder = q.placeholder || "Your answer";
        if (t === "phone")  { input.inputMode = "numeric"; input.maxLength = 10; }
        if (t === "number") { input.inputMode = "decimal"; }
        wrap.append(input);

        if (t === "password" && q.confirm) {
            const c = el("input", "confirm-field");
            c.type = "password"; c.placeholder = "Confirm password";
            wrap.append(c);
        }
    }

    // text box for "Other" (hidden until Other is picked)
    if (q.allowOther && (t === "radio" || t === "dropdown")) {
        const o = el("input", "other-input hidden");
        o.type = "text"; o.placeholder = "Type your answer";
        wrap.append(o);
    }

    wrap.append(el("div", "error"));
    return wrap;
}

function renderForm() {
    $("formTitle").textContent = schema.title || "Untitled form";
    $("formDesc").textContent = schema.description || "";
    const box = $("questions");
    box.textContent = "";
    schema.questions.forEach((q, i) => box.append(buildQuestion(q, i)));
    $("formActions").classList.toggle("hidden", schema.questions.length === 0);
    if (!schema.questions.length) box.append(el("div", "empty-note", "This form has no questions yet. Go to Build Form and add some."));
    submitted = false;
}

// ----- read the answer of one question -----
function isOtherSelected(q, wrap) {
    if (q.type === "radio")    { const c = wrap.querySelector("input[type=radio]:checked"); return !!c && c.value === OTHER; }
    if (q.type === "dropdown") { return wrap.querySelector("select").value === OTHER; }
    return false;
}
function readValue(q, wrap) {
    switch (q.type) {
        case "radio": {
            const c = wrap.querySelector("input[type=radio]:checked");
            if (!c) return "";
            return c.value === OTHER ? wrap.querySelector(".other-input").value.trim() : c.value;
        }
        case "checkbox":
            return Array.from(wrap.querySelectorAll("input[type=checkbox]:checked")).map(c => c.value);
        case "dropdown": {
            const s = wrap.querySelector("select");
            return s.value === OTHER ? wrap.querySelector(".other-input").value.trim() : s.value;
        }
        default:
            return wrap.querySelector(".field").value.trim();
    }
}
const isEmpty = v => Array.isArray(v) ? v.length === 0 : v === "";

// ----- rules for each type: returns an error message, or "" if OK -----
function checkValue(q, v) {
    if (isEmpty(v)) return q.required ? "This question is required" : "";

    switch (q.type) {
        case "text":
        case "paragraph":
            if (q.minLength && v.length < q.minLength) return "Minimum " + q.minLength + " characters needed";
            if (q.lettersOnly && !/^[A-Za-z ]+$/.test(v)) return "Only letters (A-Z / a-z) and spaces allowed";
            break;
        case "email":
            if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)) return "Enter a valid email id";
            break;
        case "phone":
            if (!/^[0-9]{10}$/.test(v)) return "Phone number must be 10 digits";
            break;
        case "number": {
            if (isNaN(Number(v))) return "Enter a valid number";
            if (q.min !== "" && Number(v) < q.min) return "Number must be at least " + q.min;
            if (q.max !== "" && Number(v) > q.max) return "Number must be at most " + q.max;
            break;
        }
        case "date":
            if (q.minAge) {
                const today = new Date();
                const limit = new Date(today.getFullYear() - q.minAge, today.getMonth(), today.getDate());
                if (new Date(v) > limit) return "You should be " + q.minAge + " years or above";
            }
            break;
        case "password":
            if (v.length < 8) return "Password must be at least 8 characters";
            if (!/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&#^])[A-Za-z\d@$!%*?&#^]{8,20}$/.test(v))
                return "Use 8-20 chars with Uppercase, Lowercase, Digit and Special character (@$!%*?&#^)";
            break;
    }
    return "";
}

// Validate one card: shows the message + red/green state. Returns true/false.
function validateQuestion(wrap) {
    const q = wrap._q;
    const v = readValue(q, wrap);
    let msg = "";

    if (q.allowOther && isOtherSelected(q, wrap) && v === "") {
        msg = "Please type your answer for 'Other'";
    } else {
        msg = checkValue(q, v);
        if (!msg && q.type === "password" && q.confirm && v !== "") {
            const c = wrap.querySelector(".confirm-field").value.trim();
            if (c === "") msg = "Please confirm your password";
            else if (c !== v) msg = "Passwords do not match";
        }
    }

    wrap.querySelector(".error").textContent = msg;
    wrap.classList.toggle("invalid", msg !== "");
    wrap.classList.toggle("ok", msg === "" && !isEmpty(v));
    return msg === "";
}

function validateAll() {
    let firstBad = null;
    document.querySelectorAll("#questions .q").forEach(wrap => {
        if (!validateQuestion(wrap) && !firstBad) firstBad = wrap;
    });
    if (firstBad) {
        firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
        const f = firstBad.querySelector("input, select, textarea");
        if (f) f.focus({ preventScroll: true });
    }
    return firstBad === null;
}

// ----- live validation (event delegation: ONE listener for the whole form) -----
const liveForm = $("liveForm");
function cardOf(e) { return e.target.closest ? e.target.closest(".q") : null; }

liveForm.addEventListener("input", e => {
    const w = cardOf(e);
    if (w && (submitted || w.classList.contains("touched"))) validateQuestion(w);
});
liveForm.addEventListener("change", e => {
    const w = cardOf(e);
    if (!w) return;
    // show / hide the "Other" text box
    const other = w.querySelector(".other-input");
    if (other) {
        const show = isOtherSelected(w._q, w);
        other.classList.toggle("hidden", !show);
        if (!show) other.value = "";
        else other.focus();
    }
    w.classList.add("touched");
    validateQuestion(w);
});
liveForm.addEventListener("focusout", e => {
    const w = cardOf(e);
    if (!w) return;
    if (e.relatedTarget && w.contains(e.relatedTarget)) return;   // still inside same card
    w.classList.add("touched");
    if (submitted || !isEmpty(readValue(w._q, w))) validateQuestion(w);
});

function resetForm() {
    liveForm.reset();
    submitted = false;
    document.querySelectorAll("#questions .q").forEach(w => {
        w.classList.remove("invalid", "ok", "touched");
        w.querySelector(".error").textContent = "";
        const o = w.querySelector(".other-input");
        if (o) o.classList.add("hidden");
    });
}
$("clearBtn").addEventListener("click", () => {
    if (confirm("This will clear all your answers. Continue?")) resetForm();
});

// ----- SUBMIT -----
liveForm.addEventListener("submit", async e => {
    e.preventDefault();                 // stop page reload
    submitted = true;
    if (!validateAll()) return;

    const btn = $("submitBtn");
    btn.disabled = true;

    // one response = list of answers (we keep the label too, so old data stays readable
    // even if you rename or delete the question later)
    const answers = [];
    for (const wrap of document.querySelectorAll("#questions .q")) {
        const q = wrap._q;
        let value = readValue(q, wrap);
        const secret = q.type === "password";
        if (secret && value !== "") value = await hashText(value);
        answers.push({ id: q.id, label: q.label, type: q.type, value: value, secret: secret });
    }

    try {
        await Store.addResponse(formId, { answers: answers });
        resetForm();
        $("liveForm").classList.add("hidden");
        $("successBox").classList.remove("hidden");
        $("successText").textContent = publicMode
            ? "Thank you! Your answers have been sent."
            : "Your answers are saved. Check them in the Responses section.";
        window.scrollTo(0, 0);
    } catch (err) {
        console.error(err);
        toast("Could not send. Check your internet / SCRIPT_URL and try again.");
    }
    btn.disabled = false;
});

$("anotherBtn").addEventListener("click", () => {
    if (publicMode) { renderForm(); $("liveForm").classList.remove("hidden"); $("successBox").classList.add("hidden"); window.scrollTo(0, 0); }
    else showView("fillView");
});


/* =====================================================================
   PART 4 : BUILDER (add / edit / move / delete questions)
   ===================================================================== */
let saveTimer;
function persist() {
    const s = $("saveState");
    s.textContent = "Saving...";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {          // wait until typing pauses, then save once
        try { await Store.saveForm(formId, schema); s.textContent = "All changes saved"; }
        catch (e) { console.error(e); s.textContent = "Save failed"; toast("Could not save changes"); }
    }, 1000);
}

// small field builders used inside every question card
function numField(q, key, labelText) {
    const box = el("label", "fld");
    box.append(el("span", "", labelText));
    const i = el("input"); i.type = "number"; i.value = q[key];
    i.addEventListener("input", () => {
        // min/max can be empty (= no limit), others default to 0
        q[key] = i.value === "" ? (key === "min" || key === "max" ? "" : 0) : Number(i.value);
        persist();
    });
    box.append(i);
    return box;
}
function textField(q, key, labelText) {
    const box = el("label", "fld");
    box.append(el("span", "", labelText));
    const i = el("input"); i.type = "text"; i.value = q[key] || "";
    i.addEventListener("input", () => { q[key] = i.value; persist(); });
    box.append(i);
    return box;
}
function checkField(q, key, labelText, extraClass) {
    const row = el("label", "check-row" + (extraClass ? " " + extraClass : ""));
    const c = el("input"); c.type = "checkbox"; c.checked = !!q[key];
    c.addEventListener("change", () => { q[key] = c.checked; persist(); });
    row.append(c, el("span", "", labelText));
    return row;
}

function buildCard(q, i) {
    const card = el("div", "b-card");

    // top row: number + question text + type dropdown
    const top = el("div", "b-top");
    top.append(el("span", "q-num small", i + 1));

    const label = el("input", "b-label");
    label.type = "text"; label.value = q.label; label.placeholder = "Question text";
    label.addEventListener("input", () => { q.label = label.value; persist(); });

    const type = el("select", "b-type");
    for (const t in TYPES) {
        const o = el("option", "", TYPES[t]); o.value = t;
        if (t === q.type) o.selected = true;
        type.append(o);
    }
    type.addEventListener("change", () => {
        q.type = type.value;
        if (isChoice(q.type) && q.options.length === 0) q.options = ["Option 1", "Option 2"];
        persist();
        renderBuilder();                         // settings below depend on the type
    });
    top.append(label, type);
    card.append(top);

    // middle: settings that depend on the type
    const body = el("div", "b-body");
    const t = q.type;

    if (isChoice(t)) {
        const box = el("label", "fld wide");
        box.append(el("span", "", "Options (one per line)"));
        const ta = el("textarea"); ta.rows = 4; ta.value = q.options.join("\n");
        ta.addEventListener("input", () => {
            q.options = ta.value.split("\n").map(s => s.trim()).filter(Boolean);
            persist();
        });
        box.append(ta);
        body.append(box);
        if (t !== "checkbox") body.append(checkField(q, "allowOther", 'Add an "Other" option with text box', "wide"));
    }
    if (t === "text" || t === "paragraph") body.append(numField(q, "minLength", "Minimum characters (0 = no limit)"));
    if (t === "text") body.append(checkField(q, "lettersOnly", "Letters and spaces only"));
    if (["text", "paragraph", "email", "phone", "number", "password"].includes(t)) body.append(textField(q, "placeholder", "Placeholder text"));
    if (t === "number") { body.append(numField(q, "min", "Minimum value")); body.append(numField(q, "max", "Maximum value")); }
    if (t === "date")   body.append(numField(q, "minAge", "Minimum age in years (0 = no limit)"));
    if (t === "password") body.append(checkField(q, "confirm", "Ask user to confirm password"));
    if (body.children.length) card.append(body);

    // bottom row: required + move / copy / delete
    const foot = el("div", "b-foot");
    foot.append(checkField(q, "required", "Required"));

    const btn = (text, fn, extra) => {
        const b = el("button", "btn ghost small" + (extra ? " " + extra : ""), text);
        b.type = "button"; b.addEventListener("click", fn);
        return b;
    };
    const move = dir => () => {
        const j = i + dir;
        if (j < 0 || j >= schema.questions.length) return;
        [schema.questions[i], schema.questions[j]] = [schema.questions[j], schema.questions[i]];
        persist(); renderBuilder();
    };
    foot.append(
        btn("\u2191 Up", move(-1)),
        btn("\u2193 Down", move(1)),
        btn("Duplicate", () => {
            const copy = JSON.parse(JSON.stringify(q));
            copy.id = uid();
            schema.questions.splice(i + 1, 0, copy);
            persist(); renderBuilder();
        }),
        btn("Delete", () => {
            if (confirm("Delete this question?")) {
                schema.questions.splice(i, 1);
                persist(); renderBuilder();
            }
        }, "danger")
    );
    card.append(foot);
    return card;
}

function renderBuilder() {
    $("bTitle").value = schema.title;
    $("bDesc").value = schema.description;
    const list = $("builderList");
    list.textContent = "";
    if (!schema.questions.length) list.append(el("div", "empty-note", "No questions yet. Add one using the buttons below."));
    schema.questions.forEach((q, i) => list.append(buildCard(q, i)));
}

$("bTitle").addEventListener("input", () => { schema.title = $("bTitle").value; persist(); });
$("bDesc").addEventListener("input",  () => { schema.description = $("bDesc").value; persist(); });

// "add question" chips
const chips = $("addChips");
for (const t in TYPES) {
    const b = el("button", "chip", "+ " + TYPES[t]);
    b.type = "button";
    b.addEventListener("click", () => {
        schema.questions.push(newQuestion(t));
        persist();
        renderBuilder();
        const last = $("builderList").lastElementChild;
        last.scrollIntoView({ behavior: "smooth", block: "center" });
        const inp = last.querySelector(".b-label");
        inp.focus(); inp.select();
    });
    chips.append(b);
}

$("resetSchemaBtn").addEventListener("click", () => {
    if (confirm("Replace all current questions with the default registration questions?")) {
        schema = defaultSchema();
        persist(); renderBuilder();
        toast("Default questions restored");
    }
});


/* =====================================================================
   PART 5 : RESPONSES
   ===================================================================== */
// Columns = current questions (except passwords) + old questions found in saved data
function getColumns(responses) {
    const cols = [], seen = new Set();
    schema.questions.forEach(q => {
        if (q.type !== "password") { cols.push({ id: q.id, label: q.label }); seen.add(q.id); }
    });
    responses.forEach(r => r.answers.forEach(a => {
        if (!a.secret && !seen.has(a.id)) { seen.add(a.id); cols.push({ id: a.id, label: a.label + " (removed)" }); }
    }));
    return cols;
}
function cellText(r, colId) {
    const a = r.answers.find(x => x.id === colId);
    if (!a) return "";
    return Array.isArray(a.value) ? a.value.join(", ") : a.value;
}

function renderResponses() {
    const data = responsesCache;
    const cols = getColumns(data);
    $("respTotal").textContent = data.length;
    $("respWord").textContent = data.length === 1 ? "response" : "responses";
    $("emptyMsg").classList.toggle("hidden", data.length > 0);
    $("respTable").classList.toggle("hidden", data.length === 0);

    const head = $("respHead"); head.textContent = "";
    const hr = el("tr");
    ["#", "Time"].concat(cols.map(c => c.label)).concat([""]).forEach(h => hr.append(el("th", "", h)));
    head.append(hr);

    const body = $("respBody"); body.textContent = "";
    data.forEach((r, i) => {
        const tr = el("tr");
        const cell = (label, text) => { const c = el("td", "", text); c.dataset.label = label; return c; };
        tr.append(cell("#", i + 1), cell("Time", new Date(r.submittedAt).toLocaleString()));
        cols.forEach(c => tr.append(cell(c.label, cellText(r, c.id))));

        const td = el("td");
        const del = el("button", "del", "Delete");
        del.addEventListener("click", () => {
            if (confirm("Delete this response?")) {
                Store.removeResponse(formId, r.id).then(refreshResponses).then(() => toast("Response deleted")).catch(() => toast("Delete failed"));
            }
        });
        td.append(del); tr.append(td);
        body.append(tr);
    });
}

$("deleteAllBtn").addEventListener("click", () => {
    if (!responsesCache.length) return;
    if (confirm("Delete ALL responses? This cannot be undone.")) {
        Store.clearResponses(formId).then(refreshResponses).then(() => toast("All responses deleted")).catch(() => toast("Delete failed"));
    }
});

/* ----- Export to real Excel (.xlsx) -----
   An .xlsx file is just a ZIP of small XML files. We build those XML files
   as strings and pack them with a tiny ZIP writer (no library, works offline). */

// CRC32 checksum (ZIP needs it for every file inside)
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// Pack [{name, data}] into one ZIP file (no compression = simplest and fine for small data)
function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    files.forEach(f => {
        const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);

        const lh = new DataView(new ArrayBuffer(30));          // local file header
        lh.setUint32(0, 0x04034b50, true);  lh.setUint16(4, 20, true);  lh.setUint16(6, 0x0800, true);
        lh.setUint16(8, 0, true);           lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
        lh.setUint32(14, crc, true);        lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
        lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), name, data);

        const ch = new DataView(new ArrayBuffer(46));          // central directory entry
        ch.setUint32(0, 0x02014b50, true);  ch.setUint16(4, 20, true);  ch.setUint16(6, 20, true);
        ch.setUint16(8, 0x0800, true);      ch.setUint16(10, 0, true);  ch.setUint16(12, dosTime, true);
        ch.setUint16(14, dosDate, true);    ch.setUint32(16, crc, true);
        ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);

        offset += 30 + name.length + data.length;
    });

    const cdSize = central.reduce((sum, a) => sum + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));             // end of central directory
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);  end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);       end.setUint32(16, offset, true);

    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]),
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// 0 -> A, 1 -> B, ... 26 -> AA
function colLetter(n) {
    let s = "";
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
}
function xmlEsc(v) {
    return String(v == null ? "" : v)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")   // characters XML does not allow
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// rows = array of arrays (first row = headers)
function buildXlsx(rows) {
    const colCount = rows[0].length;

    // column widths based on the longest text in each column
    let colsXml = "";
    for (let c = 0; c < colCount; c++) {
        const longest = Math.max(...rows.map(r => String(r[c] == null ? "" : r[c]).length));
        colsXml += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + Math.min(Math.max(longest + 3, 12), 50) + '" customWidth="1"/>';
    }

    // every value is stored as text, so phone numbers keep leading zeros and nothing is read as a formula
    let sheetData = "";
    rows.forEach((row, r) => {
        sheetData += '<row r="' + (r + 1) + '">';
        row.forEach((val, c) => {
            const text = String(val == null ? "" : val);
            if (text === "") return;                                  // skip empty cells
            sheetData += '<c r="' + colLetter(c) + (r + 1) + '" t="inlineStr"' + (r === 0 ? ' s="1"' : "") +
                         '><is><t xml:space="preserve">' + xmlEsc(text) + '</t></is></c>';
        });
        sheetData += "</row>";
    });

    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    return makeZip([
        { name: "[Content_Types].xml", data: HEAD +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>' },
        { name: "_rels/.rels", data: HEAD +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
        { name: "xl/workbook.xml", data: HEAD +
            '<workbook ' + NS + ' xmlns:r="' + REL + '"><sheets><sheet name="Responses" sheetId="1" r:id="rId1"/></sheets></workbook>' },
        { name: "xl/_rels/workbook.xml.rels", data: HEAD +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>' },
        // styles: style 0 = normal, style 1 = bold header with light blue background
        { name: "xl/styles.xml", data: HEAD +
            '<styleSheet ' + NS + '>' +
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
            '</styleSheet>' },
        { name: "xl/worksheets/sheet1.xml", data: HEAD +
            '<worksheet ' + NS + '>' +
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
            '<cols>' + colsXml + '</cols>' +
            '<sheetData>' + sheetData + '</sheetData>' +
            '<autoFilter ref="A1:' + colLetter(colCount - 1) + rows.length + '"/>' +
            '</worksheet>' }
    ]);
}

$("exportBtn").addEventListener("click", () => {
    const data = responsesCache;
    if (!data.length) { toast("No responses to export"); return; }

    const cols = getColumns(data);
    const rows = [["Submitted at"].concat(cols.map(c => c.label))];
    data.forEach(r => rows.push(
        [new Date(r.submittedAt).toLocaleString()].concat(cols.map(c => cellText(r, c.id)))
    ));

    const url = URL.createObjectURL(buildXlsx(rows));
    const a = document.createElement("a");
    a.href = url; a.download = (schema.title || "askly").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") + "_responses.xlsx"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Excel file downloaded");
});

function updateCount() { $("responseCount").textContent = responsesCache.length; }


/* =====================================================================
   PART 6 : NAVIGATION + START-UP
   ===================================================================== */
let snackTimer;
function toast(msg) {
    const s = $("snackbar");
    s.textContent = msg;
    s.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => s.classList.remove("show"), 2500);
}

const PAGE_NAMES = { formsView: "My Forms", fillView: "Preview Form", buildView: "Build Form", respView: "Responses" };

function showView(id) {
    $("pageTitle").textContent = PAGE_NAMES[id];
    ["formsView", "fillView", "buildView", "respView"].forEach(v => $(v).classList.toggle("hidden", v !== id));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));

    if (id === "fillView")  { renderForm(); $("liveForm").classList.remove("hidden"); $("successBox").classList.add("hidden"); }
    if (id === "formsView") renderFormsList();
    if (id === "buildView") { renderBuilder(); updateShareLink(); }
    if (id === "respView")  { renderResponses(); refreshResponses(); }
    window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-btn").forEach(b => b.addEventListener("click", () => {
    showView(b.dataset.view);
    if (isPhone()) setMenu(false);           // close the drawer after choosing a page
}));

/* ----- Hamburger menu -----
   Phones (<= 860px): menu slides in as a drawer over the page  (class "menu-open")
   Desktop          : menu collapses / expands                  (class "collapsed") */
const app = document.querySelector(".app");
const phoneQuery = window.matchMedia("(max-width: 860px)");
function isPhone() { return phoneQuery.matches; }

function setMenu(open) {
    if (isPhone()) {
        app.classList.toggle("menu-open", open);
        document.body.classList.toggle("no-scroll", open);   // stop page scrolling behind the drawer
    } else {
        app.classList.toggle("collapsed", !open);
    }
    $("menuBtn").setAttribute("aria-expanded", String(open));
}
function menuIsOpen() {
    return isPhone() ? app.classList.contains("menu-open") : !app.classList.contains("collapsed");
}
$("menuBtn").addEventListener("click", () => setMenu(!menuIsOpen()));
$("sideClose").addEventListener("click", () => setMenu(false));
$("backdrop").addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", e => { if (e.key === "Escape" && isPhone()) setMenu(false); });

// when screen size changes (rotate phone / resize window) reset the menu state
phoneQuery.addEventListener("change", () => {
    app.classList.remove("menu-open", "collapsed");
    document.body.classList.remove("no-scroll");
    $("menuBtn").setAttribute("aria-expanded", String(!isPhone()));
});
// start: closed on phones, open on desktop
$("menuBtn").setAttribute("aria-expanded", String(!isPhone()));


/* =====================================================================
   PART 7 : SHARE LINK, MY FORMS, LOGIN, START-UP
   ===================================================================== */
function shareUrl(id) {
    return location.origin + location.pathname + "?f=" + id;     // same page + form id
}
function updateShareLink() { $("shareLink").value = shareUrl(formId); }
$("copyLinkBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("shareLink").value); toast("Link copied"); }
    catch (e) { $("shareLink").select(); document.execCommand("copy"); toast("Link copied"); }
});
$("openLinkBtn").addEventListener("click", () => window.open($("shareLink").value, "_blank"));

// download the latest answers of the open form (also called every 15 seconds)
async function refreshResponses() {
    if (!formId || publicMode || !Store.loggedIn()) return;
    try {
        responsesCache = await Store.listResponses(formId);
        updateCount();
        if (!$("respView").classList.contains("hidden")) renderResponses();
    } catch (e) { console.error(e); }
}
$("refreshBtn").addEventListener("click", async () => { await refreshResponses(); toast("Refreshed"); });
setInterval(refreshResponses, 15000);

// open one of my forms
async function openForm(id) {
    const data = await Store.getForm(id);
    if (!data) { toast("Form not found"); return false; }
    formId = id;
    schema = { title: data.title || "", description: data.description || "", questions: data.questions || [] };
    localStorage.setItem(Store.PREF_KEY, id);
    responsesCache = [];
    updateCount();
    await refreshResponses();
    return true;
}

async function renderFormsList() {
    const forms = await Store.myForms();
    const box = $("formsList"); box.textContent = "";
    if (!forms.length) box.append(el("div", "empty-note", "No forms yet. Click + New form."));
    forms.forEach(f => {
        const row = el("div", "form-item" + (f.id === formId ? " current" : ""));
        const info = el("div", "fi-info");
        info.append(el("div", "fi-title", f.title || "Untitled form"),
                    el("div", "muted", f.count + " questions" + (f.id === formId ? " - open now" : "")));
        const btns = el("div", "fi-btns");
        const b = (text, fn, cls) => { const x = el("button", "btn ghost small" + (cls ? " " + cls : ""), text); x.type = "button"; x.addEventListener("click", fn); return x; };
        btns.append(
            b("Edit", async () => { if (await openForm(f.id)) showView("buildView"); }),
            b("Responses", async () => { if (await openForm(f.id)) showView("respView"); }),
            b("Copy link", async () => { try { await navigator.clipboard.writeText(shareUrl(f.id)); toast("Link copied"); } catch (e) { prompt("Copy this link:", shareUrl(f.id)); } }),
            b("Delete", async () => {
                if (!confirm("Delete this form AND all its responses?")) return;
                await Store.deleteForm(f.id);
                if (f.id === formId) {
                    const rest = await Store.myForms();
                    if (rest.length) await openForm(rest[0].id); else await createAndOpen();
                }
                renderFormsList(); toast("Form deleted");
            }, "danger")
        );
        row.append(info, btns); box.append(row);
    });
}
async function createAndOpen() {
    const id = await Store.createForm(defaultSchema());
    await openForm(id);
}
$("newFormBtn").addEventListener("click", async () => {
    const id = await Store.createForm({ title: "Untitled form", description: "", questions: [] });
    await openForm(id);
    showView("buildView");
    toast("New form created");
});

/* ----- owner login (just one password) ----- */
$("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("authError").textContent = "";
    $("loginBtn").disabled = true;
    try {
        await Store.login($("authPass").value);
        await startOwner();
    } catch (err) { $("authError").textContent = err.message; }
    $("loginBtn").disabled = false;
});
$("signOutBtn").addEventListener("click", () => {
    Store.logout();
    show("appRoot", false); show("authScreen", true);
    $("authPass").value = "";
});

/* ----- start-up: decide between PUBLIC link mode and OWNER mode ----- */
function show(id, on) { $(id).classList.toggle("hidden", !on); }

async function startPublic(id) {
    publicMode = true;
    document.body.classList.add("public-mode");
    try {
        const data = await Store.getForm(id);
        if (!data) { show("loadingScreen", false); show("notFoundScreen", true); return; }
        formId = id;
        schema = { title: data.title || "", description: data.description || "", questions: data.questions || [] };
        document.title = schema.title || "Form";
        ["formsView", "buildView", "respView"].forEach(v => $(v).classList.add("hidden"));
        $("fillView").classList.remove("hidden");
        renderForm();
        show("loadingScreen", false); show("appRoot", true);
    } catch (e) {
        console.error(e);
        show("loadingScreen", false); show("notFoundScreen", true);
    }
}

async function startOwner() {
    show("authScreen", false); show("loadingScreen", true);
    const forms = await Store.myForms();
    if (!forms.length) await createAndOpen();
    else {
        const saved = localStorage.getItem(Store.PREF_KEY);
        await openForm(forms.some(f => f.id === saved) ? saved : forms[0].id);
    }
    show("loadingScreen", false); show("appRoot", true);
    showView("formsView");
}

if (typeof SCRIPT_URL === "undefined" || SCRIPT_URL.indexOf("PASTE_") === 0) {
    show("loadingScreen", false);
    document.body.insertAdjacentHTML("afterbegin", '<p style="padding:30px;font-size:18px">Open <b>config.js</b> and paste your Web app URL in SCRIPT_URL.</p>');
} else {
    const linkId = new URLSearchParams(location.search).get("f");
    if (linkId) startPublic(linkId);                         // anyone with the link: no login
    else if (Store.loggedIn()) {                             // password still remembered in this tab
        startOwner().catch(() => { Store.logout(); show("loadingScreen", false); show("authScreen", true); });
    } else { show("loadingScreen", false); show("authScreen", true); }
}
