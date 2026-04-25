// 认知边界 · Cognitive Boundary — flagship "who knew what when" view.
//
// For demo projects we render the full MOCK knowledge matrix directly
// (frozen timeline, six characters × three facts). For real projects we
// lazy-load via POST /query mode=cognitive — one call per character for
// the currently selected beat. Facts are derived from the union of all
// knows_facts strings returned so far; clicking through the timeline
// triggers fresh queries as needed and the results are cached per
// (character, beat) pair so moving back doesn't re-spend.
//
// Tradeoffs: partial wiring — we can't tell you "since_beat" with
// precision for real data because query_cognitive is cutoff-based, not
// revelation-based. The matrix shows whether a fact is known *as of* the
// selected beat, which is the actionable question most writers have.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEMO_ONLY } from "../env";
import { useUI } from "../store";
import {
  MOCK_BEATS,
  MOCK_CHARACTERS,
  MOCK_FACTS,
  MOCK_KNOWLEDGE,
  MockCharacter,
  ROLE_ZH,
  findBeat,
  findCharacter,
  findFact,
} from "../mockdata";

interface RealCharacter {
  uuid: string;
  name: string;
}

interface RealBeat {
  uuid: string;
  label: string;
  type: string;
  tension: number;
  episode: number;
}

// Server-computed shape from GET /projects/{pid}/boundary
interface BoundarySnapshot {
  characters: RealCharacter[];
  beats: (RealBeat & { scene_end_ep: number; scene_end_sc: number })[];
  facts: string[];
  knowledge: Record<string, Record<string, string[]>>; // [charUuid][beatUuid] = facts[]
  latest: Record<string, { fact: string; beat_uuid: string } | null>;
}

const MOCK_ORDER = Object.fromEntries(MOCK_BEATS.map((b, i) => [b.id, i]));

function mockKnows(charId: string, factId: string, beatIdx: number): boolean {
  const since = MOCK_KNOWLEDGE[charId]?.[factId];
  if (!since) return false;
  return MOCK_ORDER[since] <= beatIdx;
}

export default function BoundaryPage() {
  const project = useUI((s) => s.project);
  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-500)" }}>先选择或新建项目。</div>;
  }
  return DEMO_ONLY || project.demo ? <BoundaryMock /> : <BoundaryLive projectId={project.id} />;
}

// ---------------- MOCK ----------------

function BoundaryMock() {
  const [beatIdx, setBeatIdx] = useState(MOCK_BEATS.length - 1);
  const [selChar, setSelChar] = useState("c-lijing");
  const [selFact, setSelFact] = useState("fact-adoption");
  const currentBeat = MOCK_BEATS[beatIdx];

  return (
    <Shell
      currentLabel={currentBeat.label}
      currentMeta={`E${currentBeat.ep} · ${currentBeat.type}`}
      timeline={
        <BeatTimeline
          beats={MOCK_BEATS.map((b) => ({
            id: b.id,
            label: b.label,
            ep: b.ep,
            tension: b.tension,
          }))}
          current={beatIdx}
          onChange={setBeatIdx}
        />
      }
      matrixHeader={
        <>
          <span className="song" style={{ fontSize: 15, color: "var(--ink-800)" }}>
            认知矩阵
          </span>
          <span className="kicker" style={{ marginLeft: 8, fontSize: 11 }}>
            角色 / 事实
          </span>
          <div style={{ flex: 1 }} />
          <span className="tiny muted">截至「{currentBeat.label}」</span>
        </>
      }
      matrix={
        <MockMatrix
          beatIdx={beatIdx}
          onSelectChar={setSelChar}
          onSelectCell={(c, f) => {
            setSelChar(c);
            setSelFact(f);
          }}
          selChar={selChar}
        />
      }
      detail={
        <>
          <MockCharacterReveal charId={selChar} beatIdx={beatIdx} />
          <MockFactTrace factId={selFact} beatIdx={beatIdx} />
        </>
      }
    />
  );
}

function Shell({
  currentLabel,
  currentMeta,
  timeline,
  matrixHeader,
  matrix,
  detail,
}: {
  currentLabel: string;
  currentMeta: string;
  timeline: React.ReactNode;
  matrixHeader: React.ReactNode;
  matrix: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="swiss-page">
      <div className="stagger-in swiss-shell">
        <div
          className="swiss-heading"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <div className="swiss-number">05</div>
          <div>
            <h1 className="swiss-title">知识边界</h1>
            <div className="swiss-copy">
              按时间点查看角色已知事实，辅助检查信息披露是否一致。
            </div>
          </div>
          <span className="chip hot">分析视图</span>
        </div>

        <div
          className="panel"
          style={{
            padding: "18px 22px",
            marginTop: 22,
            marginBottom: 24,
            "--i": 1,
          } as React.CSSProperties}
        >
          <div className="row" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 15, color: "var(--ink-900)", fontWeight: 700 }}>
              当前节点
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ color: "var(--ink-900)", fontSize: 16, fontWeight: 700 }}>
              {currentLabel}
            </span>
            <span className="tiny muted mono" style={{ marginLeft: 8 }}>
              {currentMeta}
            </span>
          </div>
          {timeline}
        </div>

        <div
          className="panel"
          style={{
            padding: 0,
            overflow: "hidden",
            marginBottom: 24,
            "--i": 2,
          } as React.CSSProperties}
        >
          <div
            className="row"
            style={{
              padding: "14px 22px",
              borderBottom: "1px solid var(--divider)",
            }}
          >
            {matrixHeader}
          </div>
          <div style={{ overflowX: "auto" }}>{matrix}</div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            "--i": 3,
          } as React.CSSProperties}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function MockMatrix({
  beatIdx,
  selChar,
  onSelectChar,
  onSelectCell,
}: {
  beatIdx: number;
  selChar: string;
  onSelectChar: (c: string) => void;
  onSelectCell: (c: string, f: string) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr>
          <th style={TH} />
          {MOCK_FACTS.map((f) => (
            <th key={f.id} style={TH}>
              <div
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "upright",
                  fontFamily: "var(--font-song)",
                  fontSize: 13,
                  color: "var(--ink-700)",
                  letterSpacing: 0,
                  padding: "12px 0 10px",
                  margin: "0 auto",
                }}
              >
                {f.text}
              </div>
              <div
                className="tiny muted mono"
                style={{ textAlign: "center", paddingBottom: 10 }}
              >
                揭于 · {findBeat(f.revealBeat)?.label ?? "—"}
              </div>
            </th>
          ))}
          <th style={{ ...TH, width: "28%" }}>
            <div
              className="tiny muted"
              style={{ letterSpacing: 0, textAlign: "left", paddingLeft: 16 }}
            >
              最近得知
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        {MOCK_CHARACTERS.map((c) => (
          <tr
            key={c.id}
            onClick={() => onSelectChar(c.id)}
            style={{
              background: selChar === c.id ? "var(--ink-150)" : "transparent",
              borderTop: "1px solid var(--hairline)",
              cursor: "pointer",
            }}
          >
            <td style={{ padding: "14px 22px", borderRight: "1px solid var(--hairline)", width: 200 }}>
              <div
                className="song"
                style={{ fontSize: 15, color: "var(--ink-900)" }}
              >
                {c.name}
              </div>
              <div className="tiny muted">{ROLE_ZH[c.role] || c.role}</div>
            </td>
            {MOCK_FACTS.map((f) => {
              const k = mockKnows(c.id, f.id, beatIdx);
              const since = MOCK_KNOWLEDGE[c.id]?.[f.id];
              const sinceBeat = since ? findBeat(since) : null;
              const willKnow = !!since && MOCK_ORDER[since] > beatIdx;
              return (
                <td
                  key={f.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCell(c.id, f.id);
                  }}
                  style={{
                    padding: "12px 8px",
                    textAlign: "center",
                    borderRight: "1px solid var(--hairline)",
                  }}
                >
                  <KnowMark
                    known={k}
                    willKnow={willKnow}
                    label={
                      k && sinceBeat
                        ? sinceBeat.label
                        : willKnow && sinceBeat
                        ? `将于 ${sinceBeat.label}`
                        : "—"
                    }
                  />
                </td>
              );
            })}
            <td style={{ padding: "12px 16px" }}>
              <MockLatestRevealBadge charId={c.id} beatIdx={beatIdx} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TH: React.CSSProperties = {
  background: "var(--ink-100)",
  textAlign: "center",
  verticalAlign: "bottom",
  padding: 0,
  borderRight: "1px solid var(--hairline)",
  borderBottom: "1px solid var(--divider)",
};

function KnowMark({
  known,
  willKnow,
  label,
}: {
  known: boolean;
  willKnow: boolean;
  label: string;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
      title={label}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: known ? "var(--seal-500)" : "transparent",
          border:
            "1.5px solid " +
            (known ? "var(--seal-500)" : willKnow ? "var(--ink-400)" : "var(--ink-300)"),
          borderStyle: willKnow && !known ? "dashed" : "solid",
          boxShadow: "none",
        }}
      />
      <span
        className="tiny"
        style={{
          fontSize: 10,
          color: known ? "var(--ink-700)" : "var(--ink-500)",
        }}
      >
        {label.length > 8 ? label.slice(0, 6) + "…" : label}
      </span>
    </div>
  );
}

function BeatTimeline({
  beats,
  current,
  onChange,
}: {
  beats: { id: string; label: string; ep: number; tension: number }[];
  current: number;
  onChange: (i: number) => void;
}) {
  const pct = beats.length > 1 ? (current / (beats.length - 1)) * 100 : 100;
  return (
    <div style={{ position: "relative", padding: "10px 4px 18px" }}>
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 24,
          height: 2,
          background: "var(--divider-strong)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 10,
          top: 24,
          height: 2,
          width: `calc(${pct}% - 10px)`,
          background: "#e4002b",
          transition: "width .25s ease",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
        {beats.map((b, i) => {
          const on = i <= current;
          const cur = i === current;
          const tensionH = b.tension * 2.5;
          return (
            <button
              key={b.id}
              onClick={() => onChange(i)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: 0,
                minWidth: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "flex-end",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 3,
                    height: tensionH,
                    background: on ? "var(--seal-500)" : "var(--ink-400)",
                    opacity: on ? 1 : 0.3,
                    borderRadius: 2,
                  }}
                />
              </div>
              <div
                style={{
                  width: cur ? 14 : 10,
                  height: cur ? 14 : 10,
                  borderRadius: "50%",
                  background: on ? "var(--seal-500)" : "var(--ink-200)",
                  border: cur ? "2px solid var(--ink-900)" : "1px solid var(--divider-strong)",
                  boxShadow: "none",
                  transition: "all .2s",
                }}
              />
              <div
                className="song tiny"
                style={{
                  marginTop: 6,
                  color: on ? "var(--ink-700)" : "var(--ink-500)",
                  fontSize: 11,
                  letterSpacing: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {b.label}
              </div>
              <div
                className="mono"
                style={{ fontSize: 9, color: "var(--ink-500)", marginTop: 1 }}
              >
                E{b.ep}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MockLatestRevealBadge({ charId, beatIdx }: { charId: string; beatIdx: number }) {
  const known = MOCK_FACTS.filter((f) => {
    const s = MOCK_KNOWLEDGE[charId]?.[f.id];
    return s && MOCK_ORDER[s] <= beatIdx;
  })
    .map((f) => ({ f, b: MOCK_KNOWLEDGE[charId][f.id] as string }))
    .sort((a, b) => MOCK_ORDER[b.b] - MOCK_ORDER[a.b]);
  if (!known.length) return <span className="tiny muted">尚无</span>;
  const latest = known[0];
  const beat = findBeat(latest.b);
  return (
    <div>
      <div className="song" style={{ fontSize: 13, color: "var(--ink-800)" }}>
        {latest.f.text}
      </div>
      <div className="tiny muted mono" style={{ marginTop: 2 }}>
        于 {beat?.label}
      </div>
    </div>
  );
}

function MockCharacterReveal({ charId, beatIdx }: { charId: string; beatIdx: number }) {
  const c = findCharacter(charId);
  if (!c) return null;
  return (
    <div className="panel" style={{ padding: 18 }}>
      <CharacterHeader character={c} />
      <div
        className="song"
        style={{
          color: "var(--ink-700)",
          fontSize: 13.5,
          lineHeight: 1.8,
          marginBottom: 14,
          paddingLeft: 10,
          borderLeft: "2px solid var(--seal-500)",
        }}
      >
        {c.note}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {MOCK_FACTS.map((f) => {
          const since = MOCK_KNOWLEDGE[charId]?.[f.id];
          const sinceIdx = since ? MOCK_ORDER[since] : -1;
          const k = sinceIdx >= 0 && sinceIdx <= beatIdx;
          const beat = since ? findBeat(since) : null;
          return (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: k ? "var(--ink-100)" : "var(--ink-050)",
                border: "1px solid " + (k ? "#e4002b" : "var(--hairline)"),
                borderRadius: 0,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: k ? "var(--seal-500)" : "transparent",
                  border: "1.5px solid " + (k ? "var(--seal-500)" : "var(--ink-400)"),
                }}
              />
              <span
                className="song"
                style={{ fontSize: 13, color: "var(--ink-800)", flex: 1 }}
              >
                {f.text}
              </span>
              {k && beat ? (
                <span className="tiny mono" style={{ color: "var(--seal-400)" }}>
                  于 {beat.label}
                </span>
              ) : sinceIdx >= 0 && beat ? (
                <span className="tiny muted mono">将于 {beat.label}</span>
              ) : (
                <span className="tiny dim">不会知晓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MockFactTrace({ factId, beatIdx }: { factId: string; beatIdx: number }) {
  const fact = findFact(factId);
  if (!fact) return null;
  const knowers = MOCK_CHARACTERS
    .map((c) => ({ c, since: MOCK_KNOWLEDGE[c.id]?.[factId] }))
    .filter((x): x is { c: MockCharacter; since: string } => !!x.since)
    .sort((a, b) => MOCK_ORDER[a.since] - MOCK_ORDER[b.since]);
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 0,
            background: "var(--seal-500)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-song)",
            fontSize: 13,
          }}
        >
          事实
        </div>
        <div>
          <div className="song" style={{ fontSize: 17, color: "var(--ink-900)" }}>
            {fact.text}
          </div>
          <div className="tiny muted">事实传播链</div>
        </div>
      </div>
      <div className="col" style={{ gap: 0 }}>
        {knowers.map(({ c, since }, i) => {
          const k = MOCK_ORDER[since] <= beatIdx;
          const beat = findBeat(since);
          return (
            <div
              key={c.id}
              style={{
                display: "grid",
                gridTemplateColumns: "30px 1fr auto",
                gap: 10,
                padding: "10px 0",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: k ? "var(--seal-500)" : "transparent",
                    border: "1.5px solid " + (k ? "var(--seal-500)" : "var(--ink-400)"),
                  }}
                />
                {i < knowers.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      width: 1,
                      background: "var(--divider-strong)",
                      marginTop: 2,
                    }}
                  />
                )}
              </div>
              <div>
                <div
                  className="song"
                  style={{
                    fontSize: 14,
                    color: k ? "var(--ink-900)" : "var(--ink-500)",
                  }}
                >
                  {c.name}
                </div>
                <div className="tiny muted">{ROLE_ZH[c.role]}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  className="song tiny"
                  style={{ color: k ? "var(--ink-700)" : "var(--ink-500)" }}
                >
                  {beat?.label}
                </div>
                <div className="mono tiny muted">E{beat?.ep}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CharacterHeader({ character }: { character: MockCharacter | RealCharacter }) {
  const role = (character as MockCharacter).role;
  return (
    <div className="row" style={{ marginBottom: 10 }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 0,
          background: "var(--char-500)",
          color: "var(--ink-050)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-song)",
          fontSize: 18,
        }}
      >
        {character.name.charAt(0)}
      </div>
      <div>
        <div className="song" style={{ fontSize: 17, color: "var(--ink-900)" }}>
          {character.name}
        </div>
        <div className="tiny muted">{role ? ROLE_ZH[role] || role : ""}</div>
      </div>
      <div style={{ flex: 1 }} />
      <span className="chip">视角</span>
    </div>
  );
}

// ---------------- LIVE (real backend) ----------------

function BoundaryLive({ projectId }: { projectId: string }) {
  const [snap, setSnap] = useState<BoundarySnapshot | null>(null);
  const [beatIdx, setBeatIdx] = useState(0);
  const [selChar, setSelChar] = useState<string | null>(null);
  const [selFact, setSelFact] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<BoundarySnapshot>(`/projects/${projectId}/boundary`)
      .then((s) => {
        if (cancelled) return;
        setSnap(s);
        setBeatIdx(Math.max(0, s.beats.length - 1));
        setSelChar(s.characters[0]?.uuid ?? null);
        setSelFact(s.facts[0] ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const characters: RealCharacter[] = snap?.characters ?? [];
  const beats = snap?.beats ?? [];
  const currentBeat = beats[beatIdx];

  // A fact is "known at beatIdx" if it appears in knowledge[char][beat] for
  // any beat up to and including the current one.
  const { factUnion, matrix } = useMemo(() => {
    if (!snap || !currentBeat) {
      return {
        factUnion: [] as string[],
        matrix: {} as Record<string, Record<string, boolean>>,
      };
    }
    const visibleBeatIds = new Set(beats.slice(0, beatIdx + 1).map((b) => b.uuid));
    const facts = new Set<string>();
    const m: Record<string, Record<string, boolean>> = {};
    for (const c of characters) {
      m[c.uuid] = {};
      for (const bid of visibleBeatIds) {
        const rowFacts = snap.knowledge[c.uuid]?.[bid] ?? [];
        for (const f of rowFacts) {
          facts.add(f);
          m[c.uuid][f] = true;
        }
      }
    }
    return { factUnion: snap.facts.filter((f) => facts.has(f)), matrix: m };
  }, [snap, beats, beatIdx, characters, currentBeat]);

  if (loading) return <CenteredNote>正在加载图谱…</CenteredNote>;
  if (error) {
    const missingChars = error.includes("Character");
    const missingBeats = error.includes("Beat");
    return (
      <CenteredNote>
        {missingChars
          ? "尚无角色节点。先在「导入」页运行一次 ingest 让详细层落地数据。"
          : missingBeats
          ? "节拍层为空。在「导入」页勾选「同步生成节拍层」后重跑一次。"
          : `加载失败：${error}`}
      </CenteredNote>
    );
  }
  if (!snap || beats.length === 0 || characters.length === 0) {
    return (
      <CenteredNote>
        尚无节拍或角色数据。先在「导入」页运行一次 ingest 让两层都有内容。
      </CenteredNote>
    );
  }

  return (
    <Shell
      currentLabel={currentBeat.label}
      currentMeta={`E${currentBeat.episode} · ${currentBeat.type || ""}`}
      timeline={
        <BeatTimeline
          beats={beats.map((b) => ({
            id: b.uuid,
            label: b.label,
            ep: b.episode,
            tension: b.tension,
          }))}
          current={beatIdx}
          onChange={setBeatIdx}
        />
      }
      matrixHeader={
        <>
          <span className="song" style={{ fontSize: 15, color: "var(--ink-800)" }}>
            认知矩阵
          </span>
          <span className="kicker" style={{ marginLeft: 8, fontSize: 11 }}>
            角色 / 事实
          </span>
          <div style={{ flex: 1 }} />
          <span className="tiny muted" style={{ marginLeft: 8 }}>
            截至「{currentBeat.label}」
          </span>
        </>
      }
      matrix={
        factUnion.length === 0 ? (
          <div style={{ padding: 20, color: "var(--ink-500)" }}>
            当前节拍前没有发现认知事实。后端的 query_cognitive
            只在 ingest 产生了 witness_scope 时才返回内容。
          </div>
        ) : (
          <LiveMatrix
            characters={characters}
            beats={beats}
            beatIdx={beatIdx}
            facts={factUnion}
            matrix={matrix}
            latest={snap.latest}
            selChar={selChar}
            onSelectChar={setSelChar}
            onSelectCell={(c, f) => {
              setSelChar(c);
              setSelFact(f);
            }}
          />
        )
      }
      detail={
        <>
          {selChar && (
            <LiveCharacterReveal
              character={characters.find((c) => c.uuid === selChar)!}
              beatLabel={currentBeat.label}
              facts={matrix[selChar] ? Object.keys(matrix[selChar]).filter((f) => matrix[selChar][f]) : []}
            />
          )}
          {selFact && (
            <LiveFactTrace
              fact={selFact}
              knowers={characters
                .filter((c) => matrix[c.uuid]?.[selFact])
                .map((c) => c.name)}
            />
          )}
        </>
      }
    />
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-500)",
        padding: 40,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 480 }}>{children}</div>
    </div>
  );
}

function LiveMatrix({
  characters,
  beats,
  beatIdx,
  facts,
  matrix,
  latest,
  selChar,
  onSelectChar,
  onSelectCell,
}: {
  characters: RealCharacter[];
  beats: (RealBeat & { scene_end_ep: number; scene_end_sc: number })[];
  beatIdx: number;
  facts: string[];
  matrix: Record<string, Record<string, boolean>>;
  latest: Record<string, { fact: string; beat_uuid: string } | null>;
  selChar: string | null;
  onSelectChar: (c: string) => void;
  onSelectCell: (c: string, f: string) => void;
}) {
  const currentBeat = beats[beatIdx];
  const visibleBeatIds = new Set(beats.slice(0, beatIdx + 1).map((b) => b.uuid));

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr>
          <th style={TH} />
          {facts.map((f) => (
            <th key={f} style={TH}>
              <div
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "upright",
                  fontFamily: "var(--font-song)",
                  fontSize: 12,
                  color: "var(--ink-700)",
                  letterSpacing: 0,
                  padding: "12px 0 10px",
                  maxHeight: 160,
                  overflow: "hidden",
                  margin: "0 auto",
                }}
                title={f}
              >
                {f.length > 18 ? f.slice(0, 16) + "…" : f}
              </div>
            </th>
          ))}
          <th style={{ ...TH, width: "28%" }}>
            <div
              className="tiny muted"
              style={{ letterSpacing: 0, textAlign: "left", paddingLeft: 16 }}
            >
              最近得知
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        {characters.map((c) => {
          const l = latest[c.uuid];
          const latestBeat =
            l && visibleBeatIds.has(l.beat_uuid)
              ? beats.find((b) => b.uuid === l.beat_uuid)
              : null;
          return (
            <tr
              key={c.uuid}
              onClick={() => onSelectChar(c.uuid)}
              style={{
                background: selChar === c.uuid ? "var(--ink-150)" : "transparent",
                borderTop: "1px solid var(--hairline)",
                cursor: "pointer",
              }}
            >
              <td
                style={{
                  padding: "14px 22px",
                  borderRight: "1px solid var(--hairline)",
                  width: 200,
                }}
              >
                <div
                  className="song"
                  style={{ fontSize: 15, color: "var(--ink-900)" }}
                >
                  {c.name}
                </div>
              </td>
              {facts.map((f) => {
                const known = !!matrix[c.uuid]?.[f];
                return (
                  <td
                    key={f}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCell(c.uuid, f);
                    }}
                    style={{
                      padding: "12px 8px",
                      textAlign: "center",
                      borderRight: "1px solid var(--hairline)",
                    }}
                  >
                    <KnowMark
                      known={known}
                      willKnow={false}
                      label={known ? currentBeat.label : "—"}
                    />
                  </td>
                );
              })}
              <td style={{ padding: "12px 16px" }}>
                {latestBeat && l ? (
                  <>
                    <div
                      className="song"
                      style={{
                        fontSize: 13,
                        color: "var(--ink-800)",
                        wordBreak: "break-all",
                      }}
                    >
                      {l.fact.length > 24 ? l.fact.slice(0, 22) + "…" : l.fact}
                    </div>
                    <div className="tiny muted mono" style={{ marginTop: 2 }}>
                      于 {latestBeat.label}
                    </div>
                  </>
                ) : (
                  <span className="tiny muted">尚无</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LiveCharacterReveal({
  character,
  beatLabel,
  facts,
}: {
  character: RealCharacter;
  beatLabel: string;
  facts: string[];
}) {
  return (
    <div className="panel" style={{ padding: 18 }}>
      <CharacterHeader character={character} />
      <div className="tiny muted" style={{ marginBottom: 8 }}>
        截至「{beatLabel}」
      </div>
      <div className="col" style={{ gap: 8 }}>
        {facts.length === 0 ? (
          <div className="tiny dim">尚无已知事实。</div>
        ) : (
          facts.map((f) => (
            <div
              key={f}
              style={{
                padding: "8px 12px",
                background: "var(--ink-100)",
                border: "1px solid #e4002b",
                borderRadius: 0,
                fontSize: 13,
                color: "var(--ink-800)",
                fontFamily: "var(--font-song)",
                lineHeight: 1.6,
              }}
            >
              {f}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LiveFactTrace({ fact, knowers }: { fact: string; knowers: string[] }) {
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 0,
            background: "var(--seal-500)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-song)",
            fontSize: 13,
          }}
        >
          事实
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            className="song"
            style={{
              fontSize: 15,
              color: "var(--ink-900)",
              wordBreak: "break-all",
            }}
          >
            {fact}
          </div>
          <div className="tiny muted">截至当前节拍，知情人物</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {knowers.length === 0 ? (
          <span className="tiny dim">尚无人知晓</span>
        ) : (
          knowers.map((n) => (
            <span key={n} className="chip song" style={{ fontSize: 12 }}>
              {n}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
