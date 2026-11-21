// Survey Studio prototype (SS-02A) is OFF unless the build setting VITE_SURVEY_STUDIO_PROTOTYPE=1 is given.
// With it off, no route, navigation entry or label of the prototype exists in the product (ADR-0010 §8).
export const surveyStudioEnabled = (): boolean => import.meta.env.VITE_SURVEY_STUDIO_PROTOTYPE === '1';
