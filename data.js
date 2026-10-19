/* Immutable section seed data. Required by both the browser and the Node server. */
(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.CYB202_DATA = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  };

  const dayKeys = Object.freeze({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
  const reminderCategories = Object.freeze(["Quiz", "Quarterly Exam", "Exam", "Assignment", "Project", "General"]);
  const timetable = [
    { id:"sched-2119-tue", code:"2119", subject:"4READPHILHIS", title:"Readings in Philippine History", day:"Tue", start:"13:20", end:"14:50", room:"SJH-504" },
    { id:"sched-2119-fri", code:"2119", subject:"4READPHILHIS", title:"Readings in Philippine History", day:"Fri", start:"13:20", end:"14:50", room:"SJH-504" },
    { id:"sched-2120-tue", code:"2120", subject:"2PROBSTAT", title:"Probability and Statistics", day:"Tue", start:"14:55", end:"16:25", room:"SJH-504" },
    { id:"sched-2120-fri", code:"2120", subject:"2PROBSTAT", title:"Probability and Statistics", day:"Fri", start:"14:55", end:"16:25", room:"SJH-504" },
    { id:"sched-2121-mon", code:"2121", subject:"6ITN", title:"Introduction to Networks", day:"Mon", start:"12:00", end:"14:00", room:"SJH-610" },
    { id:"sched-2121-wed", code:"2121", subject:"6ITN", title:"Introduction to Networks", day:"Wed", start:"14:30", end:"17:30", room:"SJH-702" },
    { id:"sched-2122-wed", code:"2122", subject:"6DASALGO", title:"Design and Analysis of Algorithms", day:"Wed", start:"08:35", end:"10:05", room:"SJH-504" },
    { id:"sched-2122-sat", code:"2122", subject:"6DASALGO", title:"Design and Analysis of Algorithms", day:"Sat", start:"08:35", end:"10:05", room:"SJH-504" },
    { id:"sched-2123-thu", code:"2123", subject:"6IMAN", title:"Information Management", day:"Thu", start:"10:15", end:"13:15", room:"MGN-202" },
    { id:"sched-2123-fri", code:"2123", subject:"6IMAN", title:"Information Management", day:"Fri", start:"09:10", end:"11:10", room:"SJH-610" },
    { id:"sched-2124-thu", code:"2124", subject:"6DWEB", title:"Dynamic Web Applications and Development Tools", day:"Thu", start:"14:00", end:"17:00", room:"MGN-202" },
    { id:"sched-2125-tue", code:"2125", subject:"THEOLOGY103", title:"Christian Spirituality in the Contemporary World", day:"Tue", start:"16:30", end:"18:00", room:"SJH-504" },
    { id:"sched-2125-fri", code:"2125", subject:"THEOLOGY103", title:"Christian Spirituality in the Contemporary World", day:"Fri", start:"16:30", end:"18:00", room:"SJH-504" },
    { id:"sched-9214-mon", code:"9214", subject:"7TPE4", title:"Select Physical Activities Toward Health and Fitness 4", day:"Mon", start:"14:05", end:"16:05", room:"IHM-GYM" }
  ];
  const subjects = [
    { id:"subject-4readphilhis", code:"4READPHILHIS", title:"Readings in Philippine History", classCode:"2119" },
    { id:"subject-2probstat", code:"2PROBSTAT", title:"Probability and Statistics", classCode:"2120" },
    { id:"subject-6itn", code:"6ITN", title:"Introduction to Networks", classCode:"2121" },
    { id:"subject-6dasalgo", code:"6DASALGO", title:"Design and Analysis of Algorithms", classCode:"2122" },
    { id:"subject-6iman", code:"6IMAN", title:"Information Management", classCode:"2123" },
    { id:"subject-6dweb", code:"6DWEB", title:"Dynamic Web Applications and Development Tools", classCode:"2124" },
    { id:"subject-theology103", code:"THEOLOGY103", title:"Christian Spirituality in the Contemporary World", classCode:"2125" },
    { id:"subject-7tpe4", code:"7TPE4", title:"Select Physical Activities Toward Health and Fitness 4", classCode:"9214" }
  ];
  const reviewGuides = [
    { id:"guide-4read", subject:"4READPHILHIS", title:"Readings in Philippine History", summary:"Analyze primary sources by provenance, context, audience, purpose, and point of view. Corroborate claims across independent accounts.", topics:["Primary vs. secondary sources","Historical context and perspective","Source corroboration"], formulas:"Source analysis: Who made it? When? For whom? Why? What is missing?", downloadUrl:"", snippets:[] },
    { id:"guide-prob", subject:"2PROBSTAT", title:"Probability and Statistics", summary:"Choose probability models that fit their assumptions; distinguish sample statistics from population parameters.", topics:["Conditional probability","Random variables and distributions","Sampling and inference"], formulas:"P(A|B) = P(A ∩ B) / P(B)  ·  z = (x̄ − μ) / (σ / √n)", downloadUrl:"", snippets:[] },
    { id:"guide-itn", subject:"6ITN", title:"Introduction to Networks", summary:"Work from link state through addressing, switching, and routing. Verify each hop and reason about packet paths.", topics:["OSI model layers","IPv4 subnetting and VLSM","VLANs and routing"], formulas:"Usable IPv4 hosts = 2^(host bits) − 2  ·  CIDR prefix = 32 − host bits", downloadUrl:"", snippets:["enable\nconfigure terminal\ninterface g0/0\nip address 192.0.2.1 255.255.255.0\nno shutdown\nshow ip interface brief"] },
    { id:"guide-algo", subject:"6DASALGO", title:"Design and Analysis of Algorithms", summary:"Select algorithms by correctness, input constraints, and asymptotic performance; explain invariants and trade-offs.", topics:["Big-O, Θ, and Ω","Divide and conquer vs. dynamic programming","Sorting and graph traversal"], formulas:"Binary search O(log n) · Merge sort O(n log n) · BFS O(V + E)", downloadUrl:"", snippets:["Insertion sort: O(n²) worst / O(n) best\nMerge sort: O(n log n) time / O(n) extra space\nBinary search: O(log n) time / O(1) iterative space"] },
    { id:"guide-iman", subject:"6IMAN", title:"Information Management", summary:"Model entities and relationships, normalize to reduce anomalies, and use SQL constraints and transactions.", topics:["ER diagrams, keys, and relationships","Normalization: 1NF, 2NF, 3NF","SQL DDL/DML and JOIN types"], formulas:"1NF: atomic values · 2NF: no partial dependency · 3NF: no transitive dependency", downloadUrl:"", snippets:["CREATE TABLE student (\n  id INTEGER PRIMARY KEY,\n  name VARCHAR(120) NOT NULL\n);\n\nSELECT s.name, c.title\nFROM student AS s\nJOIN enrollment AS e ON e.student_id = s.id\nJOIN course AS c ON c.id = e.course_id;"] },
    { id:"guide-dweb", subject:"6DWEB", title:"Dynamic Web Applications and Development Tools", summary:"Build accessible responsive interfaces with predictable state. Validate input, handle errors, and test mobile layouts.", topics:["Semantic HTML5 and accessibility","Flexbox and Grid","JavaScript async/await and Fetch"], formulas:"GET retrieve · POST create · PUT/PATCH update · DELETE remove", downloadUrl:"", snippets:["const response = await fetch('/api/state');\nif (!response.ok) throw new Error('Request failed');\nconst state = await response.json();"] },
    { id:"guide-theology", subject:"THEOLOGY103", title:"Christian Spirituality in the Contemporary World", summary:"Connect spirituality with lived experience, ethical action, community, and contemporary social realities.", topics:["Discernment and conscience","Community and service","Faith in contemporary life"], formulas:"Reflection: experience → interpretation → response", downloadUrl:"", snippets:[] },
    { id:"guide-tpe", subject:"7TPE4", title:"Select Physical Activities Toward Health and Fitness 4", summary:"Build sustainable activity habits through safe participation, movement quality, fitness awareness, and teamwork.", topics:["Warm-up and recovery","Movement skills","Fitness and wellbeing"], formulas:"Progress gradually · hydrate · stop when pain or unusual symptoms occur", downloadUrl:"", snippets:[] }
  ];
  const cheatSheets = [
    { id:"linux-tools", group:"Linux / Cyber Terminal", title:"Common CLI tools", code:"nmap -sV <authorized-lab-host>\ntraceroute <host>\nssh user@host\nchmod 640 file.txt\ngrep -R \"pattern\" ./directory\nsystemctl status <service>", description:"Use network scanning examples only on systems you own or are explicitly authorized to assess." },
    { id:"linux-inspect", group:"Linux / Cyber Terminal", title:"Inspect files and processes", code:"pwd\nls -lah\nfind . -maxdepth 2 -type f\nps aux | head\nip address\nss -tulpn", description:"Basic host and process inspection commands." },
    { id:"cisco-ios", group:"Cisco IOS", title:"Interface setup and verification", code:"enable\nconfigure terminal\ninterface g0/0\ndescription CYB-202 lab interface\nip address 192.0.2.1 255.255.255.0\nno shutdown\nend\nshow ip interface brief", description:"Replace example addresses with your instructor-provided lab values." },
    { id:"sql-template", group:"SQL", title:"DDL, DML, and joins", code:"CREATE TABLE example (\n  id INTEGER PRIMARY KEY,\n  label VARCHAR(120) NOT NULL\n);\n\nSELECT a.label, b.value\nFROM table_a AS a\nLEFT JOIN table_b AS b ON b.a_id = a.id;", description:"Use bound parameters for values in application queries." },
    { id:"web-reference", group:"Web development", title:"Semantic layout and async fetch", code:"<main>\n  <section aria-labelledby=\"heading\">\n    <h2 id=\"heading\">Section title</h2>\n  </section>\n</main>\n\nconst response = await fetch('/api/state');\nif (!response.ok) throw new Error('Request failed');\nconst state = await response.json();", description:"Prefer semantic HTML and handle unsuccessful HTTP responses explicitly." }
  ];
  const defaultState = {
    schemaVersion: 1,
    schedule: timetable,
    subjects,
    reminders: [
      { id:"reminder-welcome", title:"Welcome to the CYB-202 semester hub", subject:"ALL", category:"General", description:"Class reminders and deadlines should be confirmed with the relevant instructor or official HAU channels. Admins can publish updates here.", externalLink:"", dueAt:"", priority:"Low", pinned:true, createdAt:"2026-01-01T00:00:00.000Z" }
    ],
    reviews: reviewGuides,
    cheatSheets,
    scheduleOverrides: [],
    emergencyBanner: { active:false, message:"", updatedAt:"" }
  };
  return freeze({ dayKeys, reminderCategories, roomGuide: {
    SJH:"St. Joseph Hall (Main Academic Building)",
    MGN:"Archbishop Miguel Febres Cordero Hall",
    IHM:"Institute of Hotel Management Gym / Complex"
  }, defaultState });
});
