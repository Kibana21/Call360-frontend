// Survey Studio prototype (SS-02A) is OFF unless the build setting VITE_SURVEY_STUDIO_PROTOTYPE=1 is given.
// With it off, no route, navigation entry or label of the prototype exists in the product (ADR-0010 §8).
export const surveyStudioEnabled = (): boolean => import.meta.env.VITE_SURVEY_STUDIO_PROTOTYPE === '1';

// FI-1 — the PERSISTED mode: Survey Studio on the real survey-definition API (saved to PostgreSQL). A SEPARATE build
// setting, also OFF unless VITE_SURVEY_STUDIO_PERSISTED=1 is given. With it on, /survey-studio is the persisted
// application and needs the `survey.read` permission; the in-memory prototype above is untouched and still runs with
// its own setting alone.
export const surveyStudioPersisted = (): boolean => import.meta.env.VITE_SURVEY_STUDIO_PERSISTED === '1';
/** True when either mode is on: the route and the navigation entry exist. */
export const surveyStudioVisible = (): boolean => surveyStudioEnabled() || surveyStudioPersisted();
