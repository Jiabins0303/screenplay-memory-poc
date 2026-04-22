import { useEffect, useState } from "react";
import { api } from "../api";
import type { Layer, OntologyEntitySpec, OntologyFieldSpec, OntologyResponse, OntologySpec } from "../types";
import { useUI } from "../store";

const ALLOWED_TYPES = ["str", "int", "float", "bool", "list[str]", "list[int]"];

export default function OntologyPage() {
  const pid = useUI((s) => s.projectId);
  const [layer, setLayer] = useState<Layer>("detail");
  const [spec, setSpec] = useState<OntologySpec | null>(null);
  const [source, setSource] = useState<"default" | "saved">("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    setError(null);
    api
      .get<OntologyResponse>(`/projects/${pid}/ontology?layer=${layer}`)
      .then((r) => {
        setSpec(r.spec);
        setSource(r.source);
      })
      .catch((e) => setError(String(e)));
  }, [pid, layer]);

  if (!pid) return <div className="p-8">先在「项目」页选一个项目。</div>;
  if (!spec) return <div className="p-8 text-slate-500">加载中…</div>;

  async function save() {
    if (!pid || !spec) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/projects/${pid}/ontology?layer=${layer}`, spec);
      alert("已保存");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const patchEntity = (idx: number, next: OntologyEntitySpec) => {
    if (!spec) return;
    const copy = { ...spec, entities: [...spec.entities] };
    copy.entities[idx] = next;
    setSpec(copy);
  };

  const addEntity = () => {
    if (!spec) return;
    setSpec({
      ...spec,
      entities: [
        ...spec.entities,
        { name: `Entity${spec.entities.length + 1}`, description: "", fields: [] },
      ],
    });
  };

  const removeEntity = (idx: number) => {
    if (!spec) return;
    setSpec({ ...spec, entities: spec.entities.filter((_, i) => i !== idx) });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto h-full overflow-auto">
      <div className="flex items-center gap-4 mb-5">
        <h1 className="text-xl font-semibold">本体定义</h1>
        <div className="text-xs text-slate-500">
          {source === "saved" ? "已自定义" : "使用默认"}
        </div>
        <div className="ml-auto flex gap-2 text-sm">
          <LayerToggle layer={layer} onChange={setLayer} />
          <button
            className="bg-sky-600 hover:bg-sky-500 px-3 py-1 rounded"
            disabled={saving}
            onClick={save}
          >
            保存
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-xs mb-3 whitespace-pre-wrap">{error}</div>
      )}
      <div className="text-xs text-slate-500 mb-4">
        保存前请确保该层还没有节点；有节点时后端会拒绝修改，需先清空项目。
      </div>

      <section>
        <SectionHeader title="实体类型" onAdd={addEntity} />
        {spec.entities.map((ent, i) => (
          <EntityCard
            key={i}
            entry={ent}
            onChange={(e) => patchEntity(i, e)}
            onRemove={() => removeEntity(i)}
          />
        ))}
      </section>

      <section className="mt-6">
        <SectionHeader
          title="边类型"
          onAdd={() =>
            setSpec({
              ...spec,
              edges: [
                ...spec.edges,
                { name: `Edge${spec.edges.length + 1}`, description: "", fields: [] },
              ],
            })
          }
        />
        {spec.edges.map((ent, i) => (
          <EntityCard
            key={i}
            entry={ent}
            onChange={(next) => {
              const copy = { ...spec, edges: [...spec.edges] };
              copy.edges[i] = next;
              setSpec(copy);
            }}
            onRemove={() =>
              setSpec({
                ...spec,
                edges: spec.edges.filter((_, k) => k !== i),
              })
            }
          />
        ))}
      </section>
    </div>
  );
}

function LayerToggle({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (l: Layer) => void;
}) {
  return (
    <div className="bg-slate-900 rounded p-0.5 flex text-xs">
      {(["detail", "hl"] as Layer[]).map((l) => (
        <button
          key={l}
          className={`px-3 py-1 rounded ${
            layer === l ? "bg-sky-600 text-white" : "text-slate-300"
          }`}
          onClick={() => onChange(l)}
        >
          {l === "detail" ? "详细层" : "节拍层"}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="flex items-center mb-2">
      <h2 className="font-medium">{title}</h2>
      <button
        className="ml-auto text-xs text-sky-400 hover:underline"
        onClick={onAdd}
      >
        + 新增
      </button>
    </div>
  );
}

function EntityCard({
  entry,
  onChange,
  onRemove,
}: {
  entry: OntologyEntitySpec;
  onChange: (next: OntologyEntitySpec) => void;
  onRemove: () => void;
}) {
  const addField = () =>
    onChange({
      ...entry,
      fields: [
        ...entry.fields,
        { name: `field${entry.fields.length + 1}`, type: "str", optional: true, description: "" },
      ],
    });
  return (
    <div className="border border-slate-800 rounded p-3 mb-3 bg-slate-900/40">
      <div className="flex items-center gap-2 mb-2">
        <input
          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm font-mono"
          value={entry.name}
          onChange={(e) => onChange({ ...entry, name: e.target.value })}
        />
        <input
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm"
          value={entry.description || ""}
          placeholder="类型说明（会成为 LLM prompt 的一部分）"
          onChange={(e) => onChange({ ...entry, description: e.target.value })}
        />
        <button
          className="text-red-400 text-xs hover:underline"
          onClick={onRemove}
        >
          删除
        </button>
      </div>

      <div className="ml-2 space-y-1">
        {entry.fields.map((f, i) => (
          <FieldRow
            key={i}
            field={f}
            onChange={(next) => {
              const fields = [...entry.fields];
              fields[i] = next;
              onChange({ ...entry, fields });
            }}
            onRemove={() =>
              onChange({ ...entry, fields: entry.fields.filter((_, k) => k !== i) })
            }
          />
        ))}
        <button
          className="text-xs text-sky-400 hover:underline"
          onClick={addField}
        >
          + 新增字段
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: OntologyFieldSpec;
  onChange: (next: OntologyFieldSpec) => void;
  onRemove: () => void;
}) {
  const typeString =
    typeof field.type === "string" ? field.type : "literal";
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        className="w-32 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 font-mono"
        value={field.name}
        onChange={(e) => onChange({ ...field, name: e.target.value })}
      />
      <select
        className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5"
        value={typeString}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "literal") {
            onChange({
              ...field,
              type: { kind: "literal", values: ["A", "B"] },
            });
          } else {
            onChange({ ...field, type: v });
          }
        }}
      >
        {ALLOWED_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="literal">literal…</option>
      </select>
      {typeof field.type !== "string" && (
        <input
          className="w-40 bg-slate-950 border border-slate-700 rounded px-2 py-0.5"
          value={field.type.values.join(",")}
          placeholder="逗号分隔的枚举值"
          onChange={(e) =>
            onChange({
              ...field,
              type: {
                kind: "literal",
                values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
              },
            })
          }
        />
      )}
      <label className="text-xs text-slate-400 flex items-center gap-1">
        <input
          type="checkbox"
          checked={field.optional ?? false}
          onChange={(e) => onChange({ ...field, optional: e.target.checked })}
        />
        可选
      </label>
      <input
        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-0.5"
        value={field.description || ""}
        placeholder="字段描述"
        onChange={(e) => onChange({ ...field, description: e.target.value })}
      />
      <button
        className="text-red-400 text-xs hover:underline"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
