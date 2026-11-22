// Survey Studio (LIB-2) — WHERE the open workspace lives. The composer, the module builder and the review screens are
// shared by a survey and by a module authored on its own; the only things that differ are the address they sit under
// and the steps around them. This says which, so no screen builds an address of its own.
import { createContext, useContext, type ReactNode } from 'react';

export interface Place {
  /** `survey`: a survey and its modules. `module`: ONE reusable module authored on its own (no survey). */
  mode: 'survey' | 'module';
  base: string;
  /** Shown at the top of the review page (a module shows the library card it will have). */
  reviewLead?: ReactNode;
}
const Ctx = createContext<Place | null>(null);
export const PlaceProvider = Ctx.Provider;
/** The place of the open workspace; without a provider, the survey of that code (as it always was). */
export const usePlace = (surveyCode = ''): Place => useContext(Ctx) ?? { mode: 'survey', base: `/survey-studio/surveys/${surveyCode}` };
