// Mirrors api/models.py. Kept deliberately permissive on the properties
// bags so a backend change doesn't silently break the frontend build.

export interface ProjectInfo {
  project_id: string;
  created_at: string | null;
}

export type Layer = "detail" | "hl" | "bridge";

export interface OntologyFieldSpec {
  name: string;
  type: string | { kind: "literal"; values: (string | number | boolean)[] };
  optional?: boolean;
  default?: unknown;
  description?: string;
}

export interface OntologyEntitySpec {
  name: string;
  description?: string;
  fields: OntologyFieldSpec[];
}

export interface OntologySpec {
  entities: OntologyEntitySpec[];
  edges: OntologyEntitySpec[];
}

export interface OntologyResponse {
  source: "saved" | "default";
  layer: Layer;
  spec: OntologySpec;
}

export interface NodeDTO {
  uuid: string;
  name: string | null;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface EdgeDTO {
  uuid: string | null;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphDTO {
  nodes: NodeDTO[];
  edges: EdgeDTO[];
}
