import '@tensorflow/tfjs-backend-webgpu';
import '@tensorflow/tfjs-backend-webgl';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import simdWasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import threadedSimdWasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';

setWasmPaths({
  'tfjs-backend-wasm.wasm': wasmUrl,
  'tfjs-backend-wasm-simd.wasm': simdWasmUrl,
  'tfjs-backend-wasm-threaded-simd.wasm': threadedSimdWasmUrl,
});

export const BROWSER_BACKENDS = typeof navigator !== 'undefined' && navigator.gpu
  ? ['webgpu', 'webgl', 'wasm']
  : ['webgl', 'wasm'];
