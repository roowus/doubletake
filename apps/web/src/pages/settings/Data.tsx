import { useEffect, useRef, useState } from 'react';
import { api, getToken, type Status } from '../../api';
import { toast } from '../../components/Toast';
import { apiBase } from '../../native';
import { errText, Group, Note, Row, SettingsPage } from './parts';

/** Settings → Data: export for Karakeep and Memos, import from Karakeep, the notes folder. */
export function DataSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [research, setResearch] = useState<'' | 'quick' | 'standard'>('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api
      .status('skip')
      .then(setStatus)
      .catch(() => {});
  }, []);

  const download = async (kind: 'karakeep' | 'memos') => {
    setMsg(null);
    try {
      const res = await fetch(`${apiBase()}/api/export/${kind}`, {
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `doubletake-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMsg(`Export failed: ${errText(e)}`);
    }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg('Importing…');
    try {
      const parsed: unknown = JSON.parse(await f.text());
      const r = await api.importKarakeep(parsed, research || undefined);
      setMsg(null);
      toast(
        `Imported ${r.imported}`,
        `${r.skipped} skipped as already saved or empty, ${r.collections} new collection${r.collections === 1 ? '' : 's'}${r.runs ? `, ${r.runs} research runs queued` : ''}`,
      );
    } catch (e) {
      setMsg(`Import failed: ${errText(e)}`);
    }
  };

  return (
    <SettingsPage
      title="Data"
      intro="Everything lives in SQLite on your server. Nothing leaves it unless you export."
    >
      <Group
        title="Export"
        foot="Karakeep JSON keeps links, notes, tags and lists. Memos JSON is one memo per answer."
      >
        <Row
          icon="download"
          label="Export for Karakeep"
          hint="JSON"
          onClick={() => void download('karakeep')}
        />
        <Row
          icon="download"
          label="Export for Memos"
          hint="JSON"
          onClick={() => void download('memos')}
        />
      </Group>

      <Group
        title="Import"
        foot="Karakeep's bookmark export. Already-saved links are skipped, lists become collections."
      >
        <Row
          label="After import"
          hint="Research the imported links"
          control={
            <select
              aria-label="Research imported links"
              value={research}
              onChange={(e) => setResearch(e.target.value as '' | 'quick' | 'standard')}
            >
              <option value="">Don't research</option>
              <option value="quick">Quick</option>
              <option value="standard">Standard</option>
            </select>
          }
        />
        <Row icon="upload" label="Import Karakeep JSON…" onClick={() => file.current?.click()} />
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </Group>

      {status && (
        <Group title="Notes" foot="The only folder the brain may write to (DOUBLETAKE_NOTES_DIR).">
          <Row
            icon="folder"
            label="Notes folder"
            value={<span className="mono small">{status.notesDir}</span>}
          />
        </Group>
      )}
      <Note error={msg !== 'Importing…'}>{msg}</Note>
    </SettingsPage>
  );
}
