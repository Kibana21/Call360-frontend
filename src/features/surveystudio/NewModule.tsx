// Survey Studio prototype — Create Blank Module (SS-02A.1). One small inline form used from the composer's
// "Add a module here" picker, the library shelf and the Home library. The module is a DRAFT and is shown as one;
// nothing about it is approved or shared.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBlankModule } from './model/ops';
import { KIND_LABEL } from './model/sample';
import type { ModuleKind } from './model/types';
import { useStudio } from './store';

export function NewModuleForm({ place, onDone }: { place?: { surveyId: string; index: number }; onDone: () => void }) {
  const { apply } = useStudio();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ModuleKind>('COMMON');
  const [intent, setIntent] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const made = apply(`Created the blank module "${name.trim()}"`, (w) => createBlankModule(w, { name, kind, intent, place }));
    onDone();
    if (!made) return;
    nav(place && made.instanceId ? `/survey-studio/surveys/${place.surveyId}/modules/${made.instanceId}` : `/survey-studio/modules/${encodeURIComponent(made.moduleKey)}`);
  };
  return (
    <form className="ss-new-module" onSubmit={submit} aria-label="Create a blank module" data-testid="ss-new-module-form">
      <h3>Create a blank module</h3>
      <label className="ss-field"><span>Module name</span>
        <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payment method check" required data-testid="ss-new-module-name" /></label>
      <label className="ss-field"><span>Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ModuleKind)} data-testid="ss-new-module-kind">
          {(Object.keys(KIND_LABEL) as ModuleKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select></label>
      <label className="ss-field"><span>What is it for? <em>optional</em></span>
        <input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="One line others will see in the library" data-testid="ss-new-module-intent" /></label>
      <p className="ss-muted">It starts as a draft with no questions{place ? ', is placed here in the survey,' : ''} and opens ready for the first question.</p>
      <div className="ss-actions">
        <button type="submit" className="ss-btn primary" disabled={!name.trim()} data-testid="ss-new-module-go">Create and open</button>
        <button type="button" className="ss-btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
