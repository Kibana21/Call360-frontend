/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "1" enables the Survey Studio prototype (SS-02A). Off by default. */
  readonly VITE_SURVEY_STUDIO_PROTOTYPE?: string;
  readonly VITE_SURVEY_STUDIO_PERSISTED?: string;
  /** "1" enables the Survey Applicability prototype (APPL-X1) inside persisted Survey Studio. Off by default. */
  readonly VITE_SURVEY_APPLICABILITY?: string;
}
