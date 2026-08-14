// Converts a .glb buffer to a real .usdz buffer, server-side, for Apple
// Quick Look AR on iPhone.
//
// Uses Three.js's actual GLTFLoader + USDZExporter (the real tooling this
// entire ecosystem is built on) rather than any hand-rolled USD authoring.
// Three.js's loaders/exporters assume a browser environment, so this module
// sets up the minimum possible shim to satisfy them in Node:
//   - global.document / document.createElement('canvas') → node-canvas,
//     which can actually decode and re-encode image bytes. jsdom's fake
//     <img> element never decodes real pixel data (a known limitation),
//     which silently hangs GLTFLoader's texture-loading promise chain
//     forever with no error — that was the very first failure mode found
//     while building this.
//   - global.HTMLImageElement / HTMLCanvasElement point at node-canvas's
//     real classes (not jsdom's), because USDZExporter type-checks images
//     with `instanceof HTMLImageElement` before drawing them to a canvas.
//   - Canvas.prototype.toBlob is polyfilled onto node-canvas's toBuffer(),
//     since node-canvas only ships the Node-style API.
//
// Missing vertex normals (common in raw photogrammetry/Polycam exports) are
// computed before export — otherwise USDZExporter fills all-zero normals,
// which renders as broken/flat shading in Quick Look.

import { createCanvas, loadImage, Image as NodeCanvasImage, Canvas as NodeCanvasCanvas } from 'canvas';

let shimInstalled = false;
function installShim() {
  if (shimInstalled) return;
  shimInstalled = true;

  global.self = globalThis;
  global.document = {
    createElement(tag) {
      if (tag === 'canvas') return createCanvas(256, 256);
      throw new Error(`document.createElement('${tag}') not supported in this minimal shim`);
    },
    createElementNS(_ns, tag) {
      return this.createElement(tag);
    }
  };
  global.HTMLCanvasElement = NodeCanvasCanvas;
  global.HTMLImageElement = NodeCanvasImage;
  NodeCanvasCanvas.prototype.toBlob = function (callback, mimeType) {
    const type = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    callback(new Blob([this.toBuffer(type)], { type }));
  };
}

export async function glbToUsdz(glbBuffer) {
  installShim();

  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');

  // Installed once per process, but Three.js's loader is a singleton-style
  // API — safe to reassign each call, it's idempotent.
  THREE.ImageLoader.prototype.load = function (url, onLoad, _onProgress, onError) {
    (async () => {
      try {
        let buffer;
        if (url.startsWith('blob:') || url.startsWith('http')) {
          buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
        } else if (url.startsWith('data:')) {
          buffer = Buffer.from(url.split(',')[1], 'base64');
        } else {
          throw new Error(`Unsupported image URL scheme: ${url}`);
        }
        onLoad?.(await loadImage(buffer));
      } catch (e) {
        onError ? onError(e) : console.error(e);
      }
    })();
    return new NodeCanvasImage();
  };

  const arrayBuffer = glbBuffer.buffer.slice(
    glbBuffer.byteOffset,
    glbBuffer.byteOffset + glbBuffer.byteLength
  );

  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });

  gltf.scene.traverse((obj) => {
    if (obj.isMesh && obj.geometry && !obj.geometry.getAttribute('normal')) {
      obj.geometry.computeVertexNormals();
    }
  });

  const usdzBytes = await new USDZExporter().parseAsync(gltf.scene);
  return Buffer.from(usdzBytes);
}
