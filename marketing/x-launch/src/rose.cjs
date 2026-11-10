// Renders the Nau glass mark (the repo's own WGSL shader) to raw RGBA with WebGPU, offscreen.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const wgsl = fs.readFileSync(path.join(__dirname, '../../../src/components/landing/rose/rose.wgsl'), 'utf8');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.on('console', m => console.log('C', m.text().slice(0, 300)));
  await p.goto('http://localhost:3100/robots.txt');
  await p.evaluate(async (frag) => {
    const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice();
    const format = 'rgba8unorm';
    const vs = `struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
    @vertex fn vs_main(@builtin(vertex_index) i: u32) -> V { var o: V; let x = f32((i << 1u) & 2u); let y = f32(i & 2u); o.pos = vec4f(x*2.0-1.0, 1.0-y*2.0, 0.0, 1.0); o.uv = vec2f(x, y); return o; }`;
    const mod = d.createShaderModule({ code: vs + '\n' + frag });
    const pipe = await d.createRenderPipelineAsync({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs_main' }, fragment: { module: mod, entryPoint: 'fs_main', targets: [{ format }] } });
    const buf = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    window.renderRose = async (j) => {
      const f = new Float32Array(12);
      f.set([j.w, j.h, j.pointer[0], j.pointer[1], j.center[0], j.center[1], j.time, j.scale, j.presence ?? 0]);
      d.queue.writeBuffer(buf, 0, f);
      const tex = d.createTexture({ size: [j.w, j.h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const bpr = Math.ceil(j.w * 4 / 256) * 256;
      const out = d.createBuffer({ size: bpr * j.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: bpr }, [j.w, j.h]);
      d.queue.submit([enc.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(out.getMappedRange());
      const c = document.createElement('canvas'); c.width = j.w; c.height = j.h;
      const ctx = c.getContext('2d'); const img = ctx.createImageData(j.w, j.h);
      for (let y = 0; y < j.h; y++) img.data.set(src.subarray(y * bpr, y * bpr + j.w * 4), y * j.w * 4);
      ctx.putImageData(img, 0, 0); out.unmap(); out.destroy(); tex.destroy();
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 32768) s += String.fromCharCode(...ab.subarray(i, i + 32768));
      return btoa(s);
    };
  }, wgsl);
  for (const j of jobs) {
    const t0 = Date.now();
    const data = await p.evaluate((j) => window.renderRose(j), j);
    fs.writeFileSync(j.out, Buffer.from(data, 'base64'));
    console.log('wrote', j.out, Date.now() - t0, 'ms');
  }
  await b.close();
})();
