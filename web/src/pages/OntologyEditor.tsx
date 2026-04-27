// Ontology editor — "printer's manuscript" layout with dual-layer toggle,
// expandable entity cards and edge cards.
//
// For a demo project we render the MOCK ontology and the Save button is
// disabled; for a real project we load GET /ontology and PUT on save.
// The design keeps field editing inline; this port preserves that.

import { useEffect, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import { useUI } from "../store";
import {
  MOCK_ONTOLOGY_DETAIL,
  MOCK_ONTOLOGY_HL,
  MockOntology,
  MockOntologyEntity,
  MockOntologyField,
  KIND_COLOR,
} from "../mockdata";
import type { Layer, OntologyResponse, OntologySpec } from "../types";

// Ontology editing only applies to the two real KG layers; the "bridge"
// layer is a runtime cross-layer view of detail+hl edges, not a separately
// configurable schema.
type OntologyLayer = Exclude<Layer, "bridge">;

// Convert backend spec shape to the mock-style used by the design components.
function toMock(spec: OntologySpec): MockOntology {
  const conv = (es: OntologySpec["entities"]): MockOntologyEntity[] =>
    es.map((e) => ({
      name: e.name,
      desc: e.description || "",
      fields: e.fields.map((f) => {
        const isLiteral = typeof f.type !== "string" && (f.type as { kind?: string })?.kind === "literal";
        const type = isLiteral
          ? "literal"
          : typeof f.type === "string"
          ? f.type
          : "str";
        const vals =
          isLiteral && typeof f.type !== "string"
            ? (f.type as { values: (string | number | boolean)[] }).values.map(String)
            : undefined;
        return {
          name: f.name,
          type,
          opt: !!f.optional,
          note: f.description || undefined,
          vals,
        } as MockOntologyField;
      }),
    }));
  return { entities: conv(spec.entities), edges: conv(spec.edges) };
}

export default function OntologyPage() {
  const project = useUI((s) => s.project);
  const [layer, setLayer] = useState<OntologyLayer>("detail");
  const [spec, setSpec] = useState<MockOntology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isDemo = DEMO_ONLY || !!project?.demo;

  useEffect(() => {
    if (!project) return;
    if (isDemo) {
      setSpec(layer === "detail" ? MOCK_ONTOLOGY_DETAIL : MOCK_ONTOLOGY_HL);
      return;
    }
    api
      .get<OntologyResponse>(`/projects/${project.id}/ontology?layer=${layer}`)
      .then((r) => setSpec(toMock(r.spec)))
      .catch((e) => {
        setError(String(e));
        setSpec(layer === "detail" ? MOCK_ONTOLOGY_DETAIL : MOCK_ONTOLOGY_HL);
      });
  }, [project, layer, isDemo]);

  const layerInfo = {
    detail: { title: "明细层", sub: "Detail Layer", note: "角色、场景、具体事件。按场次生成。" },
    hl: { title: "摘要层", sub: "High-Level Layer", note: "节拍、弧线和主题。用于跨场分析。" },
  }[layer];

  const entities = spec?.entities ?? [];
  const edges = spec?.edges ?? [];

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set(entities.map((e) => e.name)));
  }, [spec]);

  async function save() {
    if (!spec || !project || isDemo) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/projects/${project.id}/ontology?layer=${layer}`, {
        entities: spec.entities.map(mockEntityToSpec),
        edges: spec.edges.map(mockEntityToSpec),
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="swiss-page">
      <div className="swiss-shell" style={{ maxWidth: 1040 }}>
        <div className="swiss-heading">
          <div className="swiss-number">02</div>
          <div>
            <h1 className="swiss-title">数据结构</h1>
            <div className="swiss-copy">
              配置实体、字段和关系类型，控制图谱抽取结构。
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <LayerToggle layer={layer} onChange={setLayer} />
            <button
              className="btn primary"
              style={{ marginLeft: 8 }}
              onClick={save}
              disabled={isDemo || saving}
            >
              {isDemo ? "示例 · 只读" : saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>

        <div
          className="panel"
          style={{
            padding: 18,
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 16, color: "var(--ink-900)", fontWeight: 700 }}>
              {layerInfo.title}{" "}
              <span className="tiny muted">
                · {layerInfo.sub}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {layerInfo.note}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="tiny dim">
            {entities.length} 实体 · {edges.length} 关系
          </div>
        </div>

        {error && (
          <div
            className="panel"
            style={{
              padding: 12,
              marginBottom: 16,
              borderLeft: "3px solid var(--err)",
              fontSize: 12.5,
              color: "var(--cinnabar-400)",
            }}
          >
            {error}
          </div>
        )}

        <Section title="实体类型" en="02A">
          <div className="col stagger-in" style={{ gap: 10 }}>
            {entities.map((ent, i) => (
              <div key={ent.name} style={{ "--i": i } as React.CSSProperties}>
                <EntityCard
                  entity={ent}
                  expanded={expanded.has(ent.name)}
                  onToggle={() =>
                    setExpanded((s) => {
                      const n = new Set(s);
                      if (n.has(ent.name)) n.delete(ent.name);
                      else n.add(ent.name);
                      return n;
                    })
                  }
                />
              </div>
            ))}
            <div style={{ "--i": entities.length } as React.CSSProperties}>
              <AddButton label="新增实体类型" />
            </div>
          </div>
        </Section>

        <div style={{ height: 24 }} />

        <Section title="关系类型" en="02B">
          <div className="col stagger-in" style={{ gap: 10 }}>
            {edges.map((e, i) => (
              <div key={e.name} style={{ "--i": i + 2 } as React.CSSProperties}>
                <EdgeCard edge={e} />
              </div>
            ))}
            <div style={{ "--i": edges.length + 2 } as React.CSSProperties}>
              <AddButton label="新增关系类型" />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function mockEntityToSpec(e: MockOntologyEntity): OntologySpec["entities"][number] {
  return {
    name: e.name,
    description: e.desc,
    fields: e.fields.map((f) => {
      const type =
        f.type === "literal" && f.vals
          ? { kind: "literal" as const, values: f.vals }
          : f.type;
      return {
        name: f.name,
        type,
        optional: f.opt,
        description: f.note || "",
      };
    }),
  };
}

function Section({
  title,
  en,
  children,
}: {
  title: string;
  en: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="row"
        style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid var(--divider)" }}
      >
        <span className="mono" style={{ color: "#e4002b", fontWeight: 700 }}>
          {en}
        </span>
        <span className="song" style={{ fontSize: 17, color: "var(--ink-800)", marginLeft: 2 }}>
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function LayerToggle({
  layer,
  onChange,
}: {
  layer: OntologyLayer;
  onChange: (l: OntologyLayer) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--ink-100)",
        borderRadius: 0,
        padding: 2,
        border: "1px solid var(--divider)",
      }}
    >
      {[
        { v: "detail" as OntologyLayer, l: "详细层" },
        { v: "hl" as OntologyLayer, l: "节拍层" },
      ].map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="song"
          style={{
            padding: "6px 16px",
            fontSize: 13,
            borderRadius: 0,
            background: layer === o.v ? "var(--seal-500)" : "transparent",
            color: layer === o.v ? "#fff" : "var(--ink-600)",
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function EntityCard({
  entity,
  expanded,
  onToggle,
}: {
  entity: MockOntologyEntity;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colorVar = `var(${KIND_COLOR[entity.name] || "--char-500"})`;
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 18px",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 0,
            background: colorVar,
          }}
        />
        <div>
          <div
            className="mono"
            style={{
              fontSize: 13,
              color: "var(--ink-800)",
              fontWeight: 500,
              letterSpacing: 0,
            }}
          >
            {entity.name}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 1 }}>
            {entity.desc}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="chip mono">{entity.fields.length} 字段</span>
        <span
          className="muted"
          style={{
            fontSize: 12,
            transform: expanded ? "rotate(90deg)" : "",
            transition: "transform .2s",
          }}
        >
          ›
        </span>
      </div>
      {expanded && (
        <div
          style={{
            background: "var(--ink-050)",
            padding: "12px 18px 16px",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 120px 80px 1fr",
              gap: 10,
              paddingBottom: 6,
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <span className="tiny muted">字段</span>
            <span className="tiny muted">类型</span>
            <span className="tiny muted">必填</span>
            <span className="tiny muted">说明</span>
          </div>
          {entity.fields.map((f) => (
            <div
              key={f.name}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 120px 80px 1fr",
                gap: 10,
                padding: "8px 0",
                alignItems: "center",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-800)" }}>
                {f.name}
              </span>
              <span
                className="mono tiny"
                style={{
                  color: f.type === "literal" ? "var(--seal-400)" : "var(--ink-600)",
                }}
              >
                {f.type === "literal" && f.vals
                  ? `{${f.vals.slice(0, 3).join(" | ")}${f.vals.length > 3 ? " …" : ""}}`
                  : f.type}
              </span>
              <span
                className="tiny"
                style={{ color: f.opt ? "var(--ink-500)" : "var(--cinnabar-500)" }}
              >
                {f.opt ? "可选" : "必填"}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {f.note || "—"}
              </span>
            </div>
          ))}
          <button
            className="tiny"
            style={{
              color: "var(--seal-400)",
              marginTop: 10,
              letterSpacing: 0,
            }}
          >
            新增字段
          </button>
        </div>
      )}
    </div>
  );
}

function EdgeCard({ edge }: { edge: MockOntologyEntity }) {
  return (
    <div
      className="panel"
      style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--seal-400)" strokeWidth="1.6">
        <circle cx="5" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
        <path d="M7 12 H17" strokeDasharray="2 2" />
        <path d="M15 9 L17 12 L15 15" />
      </svg>
      <div>
        <div
          className="mono"
          style={{ fontSize: 13, color: "var(--ink-800)", letterSpacing: 0 }}
        >
          {edge.name}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 1 }}>
          {edge.desc}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <span className="chip mono">{edge.fields.length} 字段</span>
    </div>
  );
}

function AddButton({ label }: { label: string }) {
  return (
    <button
      style={{
        padding: "10px 16px",
        border: "1px dashed var(--divider-strong)",
        borderRadius: 0,
        color: "var(--ink-500)",
        background: "transparent",
        textAlign: "left",
        transition: "color .15s, border-color .15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--seal-400)";
        e.currentTarget.style.borderColor = "var(--seal-500)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "";
        e.currentTarget.style.borderColor = "";
      }}
    >
      {label}
    </button>
  );
}
