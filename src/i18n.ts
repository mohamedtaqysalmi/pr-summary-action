import type { CommitIssueCode, Language } from "./types.js";

export type HeadingKey =
  | "summary"
  | "files"
  | "changes"
  | "risks"
  | "testPlan"
  | "title"
  | "commits"
  | "kept"
  | "ignored"
  | "redactions"
  | "ok";

export type SentenceKey =
  | "notAReview"
  | "noText"
  | "risksNotAssessed"
  | "testsNotAssessed"
  | "titleMissing"
  | "titleFormatOk"
  | "titleFormatBad"
  | "noAreas"
  | "suggestionMissing"
  | "producedBy"
  | "noneProvided";

const HEADINGS: Record<Language, Record<HeadingKey, string>> = {
  en: {
    summary: "Summary",
    files: "Files",
    changes: "Key changes",
    risks: "Risks",
    testPlan: "Test plan",
    title: "Suggested title",
    commits: "Commit message review",
    kept: "Kept",
    ignored: "Ignored",
    redactions: "Redactions",
    ok: "ok",
  },
  fr: {
    summary: "Résumé",
    files: "Fichiers",
    changes: "Changements principaux",
    risks: "Risques",
    testPlan: "Plan de test",
    title: "Titre suggéré",
    commits: "Revue des messages de commit",
    kept: "Conservés",
    ignored: "Ignorés",
    redactions: "Rédactions",
    ok: "valide",
  },
  darija: {
    summary: "الملخص",
    files: "الملفات",
    changes: "التغييرات المهمة",
    risks: "المخاطر",
    testPlan: "خطة التجربة",
    title: "عنوان مقترح",
    commits: "مراجعة الكوميت",
    kept: "لي بقات",
    ignored: "لي تتجاهلات",
    redactions: "التنقيح",
    ok: "صالحة",
  },
};

const SENTENCES: Record<Language, Record<SentenceKey, string>> = {
  en: {
    notAReview:
      "No model was called. This note only counts the diff and commit messages locally. It is not a review.",
    noText: "No reviewable text remained after ignore rules and the size limit.",
    risksNotAssessed: "Risks were not assessed because no model was called.",
    testsNotAssessed: "No test plan was proposed because no model was called.",
    titleMissing: "The model did not suggest a title.",
    titleFormatOk: "The form matches Conventional Commits.",
    titleFormatBad: "The form does not match Conventional Commits.",
    noAreas: "The model did not describe changes by area.",
    suggestionMissing: "No model suggestion.",
    producedBy: "This note was produced by pr-summary-action",
    noneProvided: "None provided by the model.",
  },
  fr: {
    notAReview:
      "Aucun modèle n'a été appelé. Cette note fait seulement le décompte local du diff et des messages de commit. Ce n'est pas une revue.",
    noText: "Aucun texte à relire ne reste après les règles d'exclusion et la limite de taille.",
    risksNotAssessed: "Les risques n'ont pas été évalués, car aucun modèle n'a été appelé.",
    testsNotAssessed: "Aucun plan de test n'a été proposé, car aucun modèle n'a été appelé.",
    titleMissing: "Le modèle n'a pas proposé de titre.",
    titleFormatOk: "La forme respecte Conventional Commits.",
    titleFormatBad: "La forme ne respecte pas Conventional Commits.",
    noAreas: "Le modèle n'a pas décrit les changements par zone.",
    suggestionMissing: "Pas de suggestion du modèle.",
    producedBy: "Cette note a été produite par pr-summary-action",
    noneProvided: "Rien n'a été fourni par le modèle.",
  },
  darija: {
    notAReview:
      "ما تسمّاش أي موديل. هاد الملاحظة غير حساب محلي للفرق ورسائل الكوميت، وماشي مراجعة.",
    noText: "ما بقاش نص قابل للمراجعة من بعد قواعد التجاهل وحد الحجم.",
    risksNotAssessed: "المخاطر ما تقيماتش حيث ما تسمّاش أي موديل.",
    testsNotAssessed: "خطة التجربة ما تقترحاتش حيث ما تسمّاش أي موديل.",
    titleMissing: "الموديل ما عطاش عنوان.",
    titleFormatOk: "الصيغة موافقة لـ Conventional Commits.",
    titleFormatBad: "الصيغة ما موافقاش لـ Conventional Commits.",
    noAreas: "الموديل ما عطاش التغييرات حسب المجال.",
    suggestionMissing: "بلا اقتراح من الموديل.",
    producedBy: "هاد الملاحظة خرجات من pr-summary-action",
    noneProvided: "الموديل ما عطاش حتى حاجة.",
  },
};

const ISSUES: Record<Language, Record<CommitIssueCode, string>> = {
  en: {
    empty: "message is empty",
    "not-conventional": "the first line is not a Conventional Commit",
    "subject-long": "the first line is longer than 72 characters",
    "trailing-period": "the first line ends with a period",
    "body-blank-line": "the body must be separated by a blank line",
  },
  fr: {
    empty: "message vide",
    "not-conventional": "la première ligne n'est pas un Conventional Commit",
    "subject-long": "la première ligne dépasse 72 caractères",
    "trailing-period": "la première ligne se termine par un point",
    "body-blank-line": "le corps doit être séparé par une ligne vide",
  },
  darija: {
    empty: "الرسالة فارغة",
    "not-conventional": "السطر الأول ماشي Conventional Commit",
    "subject-long": "السطر الأول أطول من 72 حرف",
    "trailing-period": "السطر الأول كيسالي بنقطة",
    "body-blank-line": "الجسم خاصو يكون مفصول بسطر فارغ",
  },
};

export function languageLabel(language: Language): string {
  if (language === "fr") {
    return "French";
  }
  if (language === "darija") {
    return "Moroccan Darija (الدارجة) in Arabic script";
  }
  return "English";
}

export function heading(language: Language, key: HeadingKey): string {
  return HEADINGS[language][key];
}

export function sentence(language: Language, key: SentenceKey): string {
  return SENTENCES[language][key];
}

export function issueText(language: Language, code: CommitIssueCode): string {
  return ISSUES[language][code];
}
