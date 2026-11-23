// SHARED-1 — Assignment Rules and Finding Rules are shared capabilities with permissions of their own. Until those are
// granted, the script permission that has always governed each action keeps working: a capability is allowed by
// EITHER. This only decides what the interface offers; the server checks the same two permissions on every operation.
export type RuleFamily = 'assignment_rule' | 'finding_rule';
export type RuleAction = 'read' | 'edit' | 'approve' | 'publish';
export const capability = (can: (permission: string) => boolean, family: RuleFamily) => (action: RuleAction): boolean => can(`${family}.${action}`) || can(`script.${action}`);
/** The permissions that let a person open a shared rule capability, for a route guard or a navigation entry. */
export const readersOf = (family: RuleFamily): string[] => [`${family}.read`, 'script.read'];
