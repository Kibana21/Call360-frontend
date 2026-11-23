// Survey Applicability Studio (APPL-X1) — a PROTOTYPE, off unless the build setting VITE_SURVEY_APPLICABILITY=1 is
// given. With it off no route, navigation entry or label of it exists. It lives inside persisted Survey Studio.
export const applicabilityEnabled = (): boolean => import.meta.env.VITE_SURVEY_APPLICABILITY === '1';
