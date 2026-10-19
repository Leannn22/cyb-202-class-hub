/* CYB-202 class hub: UI rendering, timetable, shared-state editing, search, and focus timer. */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => Security.escapeHTML(value);
  const icon = (name, cls = "h-4 w-4") => `<i data-lucide="${esc(name)}" class="${cls}" aria-hidden="true"></i>`;
  const themeStorageKey = "cyb202_user_theme";
  const dismissedBannerKey = "cyb202_dismissed_banner";
  const themeNames = ["theme-emerald","theme-cyan","theme-violet","theme-amber","theme-rose"];
  const themeColors = {
    "theme-emerald":"#10b981",
    "theme-cyan":"#06b6d4",
    "theme-violet":"#8b5cf6",
    "theme-amber":"#f59e0b",
    "theme-rose":"#f43f5e"
  };
  const nav = [
    ["focus","Today's focus","sun"], ["schedule","Full timetable","calendar-days"],
    ["reminders","Class reminders","bell"], ["reviews","Subject know-hows","book-open-check"],
    ["terminal","Cyber terminal","terminal-square"], ["admin","Admin portal","settings-2"]
  ];
  const roomPrefixes = Object.keys(CYB202_DATA.roomGuide);
  let state = clone(CYB202_DATA.defaultState);
  let revision = null;
  let activeView = "focus";
  let reminderFilter = "All";
  let reminderDateFilter = "";
  let adminTab = "reminders";
  let currentSession = { authenticated:false };
  let apiOnline = false;
  let saveBusy = false;
  let searchResults = [];
  let searchIndex = 0;
  let timerSeconds = 25 * 60;
  let timerDuration = 25 * 60;
  let timerKind = "focus";
  let timerHandle = null;
  let audioContext = null;
  let audioSource = null;
  let lastActivity = Date.now();
  let lastStateSync = Date.now();
  let stateRefreshBusy = false;
  let aiMessages = [];
  let aiReminderDraft = null;
  let aiBusy = false;
  let aiPersona = "student";
  let aiRequestController = null;
  let selectedTheme = "theme-emerald";
  let themeStorageWarningShown = false;

  function toast(message, kind = "success") {
    const element = document.createElement("div");
    element.className = `toast ${kind === "error" ? "error" : kind === "warning" ? "warning" : ""}`;
    element.textContent = message;
    $("#toast-mount").append(element);
    window.setTimeout(() => element.remove(), 4200);
  }
  function setThemeColor(color) {
    const [red,green,blue]=color.slice(1).match(/.{2}/g).map(channel=>parseInt(channel,16));
    const root=document.documentElement;
    root.style.setProperty("--accent-primary",color);
    root.style.setProperty("--accent-glow",`rgba(${red},${green},${blue},.2)`);
    root.style.setProperty("--accent-surface",`rgba(${red},${green},${blue},.12)`);
    root.style.setProperty("--text-accent",`#${[red,green,blue].map(channel=>Math.round(channel+(255-channel)*.58).toString(16).padStart(2,"0")).join("")}`);
  }
  function applyTheme(theme,persist=true) {
    const isCustom=typeof theme==="string"&&/^custom:#[\da-f]{6}$/i.test(theme);
    if(!themeNames.includes(theme)&&!isCustom)theme="theme-emerald";
    const root=document.documentElement;
    for(const name of themeNames)root.classList.remove(name);
    for(const property of ["--accent-primary","--accent-glow","--accent-surface","--text-accent"])root.style.removeProperty(property);
    if(isCustom)setThemeColor(theme.slice(7));
    else root.classList.add(theme);
    selectedTheme=theme;
    const color=isCustom?theme.slice(7):themeColors[theme];
    $("#custom-theme-color").value=color;
    $$("[data-theme]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.theme===theme)));
    if(persist){
      try{localStorage.setItem(themeStorageKey,theme);}
      catch(error){
        console.error("Theme preference could not be saved locally:",error);
        if(!themeStorageWarningShown){toast("The theme changed for this visit, but browser storage prevented saving it.","warning");themeStorageWarningShown=true;}
      }
    }
    $("#appearance-status").textContent=isCustom?"Custom accent color selected.":`${theme.replace("theme-","")} theme selected.`;
  }
  function loadThemePreference() {
    try{
      const saved=localStorage.getItem(themeStorageKey);
      if(saved)applyTheme(saved,false);
    }catch(error){
      console.error("Theme preference could not be loaded locally:",error);
      toast("Saved appearance preferences could not be read from browser storage.","warning");
    }
  }
  function closeAppearancePanel() {
    $("#appearance-panel").hidden=true;
    $("#appearance-trigger").setAttribute("aria-expanded","false");
  }
  function refreshIcons(root = document) {
    if (window.lucide) window.lucide.createIcons({ root });
  }
  function timeText(value) {
    const [hour, minute] = value.split(":").map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2,"0")} ${hour < 12 ? "AM" : "PM"}`;
  }
  function dateText(value, options = { month:"short", day:"numeric" }) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date not set" : date.toLocaleDateString(undefined, options);
  }
  function localDateTime(value = new Date()) {
    const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0,16);
  }
  function minuteOfDay(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }
  function clockMinute(date = new Date()) { return date.getHours() * 60 + date.getMinutes(); }
  function weekdayKey(date = new Date()) { return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getDay()]; }
  function dayDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }
  function dayDateLabel(date) {
    if (dayDateKey(date) === dayDateKey()) return "Today";
    return date.toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  }
  function roomGuide(room) {
    const prefix = String(room || "").split("-")[0];
    return CYB202_DATA.roomGuide[prefix] || "See the HAU campus directory.";
  }
  function priorityTag(priority) {
    const css = priority === "High" ? "tag-high" : priority === "Medium" ? "tag-medium" : "tag-low";
    return `<span class="tag ${css}">${esc(priority)}</span>`;
  }
  function categoryTag(category) {
    const css = {
      "Quiz":"tag-quiz",
      "Exam":"tag-exam",
      "Assignment":"tag-assignment",
      "Project":"tag-project"
    }[category] || (category === "General" ? "tag-general" : "tag");
    return `<span class="tag ${css}">${esc(category)}</span>`;
  }
  function dateUntil(value) {
    if (!value) return "No deadline set";
    const milliseconds = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(milliseconds)) return "Date not set";
    if (milliseconds < 0) return "Overdue";
    if (milliseconds < 60_000) return "Due in under a minute";
    if (milliseconds < 3_600_000) return `Due in ${Math.ceil(milliseconds / 60_000)} min`;
    if (milliseconds < 86_400_000) return `Due in ${Math.floor(milliseconds / 3_600_000)} hr`;
    const days = Math.ceil(milliseconds / 86_400_000);
    return days === 1 ? "Tomorrow" : `In ${days} days`;
  }
  function viewHeading(kicker, title, copy, actions = "") {
    return `<div class="section-heading flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(copy)}</p></div>${actions ? `<div class="flex flex-wrap gap-2">${actions}</div>` : ""}</div>`;
  }
  function setConnection(online, message) {
    apiOnline = online;
    const badge = $("#connection-status");
    badge.className = `connection-badge ${online ? "online" : "offline"}`;
    badge.textContent = online ? "Shared · Live" : "Offline · Read-only";
    const notice = $("#offline-notice");
    notice.classList.toggle("hidden", online);
    notice.textContent = message || "The shared class server is unavailable. You're viewing the seed timetable; shared edits and updates are disabled.";
  }
  function syncAiWidgetPersona(authenticated) {
    const nextPersona=authenticated?"admin":"student";
    const personaChanged=aiPersona!==nextPersona;
    aiPersona=nextPersona;
    const titleEl=document.getElementById("ai-widget-title");
    const subtitleEl=document.getElementById("ai-widget-subtitle");
    const inputEl=document.getElementById("ai-chat-input");
    const footerEl=document.getElementById("ai-widget-footer");
    if(authenticated){
      if(titleEl)titleEl.textContent="Ai-Ai delas Alas";
      if(subtitleEl)subtitleEl.textContent="Admin Drafting & Form Assistant";
      if(inputEl)inputEl.placeholder="Ask Ai-Ai to draft a quiz, exam, assignment, or schedule change...";
      if(footerEl)footerEl.textContent="Ai-Ai assists admins with form drafting. Manual review required.";
    }else{
      if(titleEl)titleEl.textContent="BETTIE";
      if(subtitleEl)subtitleEl.textContent="Read-only study help for CYB-202";
      if(inputEl)inputEl.placeholder="Ask a CYB-202 study question...";
      if(footerEl)footerEl.textContent="BETTIE is read-only and can be inaccurate. Verify course details with your instructor.";
    }
    const widget=$("#ai-assistant");
    widget.dataset.persona=nextPersona;
    const avatarIcon=authenticated?"file-pen-line":"sparkles";
    $$("#ai-assistant-trigger [data-lucide], #ai-chat .ai-chat-icon [data-lucide]").forEach(element=>{
      element.setAttribute("data-lucide",avatarIcon);
    });
    refreshIcons(widget);
    const trigger=$("#ai-assistant-trigger");
    trigger.setAttribute("aria-label",authenticated
      ?"Open Ai-Ai delas Alas, the admin drafting assistant"
      :"Open BETTIE, the CYB-202 study assistant");
    $("#ai-chat-close").setAttribute("aria-label",authenticated?"Close Ai-Ai delas Alas":"Close BETTIE");
    $('label[for="ai-chat-input"]').textContent=authenticated
      ?"Ask Ai-Ai to draft an admin update"
      :"Ask BETTIE, the CYB-202 study assistant";
    $("#ai-quick-prompts").hidden=authenticated;
    $("#ai-quick-prompts").classList.toggle("hidden",authenticated);
    if(personaChanged&&aiRequestController){
      aiRequestController.abort();
      aiRequestController=null;
      aiBusy=false;
      const input=$("#ai-chat-input"),send=$("#ai-chat-send");
      input.disabled=false;
      send.disabled=false;
      send.classList.remove("is-loading");
      send.setAttribute("aria-label","Send message");
      send.innerHTML=icon("send");
      refreshIcons(send);
    }
    if(personaChanged){
      aiMessages=[];
      aiReminderDraft=null;
      $("#ai-chat-messages").replaceChildren();
    }
    if(personaChanged&&!$("#ai-chat").hidden)appendAiMessage("assistant",authenticated
      ?"Hi! I’m Ai-Ai delas Alas, your administrator drafting helper. Send a request to prepare a reminder, schedule override, or reviewer note for review in the Admin Portal."
      :"Hi! I’m BETTIE, your read-only CYB-202 study assistant. I can help with your timetable, reminders, subject know-hows, and Cyber Terminal references.");
  }
  function setRoleIndicator() {
    const label = $("#role-label");
    const button = $("#admin-trigger");
    const isAdmin = Security.isAdminAuthenticated();
    label.textContent = isAdmin ? `Admin View · ${currentSession.adminName}` : "Student View · Read-Only";
    button.classList.toggle("authorized", isAdmin);
    button.setAttribute("aria-label", isAdmin ? `Admin view authorized for ${currentSession.adminName}; click to sign out` : "Student view, read only; click to sign in as an administrator");
    $("#tab-admin").classList.toggle("admin-active", isAdmin);
    syncAiWidgetPersona(isAdmin);
  }
  function renderNavigation() {
    $("#view-root").setAttribute("aria-labelledby",`tab-${activeView}`);
    for (const [id] of nav) {
      const button = $(`#tab-${id}`);
      const active = id === activeView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
    }
  }
  function switchView(view) {
    if (!nav.some(([id]) => id === view)) return;
    activeView = view;
    renderNavigation();
    renderActiveView();
    window.scrollTo({ top:0, behavior:"smooth" });
  }
  function renderActiveView() {
    const renderers = {
      focus:renderToday, schedule:renderSchedule, reminders:renderReminders,
      reviews:renderReviews, terminal:renderTerminal, admin:renderAdmin
    };
    const render = renderers[activeView] || renderToday;
    $("#view-root").innerHTML = render();
    refreshIcons($("#view-root"));
  }
  function nextOccurrence(now = new Date(), includeCurrent = true) {
    const candidates = [];
    for (let offset = 0; offset <= 7; offset++) {
      const date = new Date(now);
      date.setHours(0,0,0,0);
      date.setDate(date.getDate() + offset);
      const day = weekdayKey(date);
      const dateKey = dayDateKey(date);
      for (const meeting of state.schedule.filter(item => item.day === day)) {
        const override = state.scheduleOverrides.find(item =>
          item.date === dateKey && (item.scheduleId === meeting.id || item.scheduleId === "*")
        );
        const start = new Date(date);
        const end = new Date(date);
        const [startHour,startMinute] = meeting.start.split(":").map(Number);
        const [endHour,endMinute] = meeting.end.split(":").map(Number);
        start.setHours(startHour,startMinute,0,0);
        end.setHours(endHour,endMinute,0,0);
        if (override?.status === "cancelled") continue;
        if (override?.status === "absence" && !override.message) continue;
        if (start >= now || (includeCurrent && end > now)) {
          candidates.push({ ...meeting, date, start, end, override });
        }
      }
    }
    candidates.sort((a,b) => a.start - b.start);
    return candidates[0] || null;
  }
  function trackerMarkup(now = new Date()) {
    const upcoming = nextOccurrence(now);
    if (!upcoming) return `<article class="panel-card p-5"><div class="eyebrow">Live timetable</div><h2 class="mt-2 text-lg font-bold">No upcoming class found</h2><p class="mt-2 text-sm text-slate-400">Check the timetable or confirm schedule changes with your instructor.</p></article>`;
    const nowMs = now.getTime();
    const inProgress = nowMs >= upcoming.start.getTime() && nowMs < upcoming.end.getTime();
    const gapMinutes = Math.max(0, Math.floor((upcoming.start.getTime() - nowMs) / 60_000));
    const duration = upcoming.end.getTime() - upcoming.start.getTime();
    const progress = inProgress ? Math.min(100, Math.max(0, Math.floor((nowMs - upcoming.start.getTime()) / duration * 100))) : 0;
    const status = inProgress ? "Now in session" : gapMinutes < 60 ? `Up next in ${gapMinutes} min` : `Up next · ${dayDateLabel(upcoming.date)}`;
    const breakText = inProgress ? `Class ends in ${Math.max(1, Math.ceil((upcoming.end - now) / 60_000))} min` : gapMinutes >= 60 ? `Study gap · ${Math.floor(gapMinutes/60)}h ${gapMinutes%60}m` : "Use the short gap to get settled";
    return `<article class="panel-card relative overflow-hidden p-5 md:p-6">
      <div class="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-emerald-400/10 blur-3xl"></div>
      <div class="relative flex items-center justify-between gap-3"><span class="eyebrow">Live timetable · ${esc(dayDateLabel(upcoming.date))}</span><span class="tag ${inProgress?"tag-low":"tag"}">${inProgress?'<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"></span>NOW':"NEXT"}</span></div>
      <div class="relative mt-5"><div class="text-xs text-emerald-200">${esc(status)}</div><h2 class="mt-1 text-2xl font-extrabold tracking-tight">${esc(upcoming.subject)}</h2><p class="mt-1 text-sm text-slate-300">${esc(upcoming.title)}</p></div>
      <div class="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
        <span class="flex items-center gap-1.5">${icon("clock")} ${esc(timeText(upcoming.start.toTimeString().slice(0,5)))}–${esc(timeText(upcoming.end.toTimeString().slice(0,5)))}</span>
        <span class="group relative flex cursor-help items-center gap-1.5" title="${esc(roomGuide(upcoming.override?.status==="room" ? upcoming.override.room : upcoming.room))}">${icon("map-pin")} ${esc(upcoming.override?.status === "online" ? "Online / MS Teams" : upcoming.override?.status === "room" ? upcoming.override.room : upcoming.room)} <span class="text-slate-600">ⓘ</span></span>
        <span class="flex items-center gap-1.5">${icon("coffee")} ${esc(breakText)}</span>
      </div>
      ${upcoming.override?.message ? `<p class="relative mt-3 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">${esc(upcoming.override.message)}</p>` : ""}
      ${inProgress ? `<div class="relative mt-5"><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div><div class="mt-2 flex justify-between text-[10px] text-slate-500"><span>Class progress</span><span>${progress}%</span></div></div>` : ""}
    </article>`;
  }
  function todayTimeline(now = new Date()) {
    const today = weekdayKey(now);
    const todayDate = dayDateKey(now);
    const meetings = state.schedule.filter(item => item.day === today).slice().sort((a,b) => a.start.localeCompare(b.start));
    if (!meetings.length) return `<div class="empty-state">No scheduled CYB-202 classes today.</div>`;
    let previousEnd = null;
    const rows=meetings.map(meeting => {
      const gapMinutes=previousEnd===null?0:minuteOfDay(meeting.start)-previousEnd;
      previousEnd=minuteOfDay(meeting.end);
      const override = state.scheduleOverrides.find(item=>item.date===todayDate&&(item.scheduleId===meeting.id||item.scheduleId==="*"));
      const active = !override && clockMinute() >= minuteOfDay(meeting.start) && clockMinute() < minuteOfDay(meeting.end);
      const canceled = override?.status === "cancelled";
      const room = override?.status==="online" ? "Online / MS Teams" : override?.status==="room" ? override.room : meeting.room;
      return `${gapMinutes>0?`<div class="ml-5 flex items-center gap-2 py-0.5 text-[10px] text-violet-200">${icon("coffee","h-3 w-3")} Break / study gap · ${gapMinutes} min</div>`:""}<article class="relative flex gap-3"><span class="timeline-dot ${active?"active":""}"></span><div class="schedule-slot min-w-0 flex-1 rounded-xl border border-slate-700/40 p-3 ${active?"active":""} ${canceled?"opacity-50":""}">
        <div class="flex flex-wrap items-center justify-between gap-2"><span class="text-xs font-semibold">${esc(timeText(meeting.start))}–${esc(timeText(meeting.end))}</span>${active?'<span class="tag tag-low">Now</span>':canceled?'<span class="tag tag-critical">Cancelled</span>':""}</div>
        <h3 class="mt-1 text-sm font-semibold">${esc(meeting.subject)} · ${esc(meeting.title)}</h3>
        <div class="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400"><span>${esc(room)}</span>${override?.message?`<span class="text-amber-200">${esc(override.message)}</span>`:""}</div>
      </div></article>`;
    });
    return `<div class="relative space-y-3 pl-1"><span class="timeline-line" aria-hidden="true"></span>${rows.join("")}</div>`;
  }
  function reminderCard(item, actions = true) {
    const urgent = item.priority === "High";
    const url = Security.safeExternalURL(item.externalLink);
    return `<article class="panel-card reminder-card p-4 ${item.pinned?"pinned":""} ${urgent?"urgent":""}">
      <div class="flex items-start justify-between gap-3"><div class="flex flex-wrap items-center gap-1.5">${item.pinned?`<span class="tag tag-medium">${icon("pin","h-3 w-3")} Pinned</span>`:""}${categoryTag(item.category)}${priorityTag(item.priority)}</div>
        ${actions && Security.isAdminAuthenticated()?`<div class="flex gap-1"><button class="btn !p-2" data-action="edit-reminder" data-id="${esc(item.id)}" aria-label="Edit reminder">${icon("pencil")}</button><button class="btn !p-2" data-action="pin-reminder" data-id="${esc(item.id)}" aria-label="Toggle pin">${icon(item.pinned?"pin-off":"pin")}</button><button class="btn btn-danger !p-2" data-action="delete-reminder" data-id="${esc(item.id)}" aria-label="Delete reminder">${icon("trash-2")}</button></div>`:""}
      </div>
      <h3 class="mt-3 font-semibold">${esc(item.title)}</h3>
      <div class="mt-1 text-[11px] text-slate-400">${esc(item.subject || "ALL")} · ${item.dueAt?`${esc(dateText(item.dueAt,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))} · ${esc(dateUntil(item.dueAt))}`:"No deadline provided"}</div>
      <p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">${esc(item.description)}</p>
      ${url?`<a class="mt-3 inline-flex items-center gap-1.5 text-xs text-cyan-200 hover:text-cyan-100" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon("external-link")} Open class resource</a>`:""}
    </article>`;
  }
  function renderToday() {
    const now = new Date();
    const soon = state.reminders.filter(item=>item.dueAt&&item.priority==="High"&&new Date(item.dueAt).getTime()-now.getTime()<48*60*60*1000)
      .sort((a,b)=>(a.dueAt||"").localeCompare(b.dueAt||"")).slice(0,4);
    const roomCount = state.schedule.filter(item=>item.day===weekdayKey(now)).length;
    return `${viewHeading("Holy Angel University · Section CYB-202","Today's focus","One shared class dashboard for timetable changes, class-wide notices, reviewer notes, and the next thing on the section's radar.",
      `<button class="btn btn-primary" data-view="reminders">${icon("bell")} Class reminders</button><button class="btn" data-action="open-focus">${icon("timer")} Focus timer</button>`)}
      <div class="grid gap-4 xl:grid-cols-5">
        <div class="space-y-4 xl:col-span-3"><div id="today-tracker">${trackerMarkup(now)}</div>
          <section class="panel-card p-5"><div class="mb-4 flex items-end justify-between gap-3"><div><div class="eyebrow">Today's timeline</div><h2 class="mt-1 text-lg font-bold">${esc(now.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}))}</h2></div><span class="tag">${roomCount} ${roomCount===1?"class":"classes"}</span></div><div id="today-timeline">${todayTimeline(now)}</div></section>
        </div>
        <div class="space-y-4 xl:col-span-2">
          <section class="panel-card p-5"><div class="flex items-center justify-between gap-2"><div><div class="eyebrow">High priority · under 48 hours</div><h2 class="mt-1 text-lg font-bold">Class reminders</h2></div><button class="btn !px-2.5 !py-2" data-view="reminders" aria-label="View all reminders">${icon("arrow-right")}</button></div>
            <div class="mt-4 space-y-3">${soon.length?soon.map(item=>`<div class="border-t border-slate-700/40 pt-3 first:border-0 first:pt-0">${reminderCard(item,false)}</div>`).join(""):`<div class="empty-state">No high-priority reminders are due in the next 48 hours.</div>`}</div>
          </section>
          <section class="panel-card p-5"><div class="eyebrow">Focus room</div><div class="mt-1 flex items-center justify-between"><h2 class="text-lg font-bold">Pomodoro session</h2><span id="timer-kind-label" class="tag tag-low">${timerKind==="focus"?"Focus":"Break"}</span></div><div id="timer-display" class="timer-face mt-5 text-center text-emerald-200">${timerText()}</div><div class="mt-5 flex justify-center gap-2"><button class="btn btn-primary" data-action="timer-toggle">${icon(timerHandle?"pause":"play")} ${timerHandle?"Pause":"Start focus"}</button><button class="btn" data-action="timer-reset">Reset</button></div>
            <div class="mt-4 grid grid-cols-3 gap-2"><button class="btn !px-2 !text-xs" data-action="sound" data-sound="rain">${icon("cloud-rain")} Cyber rain</button><button class="btn !px-2 !text-xs" data-action="sound" data-sound="brown">${icon("waves")} Brown noise</button><button class="btn !px-2 !text-xs" data-action="sound-stop">${icon("volume-x")} Stop</button></div><p class="mt-3 text-center text-[10px] text-slate-500">Sound is generated locally; stop it whenever you like.</p>
          </section>
        </div>
      </div>`;
  }
  function renderSchedule() {
    const days = ["Mon","Tue","Wed","Thu","Fri","Sat"];
    const names = {Mon:"Monday",Tue:"Tuesday",Wed:"Wednesday",Thu:"Thursday",Fri:"Friday",Sat:"Saturday"};
    return `${viewHeading("Class timetable","Full CYB-202 timetable","Official timetable seed from the supplied class schedule. Admins can post date-specific room changes, online shifts, absences, or cancellations.",Security.isAdminAuthenticated()?`<button class="btn btn-primary" data-admin-tab="schedule">${icon("pencil")} Manage overrides</button>`:"")}
      <div class="mb-4 flex flex-wrap gap-2">${roomPrefixes.map(prefix=>`<span class="tag" title="${esc(CYB202_DATA.roomGuide[prefix])}">${esc(prefix)} · ${esc(CYB202_DATA.roomGuide[prefix])}</span>`).join("")}</div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${days.map(day=>{
        const list=state.schedule.filter(item=>item.day===day).sort((a,b)=>a.start.localeCompare(b.start));
        return `<section class="panel-card p-4"><div class="mb-3 flex items-center justify-between"><h2 class="font-bold">${names[day]}</h2><span class="tag">${list.length} ${list.length===1?"class":"classes"}</span></div>
          <div class="space-y-2">${list.map(item=>{
            const overrides=state.scheduleOverrides.filter(o=>o.scheduleId===item.id).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,2);
            return `<article class="rounded-xl border border-slate-700/40 bg-slate-950/20 p-3"><div class="text-xs font-semibold text-emerald-200">${esc(timeText(item.start))}–${esc(timeText(item.end))}</div><h3 class="mt-1 text-sm font-semibold">${esc(item.title)}</h3><div class="text-[11px] text-slate-400">${esc(item.subject)} · Code ${esc(item.code)}</div><div class="mt-2 flex items-center gap-1.5 text-xs text-slate-300" title="${esc(roomGuide(item.room))}">${icon("map-pin","h-3.5 w-3.5 text-cyan-200")} ${esc(item.room)}</div>${overrides.length?`<div class="mt-2 border-t border-slate-700/40 pt-2 text-[10px] text-amber-200">${overrides.map(o=>`${esc(o.date)} · ${esc(o.status)}${o.room?` · ${esc(o.room)}`:""}${o.message?` · ${esc(o.message)}`:""}`).join("<br>")}</div>`:""}</article>`;
          }).join("")}</div></section>`;
      }).join("")}</div>`;
  }
  function filteredReminders() {
    return state.reminders.filter(item=>{
      if (reminderFilter === "Urgent") return item.priority === "High";
      if (reminderFilter !== "All" && item.category !== reminderFilter) return false;
      if (reminderDateFilter) {
        if (!item.dueAt) return false;
        const due = new Date(item.dueAt);
        if (Number.isNaN(due.getTime()) || dayDateKey(due) !== reminderDateFilter) return false;
      }
      return true;
    }).slice().sort((a,b)=>Number(b.pinned)-Number(a.pinned) || dueSort(a,b));
  }
  function dueSort(a,b) {
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ad-bd;
  }
  function renderReminders() {
    const filters=["All",...CYB202_DATA.reminderCategories,"Urgent"];
    const dateFilterTemplate=$("#reminder-date-filter-template");
    const dateControls=dateFilterTemplate.innerHTML
      .replace('id="reminder-date-filter"',`id="reminder-date-filter" value="${esc(reminderDateFilter)}"`)
      .replace("data-reminder-date-clear hidden",`data-reminder-date-clear${reminderDateFilter?"":" hidden"}`);
    return `${viewHeading("Section-wide announcements","Class reminders","Shared notices, exam coverage, assignment deadlines, and important links. Changes require an authenticated class administrator.",Security.isAdminAuthenticated()?`<button class="btn btn-primary" data-action="new-reminder">${icon("plus")} New reminder</button>`:"")}
      <div class="mb-4 flex flex-col gap-3">
        <div class="flex flex-wrap gap-2">${filters.map(filter=>`<button class="btn ${reminderFilter===filter?"btn-primary":""}" data-filter-reminders="${esc(filter)}" aria-pressed="${reminderFilter===filter}">${filter==="Urgent"?icon("triangle-alert"):filter==="All"?icon("list-filter"):icon("tag")} ${esc(filter)}</button>`).join("")}</div>
        ${dateControls}
      </div>
      <div id="reminder-list" class="grid gap-3 lg:grid-cols-2">${filteredReminders().map(item=>reminderCard(item)).join("")||`<div class="empty-state lg:col-span-2">No reminders in this filter.</div>`}</div>`;
  }
  function renderReviews() {
    return `${viewHeading("Subject review & know-hows","Course-by-course refresher","Lecture anchors, formulas, concepts, and code syntax for the section. Confirm course-specific content with the instructor.",Security.isAdminAuthenticated()?`<button class="btn btn-primary" data-action="new-review">${icon("plus")} Add review guide</button>`:"")}
      <div class="grid gap-3 lg:grid-cols-2">${state.reviews.map(item=>`<details class="panel-card group p-5">
        <summary class="list-none cursor-pointer"><div class="flex items-start justify-between gap-3"><div><div class="eyebrow">${esc(item.subject)}</div><h2 class="mt-1 font-bold">${esc(item.title)}</h2></div><span class="text-slate-500 transition-transform group-open:rotate-180">${icon("chevron-down")}</span></div><p class="mt-3 text-sm leading-relaxed text-slate-400">${esc(item.summary)}</p></summary>
        <div class="mt-4 border-t border-slate-700/40 pt-4"><div class="grid gap-4 sm:grid-cols-2"><div><h3 class="mb-2 text-xs font-semibold">Key lecture topics</h3><ul class="space-y-1.5">${item.topics.map(topic=>`<li class="text-xs text-slate-400"><span class="mr-2 text-emerald-300">•</span>${esc(topic)}</li>`).join("")}</ul></div><div><h3 class="mb-2 text-xs font-semibold">Formula sheet / anchor</h3><pre class="code-sample">${esc(item.formulas)}</pre></div></div>
          ${item.snippets.length?`<div class="mt-4"><h3 class="mb-2 text-xs font-semibold">Syntax snippets</h3>${item.snippets.map((snippet,index)=>`<div class="relative mb-2"><pre class="code-sample pr-12">${esc(snippet)}</pre><button class="btn absolute right-2 top-2 !p-2" data-action="copy-text" data-value="${esc(snippet)}" aria-label="Copy code snippet">${icon("copy","h-3.5 w-3.5")}</button></div>`).join("")}</div>`:""}
          <div class="mt-3 flex flex-wrap gap-3">${item.downloadUrl&&Security.safeExternalURL(item.downloadUrl)?`<a class="inline-flex items-center gap-1.5 text-xs text-cyan-200" href="${esc(Security.safeExternalURL(item.downloadUrl))}" target="_blank" rel="noopener noreferrer">${icon("external-link")} Open linked guide</a>`:""}<button class="inline-flex items-center gap-1.5 text-xs text-cyan-200" data-action="download-guide" data-id="${esc(item.id)}">${icon("download")} Download text guide</button></div>
          ${Security.isAdminAuthenticated()?`<div class="mt-4 flex gap-2 border-t border-slate-700/40 pt-3"><button class="btn" data-action="edit-review" data-id="${esc(item.id)}">${icon("pencil")} Edit</button><button class="btn btn-danger" data-action="delete-review" data-id="${esc(item.id)}">${icon("trash-2")} Delete</button></div>`:""}
        </div></details>`).join("")||`<div class="empty-state lg:col-span-2">No subject guides are available.</div>`}</div>`;
  }
  function renderTerminal() {
    return `${viewHeading("Reference drawer","Cyber terminal cheat sheets","Quick references for authorized coursework and lab environments. These are examples; follow your instructor's lab scope.",Security.isAdminAuthenticated()?`<button class="btn btn-primary" data-action="new-cheat">${icon("plus")} Add cheat sheet</button>`:"")}
      <div class="grid gap-3 lg:grid-cols-2">${state.cheatSheets.map(item=>`<article class="panel-card p-4"><div class="flex items-start justify-between gap-3"><div><div class="eyebrow">${esc(item.group)}</div><h2 class="mt-1 font-bold">${esc(item.title)}</h2></div><button class="btn !p-2" data-action="copy-text" data-value="${esc(item.code)}" aria-label="Copy ${esc(item.title)}">${icon("copy")}</button></div><p class="mt-2 text-xs leading-relaxed text-slate-400">${esc(item.description)}</p><pre class="code-sample mt-3">${esc(item.code)}</pre>${Security.isAdminAuthenticated()?`<div class="mt-3 flex gap-2"><button class="btn" data-action="edit-cheat" data-id="${esc(item.id)}">${icon("pencil")} Edit</button><button class="btn btn-danger" data-action="delete-cheat" data-id="${esc(item.id)}">${icon("trash-2")} Delete</button></div>`:""}</article>`).join("")}</div>`;
  }
  function renderAdmin() {
    if (!Security.isAdminAuthenticated()) {
      return `${viewHeading("Administrator access","Admin command portal","Shared class changes are protected by server-side authentication. Students can browse this hub without signing in.")}<section class="panel-card mx-auto max-w-2xl p-6 md:p-8"><div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-400/10 text-violet-200">${icon("shield-lock","h-6 w-6")}</div><h2 class="mt-4 text-xl font-bold">Administrator sign-in required</h2><p class="mt-2 text-sm leading-relaxed text-slate-400">Authorized admins: Leander Dwayne Darell S. Guina, Class Representative, and Class Vice President. Credentials are set through the private server setup command; passphrases and password hashes are never sent to the browser.</p><button class="btn btn-primary mt-5" data-action="login">${icon("key-round")} Sign in securely</button></section>`;
    }
    const tabs = [["reminders","Reminders"],["schedule","Schedule changes"],["reviews","Review guides"],["banner","Emergency banner"],["ai","Ai-Ai delas Alas"],["backup","Backup & reset"]];
    return `${viewHeading("Admin View · Authorized","Admin command portal","Publish updates to the whole section. Every change is validated and saved to shared server storage.",`<button class="btn" data-action="logout">${icon("log-out")} Sign out</button>`)}
      <div class="mb-4 flex gap-2 overflow-x-auto pb-1">${tabs.map(([id,label])=>`<button class="btn whitespace-nowrap ${id===adminTab?"btn-primary":""}" data-admin-tab="${id}" aria-pressed="${id===adminTab}">${esc(label)}</button>`).join("")}</div>
      <section class="panel-card p-4 md:p-5">${renderAdminTab()}</section>`;
  }
  function renderAdminTab() {
    if (adminTab === "reminders") return `<div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="text-lg font-bold">Class-wide reminders</h2><p class="text-xs text-slate-400">Create, edit, pin, and remove announcements.</p></div><button class="btn btn-primary" data-action="new-reminder">${icon("plus")} New reminder</button></div><div class="space-y-3">${state.reminders.map(item=>reminderCard(item)).join("")||`<div class="empty-state">No reminders yet.</div>`}</div>`;
    if (adminTab === "schedule") return `<div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="text-lg font-bold">Temporary schedule changes</h2><p class="text-xs text-slate-400">Post a dated room change, online shift, absence, or cancellation. The base timetable remains intact.</p></div><button class="btn btn-primary" data-action="new-override">${icon("plus")} Add override</button></div><div class="mb-4 flex flex-wrap items-center justify-between gap-2"><span class="text-xs text-slate-400">${state.scheduleOverrides.length} active record(s)</span><button class="btn btn-danger" data-action="reset-overrides">${icon("rotate-ccw")} Reset to official timetable</button></div><div class="space-y-2">${state.scheduleOverrides.map(item=>`<article class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-700/40 p-3"><div><span class="tag">${esc(item.date)}</span><span class="tag ml-1">${esc(item.status)}</span><h3 class="mt-2 text-sm font-semibold">${esc(item.scheduleId==="*"?"All classes":state.schedule.find(s=>s.id===item.scheduleId)?.title||"Removed class")}</h3><p class="mt-1 text-xs text-slate-400">${esc(item.room)} ${esc(item.message)}</p></div><div class="flex gap-2"><button class="btn !p-2" data-action="edit-override" data-id="${esc(item.id)}" aria-label="Edit override">${icon("pencil")}</button><button class="btn btn-danger !p-2" data-action="delete-override" data-id="${esc(item.id)}" aria-label="Delete override">${icon("trash-2")}</button></div></article>`).join("")||`<div class="empty-state">No temporary schedule changes.</div>`}</div>`;
    if (adminTab === "reviews") return `<div class="mb-4 flex items-center justify-between gap-3"><div><h2 class="text-lg font-bold">Subject know-hows</h2><p class="text-xs text-slate-400">Maintain section lecture summaries, formulas, topics, and snippets.</p></div><button class="btn btn-primary" data-action="new-review">${icon("plus")} Add guide</button></div><div class="space-y-2">${state.reviews.map(item=>`<article class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/40 p-3"><div><div class="eyebrow">${esc(item.subject)}</div><div class="mt-1 text-sm font-semibold">${esc(item.title)}</div></div><div class="flex gap-2"><button class="btn" data-action="edit-review" data-id="${esc(item.id)}">${icon("pencil")} Edit</button><button class="btn btn-danger !p-2" data-action="delete-review" data-id="${esc(item.id)}" aria-label="Delete guide">${icon("trash-2")}</button></div></article>`).join("")}</div>`;
    if (adminTab === "banner") return `<div class="max-w-2xl"><div class="eyebrow">Emergency broadcast</div><h2 class="mt-1 text-lg font-bold">Section-wide alert banner</h2><p class="mt-2 text-xs leading-relaxed text-slate-400">Reserve for urgent changes such as suspensions, room shifts, or safety updates. Confirm facts through official HAU channels.</p><p class="mt-4 text-sm font-semibold" role="status" aria-live="polite">Status: <span class="${state.emergencyBanner.active?"text-rose-300":"text-slate-400"}">${state.emergencyBanner.active?"ACTIVE":"INACTIVE"}</span></p>${state.emergencyBanner.active?`<div class="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100"><strong class="mr-2 text-xs uppercase">Live banner</strong>${esc(state.emergencyBanner.message)}</div>`:`<div class="mt-3 rounded-xl border border-slate-700/40 p-4 text-sm text-slate-500">No emergency notice is active.</div>`}<form class="mt-4 space-y-3" data-form="emergency"><label class="field-label">Banner message<textarea class="field min-h-24" name="message" maxlength="2000" placeholder="Example: The instructor has moved today's class to an online session." required>${esc(state.emergencyBanner.message)}</textarea></label><div class="flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">${icon("radio")} Publish / Update Banner</button><button class="btn btn-danger" type="button" data-action="deactivate-banner">${icon("circle-stop")} Deactivate Banner</button></div></form></div>`;
    if (adminTab === "ai") return `<div class="max-w-3xl"><div class="eyebrow">Administrator-only drafting assistant</div><h2 class="mt-1 text-lg font-bold">Ai-Ai delas Alas</h2><p class="mt-2 text-xs leading-relaxed text-slate-400">Generate drafts for reminders, subject know-hows, or schedule overrides. The assistant cannot save changes. Review and edit the JSON below, then explicitly save through the standard protected class-state endpoint.</p><form class="mt-4 space-y-3" data-form="admin-ai"><div class="grid gap-3 sm:grid-cols-2"><label class="field-label">Draft type<select class="field" name="type"><option value="reminder">Reminder</option><option value="review">Subject know-how / review guide</option><option value="scheduleOverride">Schedule override</option></select></label><label class="field-label">Draft instructions<input id="admin-ai-prompt" class="field" name="prompt" maxlength="2000" placeholder="Describe the details to include…" required></label></div><button class="btn btn-primary" type="submit">${icon("sparkles")} Generate draft</button></form><label class="field-label mt-4 block">Review and edit draft JSON<textarea id="admin-ai-result" class="field mt-2 min-h-64 font-mono text-xs" maxlength="20000" spellcheck="false" placeholder="The generated draft will appear here. Review all values before saving."></textarea></label><p id="admin-ai-status" class="mt-2 min-h-5 text-xs text-slate-400" role="status" aria-live="polite"></p><button class="btn btn-primary mt-3" type="button" data-action="save-ai-draft">${icon("check")} Save reviewed draft</button></div>`;
    return `<div class="grid gap-4 lg:grid-cols-2"><article><div class="eyebrow">Shared data</div><h2 class="mt-1 text-lg font-bold">Backup & synchronization</h2><p class="mt-2 text-xs leading-relaxed text-slate-400">Export a versioned snapshot or import a validated JSON file. Imports replace shared class data for every visitor after server validation.</p><button class="btn btn-primary mt-4" data-action="export">${icon("download")} Export class state</button><div id="drop-zone" class="drop-zone mt-4" tabindex="0">Drop a class-state JSON file here, or <button class="underline text-emerald-200" data-action="import">choose a file</button></div></article><article class="rounded-xl border border-rose-300/20 bg-rose-400/5 p-4"><div class="eyebrow text-rose-200">Caution</div><h2 class="mt-1 text-lg font-bold">Reset shared state</h2><p class="mt-2 text-xs leading-relaxed text-slate-400">This restores the official seed state and removes all shared announcements, edits, and schedule overrides.</p><button class="btn btn-danger mt-4" data-action="hard-reset">${icon("rotate-ccw")} Reset to defaults</button></article></div><p class="mt-5 text-[11px] text-slate-500">Schema v${state.schemaVersion} · Revision ${revision ?? "—"} · Updated ${esc(lastStateSync?new Date(lastStateSync).toLocaleTimeString():"—")}</p>`;
  }
  function renderEmergency() {
    const banner=$("#emergency-banner");
    const message=String(state.emergencyBanner?.message||"").trim();
    const updatedAt=String(state.emergencyBanner?.updatedAt||"");
    let dismissed=false;
    if(updatedAt){
      try{dismissed=localStorage.getItem(dismissedBannerKey)===updatedAt;}
      catch(error){console.error("Emergency banner dismissal could not be read:",error);}
    }
    const visible=!!state.emergencyBanner?.active&&!!message&&!dismissed;
    banner.classList.toggle("hidden",!visible);
    banner.innerHTML=visible?`<div class="emergency-banner-content"><span><strong>${icon("triangle-alert","inline h-4 w-4 align-[-3px]")} Emergency class update</strong>${esc(message)}</span>${Security.isAdminAuthenticated()?"":`<button class="emergency-dismiss" type="button" data-action="dismiss-banner" aria-label="Dismiss this emergency banner for this browser">Dismiss <span aria-hidden="true">&times;</span></button>`}</div>`:"";
    refreshIcons(banner);
  }
  function renderClock() {
    const now=new Date();
    $("#clock-date").textContent=now.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
    $("#clock-time").textContent=now.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit",second:"2-digit"});
    const occurrence=nextOccurrence(now);
    const badge=$("#class-status");
    if (!occurrence) badge.innerHTML=`${icon("calendar-check")}<span>No upcoming class</span>`;
    else {
      const current=now>=occurrence.start&&now<occurrence.end;
      const title=current?`Now · ${occurrence.subject}`:`Next · ${occurrence.subject}`;
      badge.innerHTML=`${icon(current?"radio":"calendar-clock")}<span>${esc(title)}</span>`;
    }
    if (activeView==="focus") {
      const tracker=$("#today-tracker"); // Kept as an optional stable hook for future live-only updates.
      if (tracker) tracker.innerHTML=trackerMarkup(now);
      const timeline=$("#today-timeline");
      if (timeline) timeline.innerHTML=todayTimeline(now);
    }
    refreshIcons();
  }
  async function fetchSharedState() {
    const result = await Security.request("/api/state");
    const next = Security.validateClassState(result.state);
    state = clone(next);
    revision = result.revision;
    lastStateSync = Date.now();
    setConnection(true);
    renderEmergency();
    renderActiveView();
    return result;
  }
  async function commitState(mutator, successMessage = "Class update saved.") {
    if (!Security.requireAdmin("change shared class content")) {
      toast("Sign in as an administrator before editing shared class data.","error");
      return false;
    }
    if (!apiOnline || revision == null) {
      toast("The shared server is offline. No class changes were saved.","error");
      return false;
    }
    if (saveBusy) {
      toast("A class update is already being saved. Try again in a moment.","warning");
      return false;
    }
    const next = clone(state);
    mutator(next);
    try {
      Security.validateClassState(next);
      saveBusy = true;
      const result = await Security.request("/api/state", {
        method:"PUT",
        body:JSON.stringify({ revision, state:next })
      });
      state = clone(Security.validateClassState(result.state));
      revision = result.revision;
      lastStateSync = Date.now();
      renderEmergency();
      renderActiveView();
      toast(successMessage);
      return true;
    } catch (error) {
      if (error.status === 401) {
        currentSession = { authenticated:false };
        setRoleIndicator();
      }
      if (error.status === 409) {
        try { await fetchSharedState(); } catch (refreshError) { console.error("Could not reload concurrent class edits:",refreshError); }
      }
      toast(error.message,"error");
      return false;
    } finally {
      saveBusy = false;
    }
  }
  function openModal(title, body, onSubmit, submitText = "Save changes") {
    const mount=$("#modal-mount");
    mount.innerHTML=`<div class="modal-backdrop" data-modal-backdrop><section class="modal-card panel-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="btn !p-2" data-action="close-modal" aria-label="Close dialog">${icon("x")}</button></div><form class="space-y-3" id="active-modal-form">${body}<div class="flex justify-end gap-2 border-t border-slate-700/40 pt-3"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${esc(submitText)}</button></div></form></section></div>`;
    refreshIcons(mount);
    $("#active-modal-form",mount).addEventListener("submit",async event=>{
      event.preventDefault();
      if (await onSubmit(new FormData(event.currentTarget)) !== false) closeModal();
    });
    $(".modal-backdrop",mount).addEventListener("mousedown",event=>{if(event.target===event.currentTarget)closeModal();});
    $("input:not([type=hidden]),textarea,select",mount)?.focus();
  }
  function closeModal() { $("#modal-mount").innerHTML=""; }
  function formField(label,name,value="",type="text",required=true,attrs="") {
    return `<label class="field-label">${esc(label)}<input class="field" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${required?"required":""} ${attrs}></label>`;
  }
  function selectField(label,name,options,value) {
    return `<label class="field-label">${esc(label)}<select class="field" name="${esc(name)}" required>${options.map(option=>{
      const optionValue=typeof option==="string"?option:option.value;
      const optionLabel=typeof option==="string"?option:option.label;
      return `<option value="${esc(optionValue)}" ${optionValue===value?"selected":""}>${esc(optionLabel)}</option>`;
    }).join("")}</select></label>`;
  }
  function multilineField(label,name,value="",placeholder="") {
    return `<label class="field-label">${esc(label)}<textarea class="field min-h-24" name="${esc(name)}" maxlength="8000" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
  }
  function reminderForm(item = {}) {
    const isEdit=!!item.id;
    const body=`${formField("Title","title",item.title||"","text",true,'maxlength="240"')}
      <div class="grid gap-3 sm:grid-cols-2">${selectField("Subject tag","subject",["ALL",...state.subjects.map(subject=>subject.code)],item.subject||"ALL")}${selectField("Category","category",CYB202_DATA.reminderCategories,item.category||"General")}</div>
      ${multilineField("Scope / description","description",item.description||"","Add the detail classmates need to know.")}
      <div class="grid gap-3 sm:grid-cols-2">${formField("External resource link (optional)","externalLink",item.externalLink||"","url",false,'placeholder="https://…"')}${formField("Due date & time (optional)","dueAt",item.dueAt?localDateTime(new Date(item.dueAt)):"","datetime-local",false)}</div>
      <div class="grid gap-3 sm:grid-cols-2">${selectField("Priority","priority",["High","Medium","Low"],item.priority||"Medium")}<label class="flex items-center gap-2 self-end pb-2 text-xs text-slate-300"><input type="checkbox" name="pinned" class="accent-emerald-400" ${item.pinned?"checked":""}> Pin this notice</label></div>`;
    openModal(isEdit?"Edit class reminder":"Publish a class reminder",body,async form=>{
      const values=Object.fromEntries(form.entries());
      const externalLink=values.externalLink.trim();
      if(externalLink&&!Security.safeExternalURL(externalLink)){toast("Resource links must start with http:// or https://.","error");return false;}
      const record={
        id:item.id||crypto.randomUUID(),title:Security.sanitizeHTML(values.title).trim(),
        subject:values.subject,category:values.category,description:Security.sanitizeHTML(values.description),
        externalLink:externalLink?Security.safeExternalURL(externalLink):"",
        dueAt:values.dueAt?new Date(values.dueAt).toISOString():"",
        priority:values.priority,pinned:form.has("pinned"),createdAt:item.createdAt||new Date().toISOString()
      };
      return commitState(next=>{
        const index=next.reminders.findIndex(entry=>entry.id===record.id);
        if(index>=0)next.reminders[index]=record;else next.reminders.push(record);
      },isEdit?"Reminder updated for the section.":"Reminder published to the section.");
    });
  }
  function overrideForm(item = {}) {
    const date=item.date||dayDateKey();
    const scheduleOptions=[{value:"*",label:"All CYB-202 classes"}].concat(state.schedule.map(entry=>({value:entry.id,label:`${entry.day} · ${entry.subject} · ${entry.start} · ${entry.room}`})));
    const body=`${formField("Effective date","date",date,"date")}
      ${selectField("Class meeting","scheduleId",scheduleOptions,item.scheduleId||"*")}
      ${selectField("Change type","status",[{value:"room",label:"Room change"},{value:"online",label:"Online / MS Teams"},{value:"absence",label:"Professor absence"},{value:"cancelled",label:"Class cancelled"}],item.status||"room")}
      ${formField("Replacement room (if applicable)","room",item.room||"","text",false,'maxlength="120" placeholder="SJH-504 or Online / MS Teams"')}
      ${multilineField("Message","message",item.message||"","Optional details for classmates.")}`;
    openModal(item.id?"Edit temporary schedule change":"Post a temporary schedule change",body,form=>{
      const values=Object.fromEntries(form.entries());
      if(!/^\d{4}-\d{2}-\d{2}$/.test(values.date)){toast("Choose a valid date.","error");return false;}
      const record={id:item.id||crypto.randomUUID(),...values};
      return commitState(next=>{
        const index=next.scheduleOverrides.findIndex(entry=>entry.id===record.id);
        if(index>=0)next.scheduleOverrides[index]=record;else next.scheduleOverrides.push(record);
      },"Temporary timetable update saved.");
    });
  }
  function reviewForm(item = {}) {
    const subjectOptions=state.subjects.map(subject=>({value:subject.code,label:`${subject.code} · ${subject.title}`}));
    const body=`${selectField("Subject","subject",subjectOptions,item.subject||subjectOptions[0]?.value)}
      ${formField("Guide title","title",item.title||"","text",true,'maxlength="240"')}
      ${multilineField("Summary","summary",item.summary||"","Short, useful refresher.")}
      ${multilineField("Key lecture topics (one per line)","topicsText",(item.topics||[]).join("\n"))}
      ${multilineField("Formula sheet / key anchors","formulas",item.formulas||"")}
      ${multilineField("Code syntax snippets (separate with a line containing ---)","snippetsText",(item.snippets||[]).join("\n---\n"))}
      ${formField("Download link (optional)","downloadUrl",item.downloadUrl||"","url",false,'placeholder="https://…"')}`;
    openModal(item.id?"Edit subject guide":"Add subject guide",body,form=>{
      const values=Object.fromEntries(form.entries()),download=values.downloadUrl.trim();
      if(download&&!Security.safeExternalURL(download)){toast("Download links must start with http:// or https://.","error");return false;}
      const record={
        id:item.id||crypto.randomUUID(),subject:values.subject,title:Security.sanitizeHTML(values.title).trim(),
        summary:Security.sanitizeHTML(values.summary),topics:values.topicsText.split(/\r?\n/).map(x=>Security.sanitizeHTML(x).trim()).filter(Boolean),
        formulas:Security.sanitizeHTML(values.formulas),snippets:values.snippetsText.split(/\r?\n---\r?\n/).map(x=>Security.sanitizeHTML(x)).filter(x=>x.trim()),
        downloadUrl:download?Security.safeExternalURL(download):""
      };
      return commitState(next=>{
        const index=next.reviews.findIndex(entry=>entry.id===record.id);
        if(index>=0)next.reviews[index]=record;else next.reviews.push(record);
      },"Subject review guide saved.");
    });
  }
  function cheatForm(item = {}) {
    const body=`${formField("Group","group",item.group||"Linux / Cyber Terminal","text",true,'maxlength="120"')}
      ${formField("Title","title",item.title||"","text",true,'maxlength="240"')}
      ${multilineField("Command / syntax","code",item.code||"")}
      ${multilineField("Description and scope note","description",item.description||"")}`;
    openModal(item.id?"Edit cheat sheet":"Add cheat sheet",body,form=>{
      const values=Object.fromEntries(form.entries());
      const record={id:item.id||crypto.randomUUID(),group:Security.sanitizeHTML(values.group).trim(),title:Security.sanitizeHTML(values.title).trim(),code:Security.sanitizeHTML(values.code),description:Security.sanitizeHTML(values.description)};
      return commitState(next=>{
        const index=next.cheatSheets.findIndex(entry=>entry.id===record.id);
        if(index>=0)next.cheatSheets[index]=record;else next.cheatSheets.push(record);
      },"Cheat sheet saved.");
    });
  }
  function confirmModal(title,message,callback,label="Confirm") {
    openModal(title,`<p class="text-sm leading-relaxed text-slate-300">${esc(message)}</p>`,async()=>callback(),label);
  }
  function loginModal() {
    if(!apiOnline){toast("The shared server is offline; admin sign-in is unavailable.","error");return;}
    const locked=Security.loginLockRemaining();
    if(locked){toast(`Login is locked for ${Math.ceil(locked/1000)} seconds.`,"error");return;}
    const body=`<div class="rounded-xl border border-violet-300/20 bg-violet-400/5 p-3 text-xs leading-relaxed text-violet-100">Server-verified administrator access. Passphrases are never stored in the browser. Use the authorized profile and its unique passphrase.</div>
      ${selectField("Authorized administrator","adminId",Object.entries(Security.ADMIN_IDS).map(([value,label])=>({value,label})), "leander")}
      <label class="field-label">Passphrase<span class="relative mt-1 block"><input id="admin-password" class="field pr-14" name="password" type="password" minlength="12" maxlength="256" autocomplete="current-password" required><button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-cyan-200" data-action="toggle-password">Show</button></span></label>
      <p id="login-countdown" class="min-h-4 text-xs text-rose-300" aria-live="polite"></p>`;
    openModal("Administrator sign-in",body,async form=>{
      const password=String(form.get("password")||"");
      try {
        currentSession=await Security.login(String(form.get("adminId")),password);
        $("#admin-password").value="";
        syncAiWidgetPersona(true);
        setRoleIndicator();
        renderActiveView();
        toast(`Admin session authorized for ${currentSession.adminName}.`);
        return true;
      } catch(error) {
        const remaining=Security.loginLockRemaining();
        $("#login-countdown").textContent=remaining?`Locked for ${Math.ceil(remaining/1000)} seconds.`:error.message;
        toast(error.message,"error");
        return false;
      } finally {
        $("#admin-password").value="";
      }
    },"Sign in");
  }
  async function logout() {
    try { await Security.logout(); }
    catch(error) { console.error("Server logout failed:",error); }
    currentSession={authenticated:false};
    syncAiWidgetPersona(false);
    setRoleIndicator();
    renderActiveView();
    toast("Signed out. Shared class data is read-only.");
  }
  function openPalette() {
    const mount=$("#palette-mount");
    mount.innerHTML=`<div class="palette-backdrop" data-palette-backdrop><section class="palette-card panel-card" role="dialog" aria-modal="true" aria-label="Spotlight search"><label class="sr-only" for="spotlight-input">Search class hub</label><div class="flex items-center gap-3 border-b border-slate-700/50 px-4 py-3">${icon("search","h-5 w-5 text-slate-400")}<input id="spotlight-input" class="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" placeholder="Search subjects, rooms, announcements, formulas, and commands…" autocomplete="off"><kbd>ESC</kbd></div><div id="palette-results" class="palette-results scrollbar"></div><div class="border-t border-slate-700/40 px-4 py-2 text-[10px] text-slate-500">↑↓ navigate <span class="px-1">·</span> Enter open <span class="px-1">·</span> Esc close</div></section></div>`;
    refreshIcons(mount);
    $("#spotlight-input").addEventListener("input",event=>updatePalette(event.target.value));
    $("#spotlight-input").addEventListener("keydown",paletteKeydown);
    $(".palette-backdrop",mount).addEventListener("mousedown",event=>{if(event.target===event.currentTarget)closePalette();});
    $("#spotlight-input").focus();
  }
  function closePalette() { $("#palette-mount").innerHTML=""; }
  function buildSearchItems() {
    const items=[];
    state.subjects.forEach(item=>items.push({label:item.title,detail:`Subject · ${item.code} · class ${item.classCode}`,view:"reviews",text:`${item.title} ${item.code} ${item.classCode}`}));
    state.schedule.forEach(item=>items.push({label:item.title,detail:`${item.subject} · ${item.day} · ${timeText(item.start)} · ${item.room} · ${roomGuide(item.room)}`,view:"schedule",text:`${item.title} ${item.subject} ${item.room} ${item.code} ${item.day} ${roomGuide(item.room)}`}));
    state.reminders.forEach(item=>items.push({label:item.title,detail:`Reminder · ${item.subject} · ${item.category}${item.dueAt?` · ${dateText(item.dueAt)}`:""}`,view:"reminders",text:`${item.title} ${item.subject} ${item.category} ${item.description}`}));
    state.reviews.forEach(item=>items.push({label:item.title,detail:`Review · ${item.subject} · ${item.topics.join(", ")}`,view:"reviews",text:`${item.subject} ${item.title} ${item.summary} ${item.topics.join(" ")} ${item.formulas} ${item.snippets.join(" ")}`}));
    state.cheatSheets.forEach(item=>items.push({label:item.title,detail:`Cheat sheet · ${item.group}`,view:"terminal",text:`${item.group} ${item.title} ${item.description} ${item.code}`}));
    return items;
  }
  function searchScore(query,text) {
    const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const words=text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if(!terms.length)return 0;
    let total=0;
    for(const term of terms){
      let best=0;
      for(const word of words){
        if(word===term)best=Math.max(best,15);
        else if(term.length>1&&word.startsWith(term))best=Math.max(best,8);
        else if(term.length>3&&Math.abs(word.length-term.length)<=1&&oneEditAway(term,word))best=Math.max(best,4);
      }
      if(!best)return 0;
      total+=best;
    }
    return total;
  }
  function oneEditAway(a,b) {
    let i=0,j=0,edits=0;
    while(i<a.length&&j<b.length){
      if(a[i]===b[j]){i++;j++;continue;}
      if(++edits>1)return false;
      if(a.length>b.length)i++;
      else if(b.length>a.length)j++;
      else{i++;j++;}
    }
    return edits+(i<a.length||j<b.length?1:0)<=1;
  }
  function updatePalette(query) {
    const results=$("#palette-results");
    searchResults=buildSearchItems().map(item=>({...item,score:searchScore(query,item.text)}))
      .filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,18);
    searchIndex=0;
    results.innerHTML=searchResults.length?searchResults.map((item,index)=>`<button class="palette-result" data-palette-index="${index}" aria-selected="${index===0}"><span class="palette-icon">${icon(item.view==="schedule"?"calendar-days":item.view==="terminal"?"terminal-square":item.view==="reminders"?"bell":"book-open")}</span><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${esc(item.label)}</span><small class="truncate">${esc(item.detail)}</small></span>${icon("arrow-up-right","h-3.5 w-3.5 text-slate-500")}</button>`).join(""):`<div class="p-7 text-center text-sm text-slate-400">${query.trim()?"No match found. Try a subject code, room prefix, or key term.":"Start typing to search the class hub."}</div>`;
    refreshIcons(results);
  }
  function paletteKeydown(event) {
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();
      if(searchResults.length)searchIndex=(searchIndex+(event.key==="ArrowDown"?1:-1)+searchResults.length)%searchResults.length;
      $$("[data-palette-index]").forEach(button=>button.setAttribute("aria-selected",String(Number(button.dataset.paletteIndex)===searchIndex)));
      $(`[data-palette-index="${searchIndex}"]`)?.scrollIntoView({block:"nearest"});
    } else if(event.key==="Enter"){
      event.preventDefault();
      const item=searchResults[searchIndex];
      if(item){closePalette();switchView(item.view);}
    } else if(event.key==="Escape"){closePalette();}
  }
  function timerText() { return `${String(Math.floor(timerSeconds/60)).padStart(2,"0")}:${String(timerSeconds%60).padStart(2,"0")}`; }
  function renderTimer() {
    const display=$("#timer-display");if(display)display.textContent=timerText();
    const button=$('[data-action="timer-toggle"]');
    if(button){button.innerHTML=`${icon(timerHandle?"pause":"play")} ${timerHandle?"Pause":"Start focus"}`;refreshIcons(button);}
    const label=$("#timer-kind-label");if(label)label.textContent=timerKind==="focus"?"Focus":"Break";
  }
  function startTimer() {
    if(timerHandle){clearInterval(timerHandle);timerHandle=null;renderTimer();return;}
    timerHandle=window.setInterval(()=>{
      timerSeconds--;
      if(timerSeconds<=0){
        clearInterval(timerHandle);timerHandle=null;
        if(timerKind==="focus"){
          const minutes=Math.ceil(timerDuration/60);
          try{localStorage.setItem("cyb202.study-minutes",String(Number(localStorage.getItem("cyb202.study-minutes")||0)+minutes));}catch(error){console.warn("Study minutes could not be saved locally.",error);}
          toast("Focus block complete. Take a five-minute break.");
          setTimer(5*60,"break");
        } else {toast("Break complete. Start another focus block when ready.");setTimer(25*60,"focus");}
      }
      renderTimer();
    },1000);
    renderTimer();
  }
  function setTimer(seconds,kind="focus") {
    if(timerHandle)clearInterval(timerHandle);
    timerHandle=null;timerSeconds=seconds;timerDuration=seconds;timerKind=kind;renderTimer();
  }
  async function toggleSound(kind) {
    stopSound();
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context){toast("This browser does not support generated audio.","error");return;}
    audioContext=new Context();
    if(kind==="rain"){
      const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate);
      const values=buffer.getChannelData(0);
      for(let i=0;i<values.length;i++)values[i]=(Math.random()*2-1)*.17;
      const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();
      source.buffer=buffer;source.loop=true;filter.type="lowpass";filter.frequency.value=1400;gain.gain.value=.12;
      source.connect(filter).connect(gain).connect(audioContext.destination);source.start();audioSource=source;
    }else{
      const buffer=audioContext.createBuffer(1,audioContext.sampleRate*2,audioContext.sampleRate),values=buffer.getChannelData(0);
      let last=0;
      for(let i=0;i<values.length;i++){const white=Math.random()*2-1;last=(last+.018*white)/1.018;values[i]=last*3.5;}
      const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=.18;source.connect(gain).connect(audioContext.destination);source.start();audioSource=source;
    }
    toast(kind==="rain"?"Cyber rain is playing.":"Brown noise is playing.");
  }
  function stopSound() {
    try{audioSource?.stop();}catch(error){console.debug("Ambient audio had already stopped.",error);}
    audioSource=null;
    if(audioContext){audioContext.close().catch(error=>console.error("Audio context shutdown failed:",error));audioContext=null;}
  }
  async function exportState() {
    if(!Security.requireAdmin("export shared class state")){toast("Admin sign-in is required to export shared data.","error");return;}
    const snapshot={format:"cyb202-class-state",schemaVersion:1,exportedAt:new Date().toISOString(),revision,state};
    const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download=`cyb-202-class-state-${dayDateKey()}.json`;document.body.append(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
    toast("Shared class state exported.");
  }
  async function importStateFile(file) {
    if(!Security.requireAdmin("import shared class state")){toast("Admin sign-in is required to import shared data.","error");return;}
    if(!file||file.size>1_000_000){toast("Choose a JSON file smaller than 1 MB.","error");return;}
    try{
      const payload=JSON.parse(await file.text());
      if(payload.format!=="cyb202-class-state"||payload.schemaVersion!==1)throw new Error("This is not a supported CYB-202 class-state snapshot.");
      const imported=Security.validateClassState(payload.state);
      confirmModal("Replace shared class data?","This replaces the shared timetable edits, reminders, review guides, cheat sheets, and emergency banner for everyone.",()=>commitState(next=>{
        for(const key of ["schedule","subjects","reminders","reviews","cheatSheets","scheduleOverrides"])next[key]=clone(imported[key]);
        next.emergencyBanner=clone(imported.emergencyBanner);
      },"Class snapshot imported."));
    }catch(error){toast(`Import failed: ${error.message}`,"error");}
  }
  function downloadGuide(item) {
    const content=`${item.title} (${item.subject})\n\n${item.summary}\n\nKey topics:\n- ${item.topics.join("\n- ")}\n\nFormula sheet:\n${item.formulas}\n\n${item.snippets.join("\n\n")}`;
    const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download=`${item.subject}-review-guide.txt`;anchor.click();URL.revokeObjectURL(url);
  }
  async function resetToDefaults() {
    if(!Security.requireAdmin("reset shared class state")){toast("Admin sign-in is required to reset shared state.","error");return;}
    try{
      const result=await Security.request("/api/state/reset",{method:"POST",body:"{}"});
      state=clone(Security.validateClassState(result.state));revision=result.revision;lastStateSync=Date.now();renderEmergency();renderActiveView();toast("Shared class state restored to defaults.");
    }catch(error){toast(error.message,"error");}
  }
  function requireAdminAction(operation) {
    if(Security.requireAdmin(operation))return true;
    toast("This action requires an authenticated administrator.","error");
    return false;
  }
  function handleAction(action,element) {
    const id=element.dataset.id;
    if(action==="login")loginModal();
    else if(action==="logout")logout();
    else if(action==="dismiss-banner"){
      const updatedAt=String(state.emergencyBanner?.updatedAt||"");
      try{
        localStorage.setItem(dismissedBannerKey,updatedAt);
        renderEmergency();
      }catch(error){
        console.error("Emergency banner dismissal could not be saved:",error);
        element.closest("#emergency-banner")?.classList.add("hidden");
        toast("The banner was hidden for this visit, but browser storage could not save the dismissal.","warning");
      }
    }
    else if(action==="deactivate-banner"){
      if(requireAdminAction("deactivate the emergency banner"))commitState(next=>{next.emergencyBanner={active:false,message:"",updatedAt:new Date().toISOString()};},"Emergency banner deactivated.");
    }
    else if(action==="save-ai-draft")saveReviewedAiDraft();
    else if(action==="apply-ai-reminder-draft")applyAiReminderDraft();
    else if(action==="new-reminder")requireAdminAction("create a reminder")&&reminderForm();
    else if(action==="edit-reminder"){if(requireAdminAction("edit a reminder")){const item=state.reminders.find(entry=>entry.id===id);if(item)reminderForm(item);}}
    else if(action==="pin-reminder"){if(requireAdminAction("pin a reminder"))commitState(next=>{const item=next.reminders.find(entry=>entry.id===id);if(item)item.pinned=!item.pinned;},"Reminder pin updated.");}
    else if(action==="delete-reminder"){if(requireAdminAction("delete a reminder"))confirmModal("Delete this class reminder?","This removes the reminder from the shared class feed.",()=>commitState(next=>{next.reminders=next.reminders.filter(entry=>entry.id!==id);},"Reminder deleted."),"Delete reminder");}
    else if(action==="new-override")requireAdminAction("create a schedule override")&&overrideForm();
    else if(action==="edit-override"){if(requireAdminAction("edit a schedule override")){const item=state.scheduleOverrides.find(entry=>entry.id===id);if(item)overrideForm(item);}}
    else if(action==="delete-override"){if(requireAdminAction("delete a schedule override"))commitState(next=>{next.scheduleOverrides=next.scheduleOverrides.filter(entry=>entry.id!==id);},"Schedule override removed.");}
    else if(action==="reset-overrides"){if(requireAdminAction("reset schedule overrides"))confirmModal("Reset temporary changes?","All date-specific changes will be removed. The seeded timetable remains unchanged.",()=>commitState(next=>{next.scheduleOverrides=[];},"Schedule restored to the official seed."),"Reset schedule");}
    else if(action==="new-review")requireAdminAction("create a review guide")&&reviewForm();
    else if(action==="edit-review"){if(requireAdminAction("edit a review guide")){const item=state.reviews.find(entry=>entry.id===id);if(item)reviewForm(item);}}
    else if(action==="delete-review"){if(requireAdminAction("delete a review guide"))confirmModal("Delete this subject guide?","This removes the guide from shared course reviews.",()=>commitState(next=>{next.reviews=next.reviews.filter(entry=>entry.id!==id);},"Review guide deleted."),"Delete guide");}
    else if(action==="new-cheat")requireAdminAction("create a cheat sheet")&&cheatForm();
    else if(action==="edit-cheat"){if(requireAdminAction("edit a cheat sheet")){const item=state.cheatSheets.find(entry=>entry.id===id);if(item)cheatForm(item);}}
    else if(action==="delete-cheat"){if(requireAdminAction("delete a cheat sheet"))confirmModal("Delete this cheat sheet?","This permanently removes the shared reference.",()=>commitState(next=>{next.cheatSheets=next.cheatSheets.filter(entry=>entry.id!==id);},"Cheat sheet deleted."),"Delete cheat sheet");}
    else if(action==="timer-toggle")startTimer();
    else if(action==="timer-reset")setTimer(timerKind==="focus"?25*60:5*60,timerKind);
    else if(action==="open-focus"){switchView("focus");$("#timer-display")?.scrollIntoView({behavior:"smooth",block:"center"});}
    else if(action==="sound")toggleSound(element.dataset.sound);
    else if(action==="sound-stop"){stopSound();toast("Ambient sound stopped.");}
    else if(action==="copy-text")navigator.clipboard.writeText(element.dataset.value||"").then(()=>toast("Copied to clipboard.")).catch(()=>toast("Clipboard access failed.","error"));
    else if(action==="download-guide"){const item=state.reviews.find(entry=>entry.id===id);if(item)downloadGuide(item);}
    else if(action==="export")exportState();
    else if(action==="import"){if(requireAdminAction("import shared class state"))$("#import-file").click();}
    else if(action==="hard-reset")requireAdminAction("reset shared class state")&&confirmModal("Reset the whole class hub?","This replaces all shared content with the original class seed and cannot be undone.",resetToDefaults,"Reset shared state");
    else if(action==="toggle-password"){
      const input=$("#admin-password"),visible=input.type==="text";input.type=visible?"password":"text";element.textContent=visible?"Show":"Hide";
    }
    else if(action==="close-modal")closeModal();
  }
  function handleFormSubmit(event) {
    const form=event.target.closest("[data-form]");
    if(!form)return;
    event.preventDefault();
    if(form.dataset.form==="admin-ai"){
      generateAdminDraft(form);
      return;
    }
    if(!Security.requireAdmin("publish an emergency broadcast"))return;
    const values=new FormData(form),message=Security.sanitizeHTML(String(values.get("message")||"")).trim();
    if(!message){toast("Enter a message before publishing the emergency alert.","error");return;}
    commitState(next=>{next.emergencyBanner={active:true,message,updatedAt:new Date().toISOString()};},"Emergency banner published.");
  }
  async function generateAdminDraft(form) {
    if(!requireAdminAction("generate an admin draft"))return;
    const values=new FormData(form);
    const type=String(values.get("type")||"");
    const prompt=String(values.get("prompt")||"").trim();
    const button=$("button[type=submit]",form);
    const status=$("#admin-ai-status");
    button.disabled=true;
    button.innerHTML='<span class="ai-spinner" aria-hidden="true"></span> Ai-Ai is drafting…';
    status.textContent="Generating a draft for human review. No class data has been saved.";
    try{
      const result=await Security.request("/api/ai/admin-draft",{
        method:"POST",
        body:JSON.stringify({type,prompt})
      });
      if(result.type!==type||!result.draft||typeof result.draft!=="object")throw new Error("The draft response did not match the selected draft type.");
      $("#admin-ai-result").value=JSON.stringify(result.draft,null,2);
      status.textContent="Draft ready. Review and edit every field before saving.";
    }catch(error){
      if(error.status===401){
        currentSession={authenticated:false};
        setRoleIndicator();
        renderActiveView();
      }
      status.textContent=error.status===429
        ?"Ai-Ai is currently assisting many CYB-202 administrators. Please try again in 10 seconds."
        :error.message||"Ai-Ai could not generate a draft.";
      toast(status.textContent,"error");
    }finally{
      button.disabled=false;
      button.innerHTML=`${icon("sparkles")} Generate draft`;
      refreshIcons(button);
    }
  }
  function saveReviewedAiDraft() {
    if(!requireAdminAction("save a reviewed AI draft"))return;
    const type=$("[data-form=admin-ai] [name=type]")?.value;
    let draft;
    try{draft=JSON.parse($("#admin-ai-result").value);}
    catch(error){toast("Enter valid JSON in the reviewed draft before saving.","error");return;}
    if(!draft||Array.isArray(draft)||typeof draft!=="object"){
      toast("The reviewed draft must be a JSON object.","error");
      return;
    }
    const fieldSets={
      reminder:["title","subject","category","description","externalLink","dueAt","priority","pinned"],
      review:["subject","title","summary","topics","formulas","downloadUrl","snippets"],
      scheduleOverride:["date","scheduleId","status","message","room"]
    };
    const fields=fieldSets[type];
    if(!fields||Object.keys(draft).some(key=>!fields.includes(key))){
      toast("The reviewed draft contains unsupported fields or a missing draft type.","error");
      return;
    }
    const stringFields=fields.filter(field=>!["pinned","topics","snippets"].includes(field));
    if(stringFields.some(field=>typeof draft[field]!=="string")){
      toast("Draft text fields must remain text values.","error");
      return;
    }
    if(type==="reminder"&&typeof draft.pinned!=="boolean"){
      toast("The reminder pinned value must be true or false.","error");
      return;
    }
    if(type==="review"&&["topics","snippets"].some(field=>!Array.isArray(draft[field])||!draft[field].every(entry=>typeof entry==="string"))){
      toast("Review topics and snippets must be lists of text values.","error");
      return;
    }
    if(fields.some(field=>!Object.hasOwn(draft,field))){
      toast("The reviewed draft is missing required fields.","error");
      return;
    }
    if(type==="reminder"){
      const record={id:crypto.randomUUID(),...draft,createdAt:new Date().toISOString()};
      commitState(next=>next.reminders.push(record),"Reviewed reminder saved.");
    }else if(type==="review"){
      const record={id:crypto.randomUUID(),...draft};
      commitState(next=>next.reviews.push(record),"Reviewed subject know-how saved.");
    }else{
      const record={id:crypto.randomUUID(),...draft};
      commitState(next=>next.scheduleOverrides.push(record),"Reviewed schedule override saved.");
    }
  }
  async function syncState() {
    if(stateRefreshBusy||!apiOnline||document.hidden||Date.now()-lastActivity>5*60_000)return;
    stateRefreshBusy=true;
    try{
      const result=await Security.request("/api/state");
      if(result.revision!==revision){
        state=clone(Security.validateClassState(result.state));revision=result.revision;lastStateSync=Date.now();
        renderEmergency();renderActiveView();
        toast("Shared class updates synced.");
      }
    }catch(error){
      if(error.status>=500||!error.status){setConnection(false);console.error("Shared class sync failed:",error);}
    }finally{stateRefreshBusy=false;}
  }
  function appendAiMessage(role,text,extraClass="") {
    const message=document.createElement("div");
    message.className=`ai-message ${role}${extraClass?` ${extraClass}`:""}`;
    if(role==="assistant"){
      const badge=document.createElement("span");
      badge.className="ai-message-badge";
      badge.textContent=aiPersona==="admin"?"Ai-Ai":"BETTIE";
      const content=document.createElement("div");
      content.className="ai-message-content";
      content.innerHTML=renderMarkdown(text);
      message.append(badge,content);
    }else message.textContent=text;
    $("#ai-chat-messages").append(message);
    $("#ai-chat-messages").scrollTop=$("#ai-chat-messages").scrollHeight;
    return message;
  }
  function renderInlineMarkdown(text) {
    let escaped=esc(text);
    const code=[];
    escaped=escaped.replace(/`([^`]+)`/g,(_,value)=>{
      const marker=`\u0000INLINECODE${code.length}\u0000`;
      code.push(`<code>${value}</code>`);
      return marker;
    });
    escaped=escaped
      .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>");
    return escaped.replace(/\u0000INLINECODE(\d+)\u0000/g,(_,index)=>code[Number(index)]);
  }
  function renderMarkdown(markdown) {
    const lines=String(markdown||"").replace(/\r\n?/g,"\n").split("\n");
    const blocks=[];
    let paragraph=[];
    let index=0;
    const flushParagraph=()=>{
      if(paragraph.length){
        blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
        paragraph=[];
      }
    };
    while(index<lines.length){
      const line=lines[index];
      if(/^\s*```/.test(line)){
        flushParagraph();
        index+=1;
        const code=[];
        while(index<lines.length&&!/^\s*```/.test(lines[index]))code.push(lines[index++]);
        if(index<lines.length)index+=1;
        blocks.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
        continue;
      }
      const listMatch=line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)/);
      if(listMatch){
        flushParagraph();
        const ordered=/^\s*\d+\.\s+/.test(line);
        const items=[];
        while(index<lines.length){
          const match=lines[index].match(/^\s*(?:[-*+]\s+|\d+\.\s+)(.+)$/);
          if(!match||/^\s*\d+\.\s+/.test(lines[index])!==ordered)break;
          items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
          index+=1;
        }
        blocks.push(`<${ordered?"ol":"ul"}>${items.join("")}</${ordered?"ol":"ul"}>`);
        continue;
      }
      if(!line.trim()){
        flushParagraph();
        index+=1;
        continue;
      }
      paragraph.push(line);
      index+=1;
    }
    flushParagraph();
    return blocks.join("");
  }
  function openAiAssistant() {
    const panel=$("#ai-chat");
    panel.hidden=false;
    $("#ai-assistant-trigger").setAttribute("aria-expanded","true");
    if(!$("#ai-chat-messages").childElementCount){
      appendAiMessage("assistant",aiPersona==="admin"
        ?"Hi! I’m Ai-Ai delas Alas, your administrator drafting helper. Send a request to prepare a reminder, schedule override, or reviewer note for review in the Admin Portal."
        :"Hi! I’m BETTIE, your read-only CYB-202 study assistant. I can help with your timetable, reminders, subject know-hows, and Cyber Terminal references.");
    }
    $("#ai-chat-input").focus();
  }
  function openAdminAiWorkspace(prompt="") {
    if(!Security.requireAdmin("open the Ai-Ai drafting workspace")){
      loginModal();
      return;
    }
    adminTab="ai";
    if(activeView!=="admin")switchView("admin");
    else if(!$('[data-form="admin-ai"]'))renderActiveView();
    const promptInput=$("#admin-ai-prompt");
    if(prompt){
      promptInput.value=prompt.slice(0,2000);
      $("#admin-ai-result").value="";
      $("#admin-ai-status").textContent="";
      $("#ai-chat-input").value="";
    }
    closeAiAssistant();
    promptInput.focus();
    if(prompt.length>2000)toast("Draft request loaded with text beyond 2,000 characters omitted.");
    else if(prompt)toast("Draft request loaded. Choose a type and generate it for review.");
  }
  function closeAiAssistant() {
    $("#ai-chat").hidden=true;
    $("#ai-assistant-trigger").setAttribute("aria-expanded","false");
    $("#ai-assistant-trigger").focus();
  }
  function reminderDraftFromPrompt(prompt) {
    const text=prompt.trim();
    const categories=CYB202_DATA.reminderCategories;
    const category=categories.find(value=>new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+")}\\b`,"i").test(text))||"";
    const subject=state.subjects.map(entry=>entry.code).concat("ALL")
      .find(code=>new RegExp(`\\b${code}\\b`,"i").test(text))||"";
    const priority=["High","Medium","Low"].find(value=>new RegExp(`\\b${value}\\b`,"i").test(text))||"";
    const pinned=/\b(pin|pinned|pin to top)\b/i.test(text)
      ?true:/\b(normal notice|do not pin|unpin|not pinned)\b/i.test(text)?false:null;
    const cleaned=text
      .replace(/^\s*(?:please\s+)?(?:add|create|draft|write|post|make)\s+(?:(?:a|an|the)\s+)?/i,"")
      .replace(/[.!?]+$/,"").trim();
    const title=cleaned?cleaned.charAt(0).toUpperCase()+cleaned.slice(1):"Class reminder";
    const dueAt=guessReminderDueDate(text);
    return {
      title:title.slice(0,240),
      description:text.slice(0,8000),
      subject,
      category,
      dueAt,
      priority,
      pinned
    };
  }
  function guessReminderDueDate(text) {
    const isoDate=text.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\b/);
    if(isoDate){
      const value=new Date(`${isoDate[1]}T${isoDate[2]||"23:59"}:00`);
      return Number.isNaN(value.getTime())?"":value.toISOString();
    }
    const date=new Date();
    if(/\btomorrow\b/i.test(text)){
      date.setDate(date.getDate()+1);
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    if(/\bin 3 days\b/i.test(text)){
      date.setDate(date.getDate()+3);
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    if(/\bthis friday\b/i.test(text)){
      date.setDate(date.getDate()+((5-date.getDay()+7)%7||7));
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    return "";
  }
  function reminderDueSuggestion(choice) {
    const date=new Date();
    if(choice==="Tomorrow"){
      date.setDate(date.getDate()+1);
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    if(choice==="In 3 Days"){
      date.setDate(date.getDate()+3);
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    if(choice==="This Friday"){
      date.setDate(date.getDate()+((5-date.getDay()+7)%7||7));
      date.setHours(23,59,0,0);
      return date.toISOString();
    }
    if(choice==="Next Class"){
      const occurrence=nextOccurrence(date);
      return occurrence?occurrence.start.toISOString():"";
    }
    return "";
  }
  function showAiReminderDraft() {
    if(!aiReminderDraft||!Security.isAdminAuthenticated())return;
    const draft=aiReminderDraft;
    const missing=[
      ["subject","Subject",!draft.subject],
      ["category","Category",!draft.category],
      ["dueAt","Due date",!draft.dueAt],
      ["priority","Priority",!draft.priority],
      ["pinned","Pin state",draft.pinned===null]
    ].filter(([, ,isMissing])=>isMissing);
    const message=appendAiMessage("assistant",missing.length
      ?"I’ve started a reminder draft. Choose the missing details below; your choices stay in this chat until you apply the preview."
      :"Your reminder draft is ready to review.");
    const content=message.querySelector(".ai-message-content");
    if(!missing.length){
      const due=new Date(draft.dueAt);
      content.innerHTML=`<p><strong>Draft Preview</strong></p>
        <div class="ai-draft-preview">
          <div><span>Title</span><strong>${esc(draft.title)}</strong></div>
          <div><span>Subject</span><strong>${esc(draft.subject)}</strong></div>
          <div><span>Category</span><strong>${esc(draft.category)}</strong></div>
          <div><span>Due</span><strong>${esc(due.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</strong></div>
          <div><span>Priority</span><strong>${esc(draft.priority)}</strong></div>
          <div><span>Pin state</span><strong>${draft.pinned?"Pinned":"Normal notice"}</strong></div>
          <p>${esc(draft.description)}</p>
          <button class="btn ai-apply-draft" type="button" data-action="apply-ai-reminder-draft">Populate Admin Form</button>
        </div>`;
      return;
    }
    const choices={
      subject:["6ITN","6DASALGO","6IMAN","6DWEB","4READPHILHIS","2PROBSTAT","THEOLOGY103","7TPE4","ALL"],
      category:CYB202_DATA.reminderCategories,
      dueAt:["Tomorrow","In 3 Days","This Friday","Pick Date"],
      priority:["High","Medium","Low"],
      pinned:["Pin Notice","Normal"]
    };
    const groupHtml=missing.map(([field,label])=>{
      const buttons=choices[field].map(value=>{
        return `<button type="button" class="ai-choice-pill" data-ai-choice-field="${field}" data-ai-choice-value="${esc(value)}">${esc(value)}</button>`;
      }).join("");
      const customPicker=field==="dueAt"&&draft.customDateVisible
        ?`<div class="ai-custom-date"><label>${label}<input class="field" type="datetime-local" data-ai-custom-date></label><button type="button" class="btn" data-ai-action="use-custom-date">Use date</button></div>`:"";
      return `<div class="ai-choice-group"><strong>${label}</strong><div class="ai-choice-pills">${buttons}</div>${customPicker}</div>`;
    }).join("");
    content.insertAdjacentHTML("beforeend",`<div class="ai-draft-prompt"><strong>Draft:</strong> ${esc(draft.title)}</div>${groupHtml}`);
  }
  function handleAiDraftChoice(button) {
    if(!Security.isAdminAuthenticated()||!aiReminderDraft)return;
    const field=button.dataset.aiChoiceField;
    const choice=button.dataset.aiChoiceValue;
    if(field==="dueAt"&&choice==="Pick Date"){
      aiReminderDraft.customDateVisible=true;
    }else if(field==="dueAt"){
      aiReminderDraft.dueAt=reminderDueSuggestion(choice);
    }else if(field==="pinned"){
      aiReminderDraft.pinned=choice==="Pin Notice";
    }else if(field==="subject"&&(choice==="ALL"||state.subjects.some(subject=>subject.code===choice))){
      aiReminderDraft.subject=choice;
    }else if(field==="category"&&CYB202_DATA.reminderCategories.includes(choice)){
      aiReminderDraft.category=choice;
    }else if(field==="priority"&&["High","Medium","Low"].includes(choice)){
      aiReminderDraft.priority=choice;
    }else{
      toast("That reminder choice is not valid.","error");
      return;
    }
    showAiReminderDraft();
  }
  function applyAiReminderDraft() {
    if(!requireAdminAction("apply an Ai-Ai reminder draft")||!aiReminderDraft)return;
    const draft={...aiReminderDraft};
    if(!draft.title||!draft.description||!draft.subject||!draft.category||!draft.dueAt||!draft.priority||typeof draft.pinned!=="boolean"){
      toast("Complete all reminder details in the chat before applying the draft.","error");
      return;
    }
    closeAiAssistant();
    adminTab="reminders";
    if(activeView!=="admin")switchView("admin");
    else renderActiveView();
    reminderForm(draft);
  }
  function handleAiCustomDate(button) {
    if(!Security.isAdminAuthenticated()||!aiReminderDraft)return;
    const input=$("[data-ai-custom-date]",button.closest(".ai-message"));
    if(!input?.value){
      toast("Choose a due date and time first.","error");
      input?.focus();
      return;
    }
    const date=new Date(input.value);
    if(Number.isNaN(date.getTime())){
      toast("Choose a valid due date and time.","error");
      return;
    }
    aiReminderDraft.dueAt=date.toISOString();
    aiReminderDraft.customDateVisible=false;
    showAiReminderDraft();
  }
  function trimAiHistory() {
    while(aiMessages.length>12)aiMessages.shift();
    if(aiMessages[0]?.role==="assistant")aiMessages.shift();
  }
  async function sendAiMessage(text) {
    const question=text.trim();
    if(!question||aiBusy)return;
    if(Security.isAdminAuthenticated()){
      if(/\b(add|create|draft|write|post|make)\b/i.test(question)&&/\b(reminder|quiz|exam|assignment|project|general notice|class notice)\b/i.test(question)){
        aiReminderDraft=reminderDraftFromPrompt(question);
        appendAiMessage("user",question);
        $("#ai-chat-input").value="";
        showAiReminderDraft();
      }else{
        openAdminAiWorkspace(question);
      }
      return;
    }
    aiMessages.push({role:"user",text:question});
    trimAiHistory();
    appendAiMessage("user",question);
    const input=$("#ai-chat-input"),send=$("#ai-chat-send");
    const thinking=appendAiMessage("assistant","BETTIE is generating a response…");
    const requestController=new AbortController();
    aiRequestController=requestController;
    aiBusy=true;input.disabled=true;send.disabled=true;
    send.classList.add("is-loading");
    send.setAttribute("aria-label","BETTIE is generating response");
    send.innerHTML='<span class="ai-spinner" aria-hidden="true"></span><span>BETTIE is generating response...</span>';
    try{
      const response=await fetch("/api/ai/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:aiMessages}),
        credentials:"same-origin",
        cache:"no-store",
        redirect:"error",
        signal:requestController.signal
      });
      const result=await response.json();
      if(aiRequestController!==requestController)return;
      if(!response.ok){
        const error=new Error(result.details||result.error||`Request failed (${response.status}).`);
        error.status=response.status;
        error.code=result.error;
        throw error;
      }
      if(typeof result?.answer!=="string"||!result.answer.trim())throw new Error("The AI service returned an empty response.");
      aiMessages.push({role:"assistant",text:result.answer});
      trimAiHistory();
      thinking.querySelector(".ai-message-content").innerHTML=renderMarkdown(result.answer);
      $("#ai-chat-messages").scrollTop=$("#ai-chat-messages").scrollHeight;
    }catch(error){
      if(aiRequestController!==requestController||error.name==="AbortError")return;
      aiMessages.pop();
      thinking.classList.add("error");
      thinking.textContent=error.code==="AI_BUSY"||error.status===429
        ?"BETTIE is currently assisting many CYB-202 students! Please try your question again in 10 seconds."
        :error.message||"BETTIE could not answer. Please try again.";
    }finally{
      if(aiRequestController===requestController){
        aiRequestController=null;
        aiBusy=false;input.disabled=false;send.disabled=false;send.classList.remove("is-loading");
        send.setAttribute("aria-label","Send message");
        send.innerHTML=icon("send");
        refreshIcons(send);
        input.value="";input.focus();
      }
    }
  }
  async function initialize() {
    loadThemePreference();
    try{
      currentSession=await Security.refreshSession();
      syncAiWidgetPersona(Security.isAdminAuthenticated());
      const result=await Security.request("/api/state");
      state=clone(Security.validateClassState(result.state));revision=result.revision;lastStateSync=Date.now();
      setConnection(true);
    }catch(error){
      setConnection(false,error.message.includes("fetch")?"Could not reach the CYB-202 server. Run `npm start` and open http://localhost:3000. Shared edits are unavailable.":"The CYB-202 server could not be reached. Shared editing is unavailable.");
      console.error("Initial class data load failed:",error);
      syncAiWidgetPersona(Security.isAdminAuthenticated());
    }
    setRoleIndicator();
    renderNavigation();
    renderEmergency();
    renderActiveView();
    renderClock();
    refreshIcons($("#ai-assistant"));
    window.setInterval(renderClock,1000);
    window.setInterval(syncState,30_000);
    window.setInterval(()=>{
      if(Security.isAdminAuthenticated()&&Date.now()-lastActivity>=30*60_000){
        logout();
        toast("Admin session expired after 30 minutes without activity.","warning");
      }
    },15_000);
  }

  $("#primary-nav").addEventListener("click",event=>{
    const button=event.target.closest("[data-view]");
    if(button)switchView(button.dataset.view);
  });
  $("#primary-nav").addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight"].includes(event.key))return;
    const tabs=$$("[role=tab]",$("#primary-nav")),index=tabs.indexOf(document.activeElement);
    if(index<0)return;
    event.preventDefault();
    const next=(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    tabs[next].focus();tabs[next].click();
  });
  $("#ai-assistant-trigger").addEventListener("click",openAiAssistant);
  $("#ai-chat-close").addEventListener("click",closeAiAssistant);
  $("#appearance-trigger").addEventListener("click",()=>{
    const panel=$("#appearance-panel");
    panel.hidden=!panel.hidden;
    $("#appearance-trigger").setAttribute("aria-expanded",String(!panel.hidden));
    if(!panel.hidden)$("#appearance-close").focus();
  });
  $("#appearance-close").addEventListener("click",()=>{
    closeAppearancePanel();
    $("#appearance-trigger").focus();
  });
  $$("[data-theme]").forEach(button=>button.addEventListener("click",()=>applyTheme(button.dataset.theme)));
  $("#custom-theme-color").addEventListener("input",event=>applyTheme(`custom:${event.currentTarget.value}`));
  $("#ai-chat-form").addEventListener("submit",event=>{
    event.preventDefault();
    sendAiMessage($("#ai-chat-input").value);
  });
  document.addEventListener("click",event=>{
    if(!event.target.closest("#appearance-panel")&&!event.target.closest("#appearance-trigger"))closeAppearancePanel();
    if(event.target.closest("[data-reminder-date-clear]")){
      reminderDateFilter="";
      if(activeView==="reminders")renderActiveView();
      return;
    }
    const aiChoice=event.target.closest("[data-ai-choice-field]");
    if(aiChoice){handleAiDraftChoice(aiChoice);return;}
    const aiAction=event.target.closest("[data-ai-action]");
    if(aiAction?.dataset.aiAction==="use-custom-date"){handleAiCustomDate(aiAction);return;}
    const prompt=event.target.closest("[data-ai-prompt]");
    if(prompt){openAiAssistant();$("#ai-chat-input").value=prompt.dataset.aiPrompt;sendAiMessage(prompt.dataset.aiPrompt);return;}
    const view=event.target.closest("[data-view]");
    if(view){switchView(view.dataset.view);return;}
    const filter=event.target.closest("[data-filter-reminders]");
    if(filter){reminderFilter=filter.dataset.filterReminders;renderActiveView();return;}
    const adminTabButton=event.target.closest("[data-admin-tab]");
    if(adminTabButton){if(!Security.requireAdmin("open an admin management tab")){loginModal();return;}if(adminTabButton.dataset.adminTab==="ai"){openAdminAiWorkspace();return;}adminTab=adminTabButton.dataset.adminTab;if(activeView!=="admin")switchView("admin");else renderActiveView();return;}
    const actionButton=event.target.closest("[data-action]");
    if(actionButton){handleAction(actionButton.dataset.action,actionButton);return;}
    const paletteButton=event.target.closest("[data-palette-index]");
    if(paletteButton){const item=searchResults[Number(paletteButton.dataset.paletteIndex)];if(item){closePalette();switchView(item.view);}return;}
    const adminButton=event.target.closest("#admin-trigger");
    if(adminButton){if(Security.isAdminAuthenticated())confirmModal("Sign out of admin view?","Signing out makes all shared class content read-only on this device.",logout,"Sign out");else loginModal();}
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="reminder-date-filter"){
      reminderDateFilter=event.target.value;
      renderActiveView();
    }
  });
  document.addEventListener("submit",handleFormSubmit);
  document.addEventListener("click",event=>{
    const backdrop=event.target.closest("[data-modal-backdrop]");
    if(backdrop&&event.target===backdrop)closeModal();
    const paletteBackdrop=event.target.closest("[data-palette-backdrop]");
    if(paletteBackdrop&&event.target===paletteBackdrop)closePalette();
  });
  document.addEventListener("keydown",event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();openPalette();}
    if(event.key==="Escape"){
      closeModal();closePalette();
      if(!$("#appearance-panel").hidden){closeAppearancePanel();$("#appearance-trigger").focus();}
      if(!$("#ai-chat").hidden)closeAiAssistant();
    }
  });
  $("#search-trigger").addEventListener("click",openPalette);
  $("#import-file").addEventListener("change",event=>{
    const file=event.target.files?.[0];if(file)importStateFile(file);event.target.value="";
  });
  $("#view-root").addEventListener("dragover",event=>{
    const zone=event.target.closest("#drop-zone");if(zone){event.preventDefault();zone.classList.add("drag-over");}
  });
  $("#view-root").addEventListener("dragleave",event=>{
    const zone=event.target.closest("#drop-zone");if(zone)zone.classList.remove("drag-over");
  });
  $("#view-root").addEventListener("drop",event=>{
    const zone=event.target.closest("#drop-zone");if(!zone)return;
    event.preventDefault();zone.classList.remove("drag-over");
    const file=event.dataTransfer.files?.[0];if(file)importStateFile(file);
  });
  document.addEventListener("pointerdown",()=>{lastActivity=Date.now();},{passive:true});
  document.addEventListener("keydown",()=>{lastActivity=Date.now();},{passive:true});
  document.addEventListener("cyb202:security-event",event=>toast(event.detail.reason,"warning"));
  window.addEventListener("online",()=>fetchSharedState().catch(error=>{setConnection(false);console.error(error);}));
  window.addEventListener("offline",()=>setConnection(false,"You are offline. Shared class data is shown read-only until the server is reachable."));

  initialize();
})();
