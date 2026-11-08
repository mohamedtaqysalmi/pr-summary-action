(() => {
  const steps = ["read", "ignore", "redact", "lint", "comment"];
  const runBtn = document.getElementById("run-sim");
  const resetBtn = document.getElementById("reset-sim");
  const status = document.getElementById("status");
  const comment = document.getElementById("comment");
  const commentBody = document.getElementById("comment-body");
  const badge = document.getElementById("badge");
  const langSelect = document.getElementById("lang");
  const pipeline = document.getElementById("pipeline");

  const copy = {
    en: {
      badge: "dry-run · llm skipped",
      statusDone:
        "Dry-run complete. Model skipped (no API key). Comment not posted — preview only.",
      summaryTitle: "Summary",
      summary:
        "No model was called. This note only counts the diff and commit messages locally. It is not a review.",
      filesTitle: "Files",
      kept: "Kept",
      ignored: "Ignored",
      redactions: "Redactions",
      risksTitle: "Risks",
      risks: "Risks were not assessed because no model was called.",
      testTitle: "Test plan",
      test: "No test plan was proposed because no model was called.",
      commitsTitle: "Commit message review",
      commits: [
        "`aaaaaaa` feat(auth): shorten session ttl — ok",
        "`bbbbbbb` update stuff — needs changes (not-conventional)",
        "`ccccccc` fix(config): remove sample credential — ok",
      ],
    },
    fr: {
      badge: "dry-run · llm ignoré",
      statusDone:
        "Dry-run terminé. Modèle ignoré (pas de clé). Commentaire non publié — aperçu seulement.",
      summaryTitle: "Résumé",
      summary:
        "Aucun modèle n’a été appelé. Cette note compte seulement le diff et les commits. Ce n’est pas une revue.",
      filesTitle: "Fichiers",
      kept: "Conservés",
      ignored: "Ignorés",
      redactions: "Redactions",
      risksTitle: "Risques",
      risks: "Les risques n’ont pas été évalués faute d’appel au modèle.",
      testTitle: "Plan de test",
      test: "Aucun plan de test n’a été proposé faute d’appel au modèle.",
      commitsTitle: "Revue des messages de commit",
      commits: [
        "`aaaaaaa` feat(auth): shorten session ttl — ok",
        "`bbbbbbb` update stuff — à revoir (pas Conventional Commit)",
        "`ccccccc` fix(config): remove sample credential — ok",
      ],
    },
    darija: {
      badge: "dry-run · llm ma tcallash",
      statusDone:
        "Dry-run salā. Model ma tcallash (bla API key). Comment ma tpostāsh — ghir preview.",
      summaryTitle: "ملخص / Summary",
      summary:
        "Ma kayn ḥta model call. Had note katḥseb ghir diff w commits. Mashi review ḥqiqi.",
      filesTitle: "الملفات / Files",
      kept: "Kept",
      ignored: "Ignored",
      redactions: "Redactions",
      risksTitle: "المخاطر / Risks",
      risks: "Risks ma tqayymūsh ḥit model ma tcallash.",
      testTitle: "خطة الاختبار / Test plan",
      test: "Test plan ma tqtarḥsh ḥit model ma tcallash.",
      commitsTitle: "مراجعة الـ commits",
      commits: [
        "`aaaaaaa` feat(auth): shorten session ttl — ok",
        "`bbbbbbb` update stuff — khass tbeddel (not-conventional)",
        "`ccccccc` fix(config): remove sample credential — ok",
      ],
    },
  };

  let timerIds = [];
  let running = false;

  function clearTimers() {
    timerIds.forEach((id) => clearTimeout(id));
    timerIds = [];
  }

  function setStepState(activeIndex) {
    const items = pipeline.querySelectorAll("li");
    items.forEach((li, i) => {
      li.classList.remove("active", "done");
      if (i < activeIndex) li.classList.add("done");
      if (i === activeIndex) li.classList.add("active");
    });
  }

  function renderComment(lang) {
    const t = copy[lang] || copy.en;
    badge.textContent = t.badge;
    commentBody.dir = lang === "darija" ? "rtl" : "ltr";
    commentBody.lang = lang === "darija" ? "ar" : lang;
    commentBody.innerHTML = `
      <h4>${t.summaryTitle}</h4>
      <p>${t.summary}</p>
      <h4>${t.filesTitle}</h4>
      <p><strong>${t.kept}</strong></p>
      <ul>
        <li>src/auth/session.ts</li>
        <li>src/auth/session.test.ts</li>
        <li>src/config/example.ts</li>
        <li>assets/logo.png</li>
        <li>src/auth/names.ts</li>
      </ul>
      <p><strong>${t.ignored}</strong></p>
      <ul><li>package-lock.json</li></ul>
      <p><strong>${t.redactions}:</strong> 5</p>
      <ul class="redact">
        <li>private-key: 1</li>
        <li>aws-access-key-id: 1</li>
        <li>github-token: 1</li>
        <li>assigned-secret: 2</li>
      </ul>
      <h4>${t.risksTitle}</h4>
      <p>${t.risks}</p>
      <h4>${t.testTitle}</h4>
      <p>${t.test}</p>
      <h4>${t.commitsTitle}</h4>
      <ul>${t.commits.map((c) => `<li>${c}</li>`).join("")}</ul>
      <p style="color:var(--muted);font-size:0.85rem;margin-top:0.8rem">
        Produced by pr-summary-action 0.1.0 · simulation
      </p>
    `;
  }

  function reset() {
    clearTimers();
    running = false;
    setStepState(-1);
    comment.hidden = true;
    commentBody.innerHTML = "";
    status.textContent =
      "Idle — press Simulate dry-run to watch the pipeline.";
    runBtn.disabled = false;
    resetBtn.disabled = true;
  }

  function run() {
    if (running) return;
    running = true;
    clearTimers();
    comment.hidden = true;
    runBtn.disabled = true;
    resetBtn.disabled = false;
    const lang = langSelect.value;
    const t = copy[lang] || copy.en;

    const messages = [
      "Reading fixture diff…",
      "Dropping ignore globs (package-lock.json)…",
      "Redacting secret patterns (5 hits)…",
      "Linting Conventional Commit subjects…",
      "Rendering marker comment (not posted)…",
    ];

    steps.forEach((_, i) => {
      const id = setTimeout(() => {
        setStepState(i);
        status.textContent = messages[i];
        if (i === steps.length - 1) {
          const doneId = setTimeout(() => {
            setStepState(steps.length);
            renderComment(lang);
            comment.hidden = false;
            status.textContent = t.statusDone;
            running = false;
            runBtn.disabled = false;
          }, 420);
          timerIds.push(doneId);
        }
      }, i * 650);
      timerIds.push(id);
    });
  }

  runBtn.addEventListener("click", run);
  resetBtn.addEventListener("click", reset);
  langSelect.addEventListener("change", () => {
    if (!comment.hidden) renderComment(langSelect.value);
  });

  reset();
})();
