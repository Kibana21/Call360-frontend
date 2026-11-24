// Survey Applicability Studio (APPL-X1) — a PROTOTYPE, off unless the build setting VITE_SURVEY_APPLICABILITY=1 is
// given. With it off no route, navigation entry or label of it exists. It lives inside persisted Survey Studio.
export const applicabilityEnabled = (): boolean => import.meta.env.VITE_SURVEY_APPLICABILITY === '1';
// APPL-X2: with VITE_APPLICABILITY_LIBRARY=1 the variable, profile and condition libraries are SAVED in Call360 (the
// backend's applicability library, migration 0038). Without it they stay in the tab, exactly as in the prototype.
export const applicabilityLibrary = (): boolean => import.meta.env.VITE_APPLICABILITY_LIBRARY === '1';
// APPL-X3: with VITE_APPLICABILITY_POLICIES=1 (and the library) applicability POLICIES are saved in Call360 as working
// drafts (migration 0039). Without it they stay in the tab, exactly as before. Scenarios stay in the tab either way.
export const applicabilityPolicies = (): boolean => applicabilityLibrary() && import.meta.env.VITE_APPLICABILITY_POLICIES === '1';
