// Survey Studio prototype (UC-01) — the words used for item types, statement roles and lifecycle roles, in one place.
import type { AnswerType, QuestionRole, StatementRole } from './model/types';

export const ITEM_LABEL: Record<AnswerType, string> = {
  YES_NO: 'Yes / No', SINGLE_SELECT: 'Single choice', MULTI_SELECT: 'Multiple choice', FREE_TEXT: 'Free text', NUMERIC: 'Number', ACKNOWLEDGEMENT: 'Acknowledgement', STATEMENT: 'Statement',
};
export const STATEMENT_LABEL: Record<StatementRole, string> = { OPENING: 'Opening', TRANSITION: 'Transition', DISCLOSURE: 'Disclosure', CLOSING: 'Closing' };
export const STATEMENT_HINT: Record<StatementRole, string> = {
  OPENING: 'Introduces the call.', TRANSITION: 'Moves the call from one topic to the next.', DISCLOSURE: 'Something the customer must be told.', CLOSING: 'Ends the call.',
};
export const ROLE_LABEL: Record<QuestionRole, string> = {
  IDENTITY_CHECK: 'Identity check', CONSENT_TO_PROCEED: 'Consent to proceed', RECORDING_CONSENT: 'Recording consent', CLOUD_PROCESSING_CONSENT: 'Cloud-processing consent',
};
