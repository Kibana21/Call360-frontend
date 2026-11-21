/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** "1" enables the Survey Studio prototype (SS-02A). Off by default. */
  readonly VITE_SURVEY_STUDIO_PROTOTYPE?: string;
  readonly VITE_SURVEY_STUDIO_PERSISTED?: string;
}
