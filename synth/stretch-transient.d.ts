// 1.2.1's declarations reference @audio/stretch-core, which is not a dependency.
// Declare the streaming API used by TimeStretch here until upstream fixes it.
declare module "@audio/stretch-core" {
  export interface StretchOpts {
    factor?: number;
    frameSize?: number;
    hopSize?: number;
    anaHop?: number;
    synHop?: number;
  }
  export type StreamWriter = (input: Float32Array) => Float32Array;
}
