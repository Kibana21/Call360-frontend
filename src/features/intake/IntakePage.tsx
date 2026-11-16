// Data Intake (`/intake`, ADMIN), CP0.4b manual-intake portal: sources (API-080), the Manual Intake form backed by
// reference data (API-087), server preview (API-084), idempotent submit (API-085) and intake-run history
// (API-082/083). Follows the mockup's "Data Integrations" screen; mock sync and corrections remain deferred.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Forbidden } from '../../components/StateView';
import { Badge, Card, PageHead, StageChip } from '../../components/ui';
import { Region } from '../cases/shared';
import { IntakeHistory } from './IntakeHistory';
import { ManualIntake } from './ManualIntake';

export function IntakePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'manual';
  const allowed = can('intake.read');
  const sources = useQuery({
    queryKey: ['intake', 'sources'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/intake/sources')),
  });
  if (!allowed) return <Forbidden />;
  const setTab = (t: 'manual' | 'history') => setParams((p) => {
    const n = new URLSearchParams(p);
    if (t === 'history') n.set('tab', 'history'); else { n.delete('tab'); n.delete('run'); }
    return n;
  });

  return (
    <>
      <PageHead eyebrow="External data & controlled intake" title="Data Intake"
        description="Submit a synthetic Singapore policy-sale transaction through the same validated, audited intake API used by integrations. Call360 stores the source risk, due date and priority as supplied; it does not score risk or select scripts."
        actions={<>
          <Badge tone="blue">Synthetic only · Singapore</Badge>
        </>} />

      <Card title="Sources" subtitle="Intake sources in this environment" pad>
        <Region query={sources} label="intake sources">
          {() => (
            <div className="layout cols-4 intake-sources">
              {sources.data!.items.map((s) => (
                <div key={s.source_type} className="softbox" data-testid={`source-${s.source_type}`}>
                  <div className="row between wrap">
                    <strong className="small">{SOURCE_LABELS[s.source_type] ?? s.source_type}</strong>
                    {s.available ? <Badge tone="green">Available</Badge> : <StageChip label="Not available" />}
                  </div>
                  <p className="xsmall muted" style={{ margin: '8px 0 0', lineHeight: 1.6 }}>{s.note}</p>
                </div>
              ))}
            </div>
          )}
        </Region>
      </Card>

      <div className="subtabs" role="tablist" aria-label="Data Intake views" style={{ margin: '19px 0 16px' }}>
        <button type="button" role="tab" id="tab-manual" aria-selected={tab === 'manual'} aria-controls="panel-manual"
          className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}>Manual intake</button>
        <button type="button" role="tab" id="tab-history" aria-selected={tab === 'history'} aria-controls="panel-history"
          className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Intake history</button>
      </div>
      {tab === 'manual' ? (
        <div role="tabpanel" id="panel-manual" aria-labelledby="tab-manual">
          {can('intake.manual.submit') ? <ManualIntake onShowRun={(id) => setParams({ tab: 'history', run: id })} />
            : <Card><Forbidden /></Card>}
        </div>
      ) : (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <IntakeHistory runId={params.get('run')} onOpen={(id) => setParams((p) => {
            const n = new URLSearchParams(p);
            if (id) n.set('run', id); else n.delete('run');
            return n;
          })} />
        </div>
      )}
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual intake', MOCK_API: 'Mock upstream API', BULK: 'Bulk file import', INTERNAL_API: 'Internal company APIs',
};
