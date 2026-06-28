// Shared types used across the extension.

/** A position inside a compiled bundle chunk (Turbopack/webpack), before source maps. */
export interface CompiledFrame {
  kind?: 'server' | 'client';
  ref: string;
  line: number;
  column?: number;
  name?: string | null;
}

/** React / source-map strategy: a list of candidate frames to try in order. */
export interface FramesCandidate {
  kind: 'frames';
  frames: CompiledFrame[];
}

/** A source file we already know the path of (data-attributes, Vue __file). */
export interface FileCandidate {
  kind: 'file';
  file: string;
  line?: number;
  column?: number;
}

/** A DOM fingerprint used to locate the element in plain HTML or server templates. */
export interface SignatureCandidate {
  kind: 'signature';
  tag?: string;
  id?: string | null;
  classes?: string[];
  attrs?: Record<string, string>;
  openTag?: string;
  text?: string;
}

export type Candidate = FramesCandidate | FileCandidate | SignatureCandidate;

/** The message the client script sends when you click an element. */
export interface InspectPayload {
  meta?: { tag?: string; label?: string };
  candidates?: Candidate[];
}

/** A resolved location in the user's source code. */
export interface Target {
  file: string;
  line: number;
  column: number;
}
